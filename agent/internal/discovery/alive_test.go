package discovery

import (
	"context"
	"net"
	"testing"
)

func TestFirstOpenPortSeesAcceptedAndRefused(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("can't listen:", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	saved := printerTCPPorts
	defer func() { printerTCPPorts = saved }()

	printerTCPPorts = []int{port}
	if got := firstOpenPort(context.Background(), net.ParseIP("127.0.0.1")); got != port {
		t.Errorf("listening port: got %d, want %d", got, port)
	}

	// A closed port on a live host is refused - still proves the host is up.
	ln2, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln2.Addr().(*net.TCPAddr).Port
	ln2.Close()
	printerTCPPorts = []int{closed}
	if got := firstOpenPort(context.Background(), net.ParseIP("127.0.0.1")); got != closed {
		t.Errorf("refused port: got %d, want %d (a refusal means the host is up)", got, closed)
	}
}

func TestAliveWithoutSNMPFlagsUpHostsOnly(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("can't listen:", err)
	}
	defer ln.Close()
	saved := printerTCPPorts
	defer func() { printerTCPPorts = saved }()
	printerTCPPorts = []int{ln.Addr().(*net.TCPAddr).Port}

	devices := aliveWithoutSNMP(context.Background(), []target{
		{IP: net.ParseIP("127.0.0.1").To4(), Community: "public", Label: "SEDE.DIR.1A"},
		// TEST-NET-1 (RFC 5737): never routed, so nothing answers.
		{IP: net.ParseIP("192.0.2.1").To4(), Community: "public", Label: "RETIRED"},
	})
	if len(devices) != 1 {
		t.Fatalf("expected only the live host, got %v", devices)
	}
	d := devices[0]
	if d.Name != "SEDE.DIR.1A" || d.Host != "127.0.0.1" || !d.NoSNMP || d.Port != 161 {
		t.Errorf("unexpected device %+v", d)
	}
}

func TestMergeTargetsKeepsSourceLabel(t *testing.T) {
	base := []target{{IP: net.ParseIP("10.96.16.12").To4(), Community: "public"}}
	got := mergeTargets(base, []target{{IP: net.ParseIP("10.96.16.12").To4(), Community: "public", Label: "SEDE.DIR.1A"}})
	if len(got) != 1 || got[0].Label != "SEDE.DIR.1A" {
		t.Errorf("label not kept on merge: %+v", got)
	}
}
