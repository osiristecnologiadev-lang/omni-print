package discovery

import (
	"context"
	"log"
	"net"
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
	if ip := net.ParseIP(candidate); ip != nil && ip.To4() != nil {
		return candidate
	}
	return ""
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
		out = append(out, target{IP: ip, Community: community})
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
