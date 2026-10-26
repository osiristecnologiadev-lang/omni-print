package discovery

import (
	"net"
	"testing"
)

func TestPickAutoNets(t *testing.T) {
	_, own, _ := net.ParseCIDR("192.168.0.0/24")
	got, _ := pickAutoNets(nil, []*net.IPNet{own}, []string{
		"0.0.0.0/0",        // default route
		"192.168.0.0/24",   // already swept (own subnet)
		"192.168.0.10/32",  // host route inside it
		"192.168.1.0/24",   // new private network -> kept
		"10.0.0.0/8",       // too big to sweep automatically
		"10.20.0.0/16",     // biggest allowed -> kept
		"10.20.5.0/24",     // inside the /16 just picked
		"200.150.10.0/24",  // public - never
		"224.0.0.0/4",      // multicast
		"255.255.255.255",  // broadcast
		"not a network",
	}, "routing table")

	want := []string{"192.168.1.0/24", "10.20.0.0/16"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i, w := range want {
		if got[i].Net.String() != w || got[i].Source != "routing table" {
			t.Errorf("got[%d] = %s (%s), want %s", i, got[i].Net, got[i].Source, w)
		}
	}
}
