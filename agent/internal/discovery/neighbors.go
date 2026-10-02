package discovery

import (
	"log"
	"net"
	"sort"
)

// maxAutoNeighborNets caps how many neighbouring /24s one sweep adds on its
// own (64 x 254 = ~16k probes, ~20 minutes at the large-sweep concurrency).
// Wider than that stays an explicit choice in the panel ("Redes adicionais").
const maxAutoNeighborNets = 64

// neighborNets picks the /24s worth sweeping next to printers we already
// know about, so a printer on a sibling subnet shows up without anyone
// having to know or type a range.
//
// Added for a real customer group (DAC/SE/Rodovibe, 2026-10): one shared
// network, each agent only swept its own subnet, and printers the tenant
// bills every month sat unseen on the /24s next door - found only after a
// human configured three /16s in the panel. The hints (a print server
// port, an Active Directory queue, a printer already being polled) all say
// "this subnet has printers", so its /24 is the cheapest place to look.
//
// Only private (RFC 1918) addresses - a hint resolving to a public address
// must never turn into a sweep of someone else's network - and never a /24
// the sweep already covers. Ordered by how many hints point at each /24, so
// the cap drops the least likely ones first.
func neighborNets(hints []net.IP, covered []*net.IPNet, max int) []*net.IPNet {
	type candidate struct {
		net   *net.IPNet
		hints int
	}
	byKey := map[string]*candidate{}
	mask := net.CIDRMask(24, 32)
	for _, ip := range hints {
		ip4 := ip.To4()
		if ip4 == nil || !ip4.IsPrivate() {
			continue
		}
		n := &net.IPNet{IP: ip4.Mask(mask), Mask: mask}
		if coveredBy(n, covered) {
			continue
		}
		key := n.String()
		if c, ok := byKey[key]; ok {
			c.hints++
			continue
		}
		byKey[key] = &candidate{net: n, hints: 1}
	}

	list := make([]*candidate, 0, len(byKey))
	for _, c := range byKey {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].hints != list[j].hints {
			return list[i].hints > list[j].hints
		}
		return list[i].net.String() < list[j].net.String()
	})
	if len(list) > max {
		log.Printf("discovery: %d neighbouring subnet(s) have printers nearby - sweeping the %d with the most, configure the rest in the panel if needed", len(list), max)
		list = list[:max]
	}
	out := make([]*net.IPNet, len(list))
	for i, c := range list {
		out[i] = c.net
	}
	return out
}

// coveredBy reports whether every address of n is inside one of nets.
func coveredBy(n *net.IPNet, nets []*net.IPNet) bool {
	first := n.IP.Mask(n.Mask).To4()
	last := make(net.IP, len(first))
	for i := range first {
		last[i] = first[i] | ^n.Mask[i]
	}
	for _, c := range nets {
		if c.Contains(first) && c.Contains(last) {
			return true
		}
	}
	return false
}

// HostNetworks lists the IPv4 subnets of the host's own network interfaces,
// whatever their size (unlike localSubnets, which skips ones too big to
// sweep) and without logging - it's called every poll cycle. Used to tell
// the API which printers are NOT on the agent's own network, see
// OnNetworks.
func HostNetworks() []*net.IPNet {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var nets []*net.IPNet
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || isVirtualInterfaceName(iface.Name) {
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
			nets = append(nets, &net.IPNet{IP: ip4.Mask(mask), Mask: mask})
		}
	}
	return nets
}

// OnNetworks reports whether host is inside one of nets. A host that isn't
// a literal IPv4 address (a DNS name typed in config.yaml) counts as on the
// network: there's nothing to compare, and an admin typed it on purpose.
func OnNetworks(host string, nets []*net.IPNet) bool {
	ip := net.ParseIP(host).To4()
	if ip == nil {
		return true
	}
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}
