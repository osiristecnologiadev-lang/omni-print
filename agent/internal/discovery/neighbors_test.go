package discovery

import (
	"net"
	"testing"
)

func ips(ss ...string) []net.IP {
	out := make([]net.IP, len(ss))
	for i, s := range ss {
		out[i] = net.ParseIP(s)
	}
	return out
}

func netStrings(nets []*net.IPNet) []string {
	out := make([]string, len(nets))
	for i, n := range nets {
		out[i] = n.String()
	}
	return out
}

// The DAC/SE/Rodovibe case: the agent sweeps its own /24, a print server
// port points at 192.168.49.175 and two polled printers sit on 10.0.10.x -
// both sibling /24s must be swept, the agent's own one not again.
func TestNeighborNetsPicksSiblingSubnets(t *testing.T) {
	own := parseRanges([]string{"192.168.48.0/24"})
	got := netStrings(neighborNets(ips("192.168.48.10", "192.168.49.175", "10.0.10.44", "10.0.10.51"), own, 64))
	want := []string{"10.0.10.0/24", "192.168.49.0/24"} // 2 hints first, then 1
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// A hint that resolves to a public address must never become a sweep of
// someone else's network.
func TestNeighborNetsIgnoresPublicAddresses(t *testing.T) {
	if got := neighborNets(ips("8.8.8.8", "200.160.2.3"), nil, 64); len(got) != 0 {
		t.Fatalf("expected no public subnets, got %v", netStrings(got))
	}
}

// A /16 configured in the panel already covers its /24s; a single address
// typed there (/32) does not.
func TestNeighborNetsSkipsCoveredButNotSingleAddresses(t *testing.T) {
	scanned := parseRanges([]string{"10.80.0.0/16", "172.16.252.5"})
	got := netStrings(neighborNets(ips("10.80.34.45", "172.16.252.5"), scanned, 64))
	if len(got) != 1 || got[0] != "172.16.252.0/24" {
		t.Fatalf("got %v, want [172.16.252.0/24]", got)
	}
}

func TestNeighborNetsCapsAtMax(t *testing.T) {
	got := neighborNets(ips("10.0.1.1", "10.0.2.1", "10.0.3.1", "10.0.3.2"), nil, 2)
	if len(got) != 2 || got[0].String() != "10.0.3.0/24" {
		t.Fatalf("expected the cap to keep the most-hinted subnet first, got %v", netStrings(got))
	}
}

func TestOnNetworks(t *testing.T) {
	own := parseRanges([]string{"192.168.48.0/23"})
	cases := map[string]bool{
		"192.168.49.175": true,  // inside the /23
		"192.168.50.1":   false, // next door
		"10.0.10.44":     false,
		"printer.local":  true, // a typed DNS name - nothing to compare
	}
	for host, want := range cases {
		if got := OnNetworks(host, own); got != want {
			t.Errorf("OnNetworks(%q) = %v, want %v", host, got, want)
		}
	}
}
