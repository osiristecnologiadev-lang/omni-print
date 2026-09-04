// Package discovery finds printers on the network the agent's host is
// already connected to, so an admin doesn't have to type every IP by hand.
//
// This is deliberately different from "scan whatever network we find
// ourselves on, whenever": by default it only sweeps the subnet(s) actually
// configured on the host machine's own network interfaces (skipping obvious
// virtual/loopback/link-local adapters), it can be pointed at explicit
// ranges instead, it runs on a slow interval (not continuously), and every
// probe is a normal read-only SNMP GET - the same traffic pattern any
// network management tool produces. See agent/README.md for the reasoning.
//
// A single sweep can miss a real printer (SNMP over UDP, no delivery
// guarantee, confirmed against real hardware under concurrent load) - this
// is expected and self-heals on the next scheduled sweep, not a bug to chase
// away entirely. Don't treat one sweep's results as a complete inventory.
package discovery

import (
	"context"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/omniprint/agent/internal/config"
)

// These mirror collector's OIDs; duplicated here so this package doesn't
// depend on collector's internals for two constants.
const (
	oidProbeSysName     = "1.3.6.1.2.1.1.5.0"
	oidProbePrinterName = "1.3.6.1.2.1.43.5.1.1.16.1" // only printers implement Printer-MIB
)

// autoDetectMaxPrefix caps how large a subnet we'll sweep automatically from
// a detected interface (a /20 or smaller network, i.e. <=4096 addresses).
// Explicit config.Discovery.Ranges aren't capped - the admin asked for it.
const autoDetectMaxPrefix = 20

var virtualNamePatterns = []string{
	"virtual", "vethernet", "docker", "wsl", "hyper-v", "vmware",
	"virtualbox", "loopback", "tap", "tunnel", "vpn", "zerotier", "tailscale",
}

type Options struct {
	Ranges       []string // CIDRs to scan; empty = auto-detect the host's own subnet(s)
	Community    string
	Port         uint16
	Concurrency  int
	ProbeTimeout time.Duration
	Delay        time.Duration // pause between each worker's requests
}

// Run sweeps the configured (or auto-detected) ranges and returns every host
// that answers SNMP with a Printer-MIB, i.e. an actual printer - not just
// any device that happens to speak SNMP (switches, UPSes, etc. don't
// implement prtGeneralTable, so they're excluded).
func Run(ctx context.Context, opts Options) []config.Device {
	nets := parseRanges(opts.Ranges)
	if len(nets) == 0 {
		nets = localSubnets()
	}
	if len(nets) == 0 {
		log.Printf("discovery: no subnets to scan (nothing configured, nothing auto-detected)")
		return nil
	}

	var targets []net.IP
	for _, n := range nets {
		hosts := hostsIn(n)
		log.Printf("discovery: scanning %s (%d hosts)", n.String(), len(hosts))
		targets = append(targets, hosts...)
	}

	return probeAll(ctx, targets, opts)
}

func parseRanges(ranges []string) []*net.IPNet {
	var nets []*net.IPNet
	for _, r := range ranges {
		_, ipnet, err := net.ParseCIDR(r)
		if err != nil {
			log.Printf("discovery: ignoring invalid range %q: %v", r, err)
			continue
		}
		nets = append(nets, ipnet)
	}
	return nets
}

// localSubnets enumerates the host's own network interfaces and returns the
// IPv4 subnets worth sweeping - skipping loopback, link-local, down
// interfaces, obviously-virtual adapters, and ranges too large to sweep
// safely without an explicit admin opt-in via Options.Ranges.
func localSubnets() []*net.IPNet {
	ifaces, err := net.Interfaces()
	if err != nil {
		log.Printf("discovery: failed to list network interfaces: %v", err)
		return nil
	}

	var nets []*net.IPNet
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		lname := strings.ToLower(iface.Name)
		virtual := false
		for _, pat := range virtualNamePatterns {
			if strings.Contains(lname, pat) {
				virtual = true
				break
			}
		}
		if virtual {
			log.Printf("discovery: skipping interface %q (looks virtual)", iface.Name)
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			mask := ipnet.Mask
			if len(mask) == 16 {
				mask = mask[12:]
			}
			ones, _ := mask.Size()
			if ones < autoDetectMaxPrefix {
				log.Printf("discovery: skipping %s/%d on %q - too large to auto-scan; set discovery.ranges explicitly if you need it", ip4, ones, iface.Name)
				continue
			}
			n := &net.IPNet{IP: ip4, Mask: mask}
			nets = append(nets, n)
			log.Printf("discovery: will scan %s (interface %q)", n.String(), iface.Name)
		}
	}
	return nets
}

// hostsIn lists every usable host address in ipnet (network and broadcast
// addresses excluded), capped at 65536 as a hard safety limit.
func hostsIn(ipnet *net.IPNet) []net.IP {
	base := ipnet.IP.Mask(ipnet.Mask).To4()
	if base == nil {
		return nil
	}
	ones, bits := ipnet.Mask.Size()
	total := 1 << uint(bits-ones)
	if total > 65536 {
		log.Printf("discovery: %s has %d addresses, capping scan to the first 65536", ipnet.String(), total)
		total = 65536
	}

	ips := make([]net.IP, 0, total)
	cur := append(net.IP{}, base...)
	for i := 0; i < total; i++ {
		ips = append(ips, append(net.IP{}, cur...))
		incIP(cur)
	}
	if len(ips) > 2 {
		ips = ips[1 : len(ips)-1] // drop network + broadcast addresses
	}
	return ips
}

func incIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			return
		}
	}
}

// probeAll fans out probes across a bounded worker pool so a full sweep
// doesn't take forever, while staying far short of "every host at once" -
// each worker also pauses between requests.
func probeAll(ctx context.Context, ips []net.IP, opts Options) []config.Device {
	concurrency := opts.Concurrency
	if concurrency <= 0 {
		concurrency = 8
	}
	port := opts.Port
	if port == 0 {
		port = 161
	}

	jobs := make(chan net.IP)
	results := make(chan config.Device)
	var wg sync.WaitGroup

	for w := 0; w < concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range jobs {
				if d, ok := probeHost(ip.String(), port, opts.Community, opts.ProbeTimeout); ok {
					select {
					case results <- d:
					case <-ctx.Done():
						return
					}
				}
				if opts.Delay > 0 {
					time.Sleep(opts.Delay)
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, ip := range ips {
			select {
			case jobs <- ip:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var found []config.Device
	for d := range results {
		found = append(found, d)
	}
	return found
}

// probeHost sends one lightweight SNMP GET and reports whether the host
// implements the Printer-MIB (i.e. is an actual printer, not just any
// SNMP-speaking device on the network).
func probeHost(host string, port uint16, community string, timeout time.Duration) (config.Device, bool) {
	g := &gosnmp.GoSNMP{
		Target:    host,
		Port:      port,
		Community: community,
		Version:   gosnmp.Version2c,
		Timeout:   timeout,
		// SNMP rides on UDP - a single lost packet during a concurrent sweep
		// shouldn't read as "not a printer". One retry was confirmed
		// necessary against real hardware: a printer that answered instantly
		// to a direct probe was missed by a Retries:0 sweep under load.
		Retries: 1,
	}
	if err := g.Connect(); err != nil {
		return config.Device{}, false
	}
	defer g.Conn.Close()

	result, err := g.Get([]string{oidProbePrinterName, oidProbeSysName})
	if err != nil {
		return config.Device{}, false
	}

	isPrinter := false
	name := ""
	for _, v := range result.Variables {
		switch v.Name {
		case "." + oidProbePrinterName:
			if v.Type != gosnmp.NoSuchObject && v.Type != gosnmp.NoSuchInstance {
				isPrinter = true
				if b, ok := v.Value.([]byte); ok && len(strings.TrimSpace(string(b))) > 0 {
					name = strings.TrimSpace(string(b))
				}
			}
		case "." + oidProbeSysName:
			if name == "" {
				if b, ok := v.Value.([]byte); ok {
					name = strings.TrimSpace(string(b))
				}
			}
		}
	}
	if !isPrinter {
		return config.Device{}, false
	}
	if name == "" {
		name = host
	}
	return config.Device{Name: name, Host: host, Community: community, Port: port}, true
}
