package discovery

import (
	"net"
	"strings"
	"testing"
	"time"

	"github.com/gosnmp/gosnmp"
)

// startPickyAgent answers the printer probe only on one SNMP version and
// community - the shape of Amecor's silent printers (2026-10).
func startPickyAgent(t *testing.T, version gosnmp.SnmpVersion, community string) uint16 {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Skip("can't listen:", err)
	}
	t.Cleanup(func() { conn.Close() })
	go func() {
		dec := &gosnmp.GoSNMP{Version: gosnmp.Version2c, Logger: gosnmp.NewLogger(nil)}
		buf := make([]byte, 65535)
		for {
			n, from, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			req, err := dec.SnmpDecodePacket(buf[:n])
			if err != nil || req.Version != version || req.Community != community || req.PDUType != gosnmp.GetRequest {
				continue // wrong version/community: silence, like a real agent
			}
			var out []gosnmp.SnmpPDU
			for _, v := range req.Variables {
				name := strings.TrimPrefix(v.Name, ".")
				switch name {
				case oidProbePrinterName:
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.OctetString, Value: []byte("OKI ES6405")})
				default:
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.NoSuchObject})
				}
			}
			resp := &gosnmp.SnmpPacket{Version: version, Community: community, PDUType: gosnmp.GetResponse, RequestID: req.RequestID, Variables: out}
			if b, err := resp.MarshalMsg(); err == nil {
				_, _ = conn.WriteToUDP(b, from)
			}
		}
	}()
	return uint16(conn.LocalAddr().(*net.UDPAddr).Port)
}

func TestFindSNMPAccessTriesOtherCommunitiesAndV1(t *testing.T) {
	saved := aliveSNMPPort
	defer func() { aliveSNMPPort = saved }()
	target := target{IP: net.ParseIP("127.0.0.1").To4(), Community: "public", Label: "HEMOCOR COLORIDA"}

	aliveSNMPPort = startPickyAgent(t, gosnmp.Version2c, "private")
	d, ok := findSNMPAccess(target, 100*time.Millisecond)
	if !ok || d.Community != "private" || d.SNMPv1 {
		t.Fatalf("v2c/private: got %+v ok=%v", d, ok)
	}

	aliveSNMPPort = startPickyAgent(t, gosnmp.Version1, "public")
	d, ok = findSNMPAccess(target, 100*time.Millisecond)
	if !ok || d.Community != "public" || !d.SNMPv1 {
		t.Fatalf("v1/public: got %+v ok=%v", d, ok)
	}

	aliveSNMPPort = startPickyAgent(t, gosnmp.Version2c, "s3cr3t")
	if d, ok = findSNMPAccess(target, 100*time.Millisecond); ok {
		t.Fatalf("unknown community should stay unreachable, got %+v", d)
	}
}
