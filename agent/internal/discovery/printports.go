package discovery

import (
	"context"
	"log"
	"net"
	"regexp"
	"strings"
)

// printPort is one network printer port a Windows print server already has
// configured - see printServerPorts (printports_windows.go).
//
// Added after a real customer (Sabin, 2026-09): the agent ran on their print
// server, which reaches all ~45 printers, but auto-discovery only swept the
// server's own subnet and found 9 - the rest live on other routed
// subnets/VLANs the agent had no way to guess. The print server already
// knows every printer's exact address (that's how it prints to them), so
// reading its ports finds them all with zero configuration and without
// sweeping any extra range.
type printPort struct {
	Name      string // the port's own name, for logging only
	Host      string // IP or hostname, as configured on the port
	Community string // the port's SNMP community, "" if not set
}

// portHost picks the printer's address out of a port's registry values.
// Standard TCP/IP Port (and HP's own TCP/IP monitor, same layout) store it
// in HostName, older ones in IPAddress; LPR ports use "Server Name". Falls
// back to the port's own name when it's literally an IP ("10.0.0.5", or
// the common "IP_10.0.0.5" naming), since some third-party monitors keep
// nothing else useful.
func portHost(name string, values map[string]string) string {
	for _, key := range []string{"HostName", "IPAddress", "Server Name"} {
		if v := strings.TrimSpace(values[key]); v != "" {
			return v
		}
	}
	candidate := strings.TrimPrefix(strings.TrimPrefix(name, "IP_"), "ip_")
	// Windows names a second port to the same address "10.0.0.5_1".
	if i := strings.LastIndex(candidate, "_"); i > 0 && isDigits(candidate[i+1:]) {
		candidate = candidate[:i]
	}
	if ip := net.ParseIP(candidate); ip != nil && ip.To4() != nil {
		return candidate
	}
	return embeddedIPv4(name)
}

var (
	dottedIPv4     = regexp.MustCompile(`(?:^|[^\d.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:$|[^\d.])`)
	underscoreIPv4 = regexp.MustCompile(`(?:^|\D)(\d{1,3})_(\d{1,3})_(\d{1,3})_(\d{1,3})(?:$|\D)`)
)

// embeddedIPv4 finds an address inside a port name that has other text
// around it - real names seen on Sabin's print servers:
// "PAPERCUT_10.96.32.10" (PaperCut's port monitor) and "X_10_96_16_12"
// (underscores instead of dots).
func embeddedIPv4(name string) string {
	if m := dottedIPv4.FindStringSubmatch(name); m != nil {
		if ip := net.ParseIP(m[1]); ip != nil && ip.To4() != nil {
			return m[1]
		}
	}
	if m := underscoreIPv4.FindStringSubmatch(name); m != nil {
		candidate := strings.Join(m[1:], ".")
		if ip := net.ParseIP(candidate); ip != nil && ip.To4() != nil {
			return candidate
		}
	}
	return ""
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// localPortPrefixes are port names that are never a network address.
var localPortPrefixes = []string{"wsd", "usb", "lpt", "com", "ts0", "dot4", "file", "nul", "portprompt", "xps"}

// isLocalPortName reports ports that never lead to a network printer: USB,
// LPT, WSD..., and `\\server\share` connections to another machine's queue.
func isLocalPortName(name string) bool {
	if strings.HasPrefix(name, `\\`) {
		return true
	}
	lower := strings.ToLower(name)
	for _, p := range localPortPrefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

// portNameHost is portHost for when only a port's NAME is known - an AD
// printQueue's portName, or a remote print server's queue list - with no
// registry values to read. Beyond the IP forms portHost already handles,
// a name that looks like a hostname ("impressora-rh.sabin.local") is
// returned as-is for DNS to try; local port kinds (USB001, LPT1, WSD-...)
// never are.
func portNameHost(name string) string {
	if h := portHost(name, nil); h != "" {
		return h
	}
	if isLocalPortName(name) {
		return ""
	}
	for _, r := range name {
		if !(r == '-' || r == '.' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return ""
		}
	}
	return name
}

// target is one address a sweep will probe, with the SNMP community to use -
// normally the discovery-wide default, but a print-server port can carry
// its own (see printPort.Community).
type target struct {
	IP        net.IP
	Community string
}

// printServerTargets resolves the host's configured printer ports into probe
// targets. A port whose host is a DNS name is resolved to its IPv4 address
// so it dedupes against the same printer found by a subnet sweep (and
// against devices already known by IP); an unresolvable one is logged and
// skipped - it'll be retried on the next sweep.
func printServerTargets(ctx context.Context, defaultCommunity string) []target {
	ports := printServerPorts()
	log.Printf("discovery: found %d network printer port(s) configured on this host (print server)", len(ports))
	return portTargets(ctx, ports, defaultCommunity)
}

// portTargets resolves ports (from this host, a remote print server, or AD)
// into probe targets, deduplicated by IP.
func portTargets(ctx context.Context, ports []printPort, defaultCommunity string) []target {
	var out []target
	for _, p := range ports {
		ip := resolveIPv4(ctx, p.Host)
		if ip == nil {
			log.Printf("discovery: print port %q points at %q, which doesn't resolve to an IPv4 address - skipping", p.Name, p.Host)
			continue
		}
		community := p.Community
		if community == "" {
			community = defaultCommunity
		}
		out = mergeTargets(out, []target{{IP: ip, Community: community}})
	}
	return out
}

func resolveIPv4(ctx context.Context, host string) net.IP {
	if ip := net.ParseIP(host); ip != nil {
		return ip.To4()
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil
	}
	for _, a := range addrs {
		if ip4 := a.IP.To4(); ip4 != nil {
			return ip4
		}
	}
	return nil
}

// mergeTargets appends extra to base, deduplicated by IP. When an address is
// in both, extra's community wins - a print-server port's community is what
// that printer is actually configured to answer, more specific than the
// discovery-wide default a subnet sweep uses.
func mergeTargets(base, extra []target) []target {
	index := make(map[string]int, len(base))
	for i, t := range base {
		index[t.IP.String()] = i
	}
	for _, t := range extra {
		if i, ok := index[t.IP.String()]; ok {
			base[i].Community = t.Community
			continue
		}
		index[t.IP.String()] = len(base)
		base = append(base, t)
	}
	return base
}
