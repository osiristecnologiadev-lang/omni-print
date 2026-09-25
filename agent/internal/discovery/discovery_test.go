package discovery

import (
	"net"
	"testing"
)

func TestParseRanges(t *testing.T) {
	nets := parseRanges([]string{"10.0.0.0/24", "not-a-cidr", "192.168.1.0/28"})
	if len(nets) != 2 {
		t.Fatalf("expected 2 valid ranges (invalid one skipped), got %d: %v", len(nets), nets)
	}
	if nets[0].String() != "10.0.0.0/24" {
		t.Errorf("nets[0] = %s, want 10.0.0.0/24", nets[0].String())
	}
}

func TestParseRangesEmpty(t *testing.T) {
	if nets := parseRanges(nil); len(nets) != 0 {
		t.Errorf("expected no nets for nil input, got %v", nets)
	}
}

// Regression test for a real incident: a customer's print server was a
// Hyper-V/VMware VM guest, whose own primary (and only) network adapter is
// exactly the kind of name this used to blanket-filter out ("virtual",
// "vethernet", "hyper-v", "vmware" were all in the old pattern list) -
// zero interfaces left to scan, zero printers ever found, even though the
// same machine reached the printers fine (confirmed via a competing
// product installed on the identical host). These names must now survive.
func TestIsVirtualInterfaceNameLetsRealVMAdaptersThrough(t *testing.T) {
	realAdapters := []string{
		"vEthernet (Default Switch)",
		"vEthernet (External Virtual Switch)",
		"Microsoft Hyper-V Network Adapter",
		"VMware VMXNET3 Ethernet Adapter",
		"Intel(R) Virtual Function Ethernet Adapter",
	}
	for _, name := range realAdapters {
		if isVirtualInterfaceName(name) {
			t.Errorf("isVirtualInterfaceName(%q) = true, want false - this would zero out a real print-server VM's only network path", name)
		}
	}
}

func TestIsVirtualInterfaceNameStillSkipsKnownNonLanNetworks(t *testing.T) {
	skipped := []string{
		"docker0", "Docker Desktop Backend", "vEthernet (WSL)",
		"tailscale0", "ZeroTier One [abcdef123]",
		"OpenVPN TAP-Windows Adapter", "Loopback Pseudo-Interface 1",
	}
	for _, name := range skipped {
		if !isVirtualInterfaceName(name) {
			t.Errorf("isVirtualInterfaceName(%q) = false, want true - should still be skipped", name)
		}
	}
}

func TestHostsInDropsNetworkAndBroadcast(t *testing.T) {
	_, ipnet, err := net.ParseCIDR("10.0.0.0/30")
	if err != nil {
		t.Fatalf("ParseCIDR: %v", err)
	}
	// /30 has 4 addresses total (10.0.0.0 network, .1, .2, .3 broadcast) -
	// only .1 and .2 are usable hosts.
	hosts := hostsIn(ipnet)
	if len(hosts) != 2 {
		t.Fatalf("expected 2 usable hosts in a /30, got %d: %v", len(hosts), hosts)
	}
	if hosts[0].String() != "10.0.0.1" || hosts[1].String() != "10.0.0.2" {
		t.Errorf("hosts = %v, want [10.0.0.1 10.0.0.2]", hosts)
	}
}

func TestHostsInSlash24(t *testing.T) {
	_, ipnet, err := net.ParseCIDR("192.168.1.0/24")
	if err != nil {
		t.Fatalf("ParseCIDR: %v", err)
	}
	hosts := hostsIn(ipnet)
	if len(hosts) != 254 {
		t.Fatalf("expected 254 usable hosts in a /24, got %d", len(hosts))
	}
	if hosts[0].String() != "192.168.1.1" {
		t.Errorf("first host = %s, want 192.168.1.1", hosts[0].String())
	}
	if hosts[len(hosts)-1].String() != "192.168.1.254" {
		t.Errorf("last host = %s, want 192.168.1.254", hosts[len(hosts)-1].String())
	}
}

func TestHostsInCapsAtSafetyLimit(t *testing.T) {
	// /8 would be 16M+ addresses - must be capped, not actually enumerated.
	_, ipnet, err := net.ParseCIDR("10.0.0.0/8")
	if err != nil {
		t.Fatalf("ParseCIDR: %v", err)
	}
	hosts := hostsIn(ipnet)
	if len(hosts) > 65536 {
		t.Errorf("hostsIn did not cap a /8, got %d hosts", len(hosts))
	}
}

func TestIncIP(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"10.0.0.1", "10.0.0.2"},
		{"10.0.0.255", "10.0.1.0"},
		{"10.0.255.255", "10.1.0.0"},
		{"255.255.255.255", "0.0.0.0"}, // overflow wraps, matching Go's byte arithmetic
	}
	for _, tt := range tests {
		ip := net.ParseIP(tt.in).To4()
		incIP(ip)
		if ip.String() != tt.want {
			t.Errorf("incIP(%s) = %s, want %s", tt.in, ip.String(), tt.want)
		}
	}
}

func TestParseRangesAcceptsBareAddress(t *testing.T) {
	nets := parseRanges([]string{" 10.80.40.5 ", "10.80.41.0/24"})
	if len(nets) != 2 {
		t.Fatalf("expected 2 nets, got %d", len(nets))
	}
	if nets[0].String() != "10.80.40.5/32" || len(hostsIn(nets[0])) != 1 {
		t.Errorf("bare address parsed as %s with %d host(s), want 10.80.40.5/32 with 1", nets[0], len(hostsIn(nets[0])))
	}
}
