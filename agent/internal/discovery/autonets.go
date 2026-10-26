package discovery

import (
	"context"
	"errors"
	"log"
	"net"
	"time"
)

// autoNetMinPrefix: the biggest network swept automatically is a /16
// (65k addresses, ~35 minutes at the large-sweep concurrency). Anything
// wider - a 10.0.0.0/8 route, say - is almost always a catch-all, not a
// place someone actually put printers, and stays a panel choice.
const autoNetMinPrefix = 16

const routeLookupTimeout = 10 * time.Second

// autoNet is one network found without anyone typing it, and where from.
type autoNet struct {
	Net    *net.IPNet
	Source string
}

// autoNetworks returns the other networks this site says it has, from places
// that need no configuration and no one on-site:
//   - Active Directory's subnet list (Sites and Services) - the domain's own
//     map of every network it has offices/VLANs on;
//   - this host's routing table - a route to a private network means there
//     is something there worth reaching.
//
// Added for a real customer (Cartório 2º Ofício, 2026-10): 7 printers the
// tenant bills every month were not on the agent's own /24, and no printer
// the agent knew pointed at their subnet, so neither the neighbour sweep nor
// anything else ever looked there. Only private, not-already-covered
// networks no bigger than autoNetMinPrefix.
func autoNetworks(ctx context.Context, covered []*net.IPNet) []autoNet {
	var out []autoNet

	subnets, err := withTimeout(ctx, adLookupTimeout, adSubnets)
	switch {
	case errors.Is(err, errNotInDomain):
	case err != nil:
		log.Printf("discovery: active directory subnets: %v", err)
	default:
		log.Printf("discovery: active directory lists %d subnet(s): %v", len(subnets), subnets)
		out, covered = pickAutoNets(out, covered, subnets, "active directory")
	}

	routes, err := withTimeout(ctx, routeLookupTimeout, routedNetworks)
	if err != nil {
		log.Printf("discovery: routing table: %v", err)
	} else {
		// A host's own interfaces always have a route - including virtual
		// ones (WSL, Hyper-V, VPN) localSubnets deliberately skips.
		out, _ = pickAutoNets(out, append(covered, allInterfaceNetworks()...), routes, "routing table")
	}
	return out
}

// pickAutoNets appends the cidrs worth sweeping: private, between a /16 and
// a /30, and not already covered (by what's swept anyway or an earlier pick).
func pickAutoNets(out []autoNet, covered []*net.IPNet, cidrs []string, source string) ([]autoNet, []*net.IPNet) {
	for _, n := range parseRanges(cidrs) {
		ones, _ := n.Mask.Size()
		ip := n.IP.To4()
		if ip == nil || !ip.IsPrivate() || ones < autoNetMinPrefix || ones > 30 || coveredBy(n, covered) {
			continue
		}
		out = append(out, autoNet{Net: n, Source: source})
		covered = append(covered, n)
	}
	return out, covered
}

// allInterfaceNetworks is every IPv4 subnet on this host, virtual or not.
func allInterfaceNetworks() []*net.IPNet {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var nets []*net.IPNet
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil {
			mask := n.Mask
			if len(mask) == 16 {
				mask = mask[12:]
			}
			nets = append(nets, &net.IPNet{IP: n.IP.To4().Mask(mask), Mask: mask})
		}
	}
	return nets
}
