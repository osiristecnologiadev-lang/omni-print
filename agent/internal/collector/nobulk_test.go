package collector

import (
	"context"
	"math/big"
	"net"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/omniprint/agent/internal/config"
)

// fakeAgent is a minimal SNMPv2c agent on a local UDP port that answers GET
// and GETNEXT but silently drops GETBULK - the behavior Sabin's Brother
// NC-8900h print servers showed in production (2026-09).
type fakeAgent struct {
	conn  *net.UDPConn
	oids  []string // sorted, no leading dot
	vals  map[string]gosnmp.SnmpPDU
	bulks int
	// What GETBULK gets: dropped (default), or an empty endOfMibView answer.
	emptyBulk bool
	// Answer GET only - every GETNEXT gets endOfMibView.
	noNext bool
	// SNMP v1 rules: a GET naming any missing OID fails whole (noSuchName).
	v1Strict bool
}

func oidLess(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		x, _ := new(big.Int).SetString(pa[i], 10)
		y, _ := new(big.Int).SetString(pb[i], 10)
		if c := x.Cmp(y); c != 0 {
			return c < 0
		}
	}
	return len(pa) < len(pb)
}

func startFakeAgent(t *testing.T, pdus []gosnmp.SnmpPDU, opts ...func(*fakeAgent)) *fakeAgent {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	a := &fakeAgent{conn: conn, vals: map[string]gosnmp.SnmpPDU{}}
	for _, o := range opts {
		o(a)
	}
	for _, p := range pdus {
		a.vals[p.Name] = p
		a.oids = append(a.oids, p.Name)
	}
	sort.Slice(a.oids, func(i, j int) bool { return oidLess(a.oids[i], a.oids[j]) })
	go a.serve()
	t.Cleanup(func() { conn.Close() })
	return a
}

func (a *fakeAgent) serve() {
	dec := &gosnmp.GoSNMP{Version: gosnmp.Version2c, Community: "public", Logger: gosnmp.NewLogger(nil)}
	buf := make([]byte, 65535)
	for {
		n, from, err := a.conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		req, err := dec.SnmpDecodePacket(buf[:n])
		if err != nil {
			continue
		}
		var out []gosnmp.SnmpPDU
		errStatus := gosnmp.NoError
		switch req.PDUType {
		case gosnmp.GetBulkRequest:
			a.bulks++
			if !a.emptyBulk {
				continue // never answered
			}
			for _, v := range req.Variables {
				out = append(out, gosnmp.SnmpPDU{Name: strings.TrimPrefix(v.Name, "."), Type: gosnmp.EndOfMibView})
			}
		case gosnmp.GetRequest:
			missing := false
			for _, v := range req.Variables {
				name := strings.TrimPrefix(v.Name, ".")
				if p, ok := a.vals[name]; ok {
					out = append(out, p)
				} else {
					missing = true
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.NoSuchObject})
				}
			}
			if missing && a.v1Strict {
				out = out[:0]
				for _, v := range req.Variables {
					out = append(out, gosnmp.SnmpPDU{Name: strings.TrimPrefix(v.Name, "."), Type: gosnmp.Null})
				}
				errStatus = gosnmp.NoSuchName
			}
		case gosnmp.GetNextRequest:
			for _, v := range req.Variables {
				name := strings.TrimPrefix(v.Name, ".")
				i := sort.Search(len(a.oids), func(i int) bool { return oidLess(name, a.oids[i]) })
				if i < len(a.oids) && !a.noNext {
					out = append(out, a.vals[a.oids[i]])
				} else {
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.EndOfMibView})
				}
			}
		default:
			continue
		}
		resp := &gosnmp.SnmpPacket{
			Version:   req.Version,
			Community: req.Community,
			PDUType:   gosnmp.GetResponse,
			RequestID: req.RequestID,
			Error:     errStatus,
			Variables: out,
		}
		b, err := resp.MarshalMsg()
		if err != nil {
			continue
		}
		_, _ = a.conn.WriteToUDP(b, from)
	}
}

func TestPollFallsBackToGetNextWhenGetBulkIsIgnored(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("Brother NC-8900h")},
		{Name: oidSerialNumber, Type: gosnmp.OctetString, Value: []byte("U64198E6N222502")},
		{Name: oidPageCountCol + ".1.1", Type: gosnmp.Counter32, Value: uint(162418)},
		{Name: oidSuppliesDescr + ".1.1", Type: gosnmp.OctetString, Value: []byte("Toner")},
		{Name: oidSuppliesLevel + ".1.1", Type: gosnmp.Integer, Value: 40},
		{Name: oidSuppliesMax + ".1.1", Type: gosnmp.Integer, Value: 100},
	})
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	dev := config.Device{Name: "brother", Host: "127.0.0.1", Port: port, Community: "public"}
	c := New(0, 150*time.Millisecond, 0, false)

	m := c.pollDevice(context.Background(), dev)
	if m.PageCount == nil || *m.PageCount != 162418 {
		t.Fatalf("PageCount = %v, want 162418 (read via GETNEXT fallback)", m.PageCount)
	}
	if len(m.Supplies) != 1 || m.Supplies[0].Level != 40 {
		t.Fatalf("Supplies = %+v, want the toner at 40", m.Supplies)
	}
	if agent.bulks != 1 {
		t.Fatalf("GETBULK attempts on first poll = %d, want exactly 1 before switching", agent.bulks)
	}

	// Second poll: remembered - no GETBULK attempt (and no timeout) at all.
	start := time.Now()
	m = c.pollDevice(context.Background(), dev)
	if m.PageCount == nil || *m.PageCount != 162418 {
		t.Fatalf("second poll PageCount = %v", m.PageCount)
	}
	if agent.bulks != 1 {
		t.Fatalf("second poll tried GETBULK again (total %d)", agent.bulks)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("second poll took %s - still waiting on GETBULK timeouts", time.Since(start))
	}
}

// HP Laser 408dn / MFP 432fdn shape (Amecor, 2026-10): GET works, GETBULK
// comes back empty without an error.
func TestPollFallsBackToGetNextWhenGetBulkIsEmpty(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("HP Laser 408dn; V4.00.01.37")},
		{Name: oidSerialNumber, Type: gosnmp.OctetString, Value: []byte("BRBSP7507C")},
		{Name: oidPageCountCol + ".1.1", Type: gosnmp.Counter32, Value: uint(70596)},
		{Name: oidSuppliesDescr + ".1.1", Type: gosnmp.OctetString, Value: []byte("Toner")},
		{Name: oidSuppliesLevel + ".1.1", Type: gosnmp.Integer, Value: 40},
		{Name: oidSuppliesMax + ".1.1", Type: gosnmp.Integer, Value: 100},
	}, func(a *fakeAgent) { a.emptyBulk = true })
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	dev := config.Device{Name: "hp408", Host: "127.0.0.1", Port: port, Community: "public"}
	c := New(0, 150*time.Millisecond, 0, false)

	m := c.pollDevice(context.Background(), dev)
	if m.PageCount == nil || *m.PageCount != 70596 {
		t.Fatalf("PageCount = %v, want 70596 (read via GETNEXT after an empty GETBULK)", m.PageCount)
	}
	if len(m.Supplies) != 1 || m.Supplies[0].Level != 40 {
		t.Fatalf("Supplies = %+v, want the toner at 40", m.Supplies)
	}
}

// A printer discovery found answering only SNMP v1 is polled with v1.
func TestPollUsesSNMPv1WhenFlagged(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("OKI ES6405")},
		{Name: oidSerialNumber, Type: gosnmp.OctetString, Value: []byte("AK99000023")},
		{Name: oidPageCountCol + ".1.1", Type: gosnmp.Counter32, Value: uint(16107)},
	})
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	dev := config.Device{Name: "oki", Host: "127.0.0.1", Port: port, Community: "public", SNMPv1: true}
	c := New(0, 150*time.Millisecond, 0, false)

	m := c.pollDevice(context.Background(), dev)
	if m.SerialNumber != "AK99000023" || m.PageCount == nil || *m.PageCount != 16107 {
		t.Fatalf("serial %q PageCount %v", m.SerialNumber, m.PageCount)
	}
	if agent.bulks != 0 {
		t.Fatalf("sent %d GETBULK requests over SNMP v1", agent.bulks)
	}
}

// The OKI ES6405 found over SNMP v1 at Amecor (2026-10): no Printer-MIB
// serial, so v1 rejected the batched scalar GET whole; four equal drum
// counters; serial and split only in OKI's own subtree.
func TestPollReadsV1OKIWithFourMarkers(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("OKI ES6405")},
		{Name: oidSysObjectID, Type: gosnmp.ObjectIdentifier, Value: ".1.3.6.1.4.1.2001.1.1.1.297"},
		{Name: oidPageCountCol + ".1.1", Type: gosnmp.Counter32, Value: uint(16131)},
		{Name: oidPageCountCol + ".1.2", Type: gosnmp.Counter32, Value: uint(16131)},
		{Name: oidPageCountCol + ".1.3", Type: gosnmp.Counter32, Value: uint(16131)},
		{Name: oidPageCountCol + ".1.4", Type: gosnmp.Counter32, Value: uint(16131)},
		{Name: oidSuppliesDescr + ".1.1", Type: gosnmp.OctetString, Value: []byte("Cyan Toner")},
		{Name: oidSuppliesColorant + ".1.1", Type: gosnmp.Integer, Value: 2},
		{Name: oidColorantValue + ".1.2", Type: gosnmp.OctetString, Value: []byte("cyan")},
		{Name: "1.3.6.1.4.1.2001.1.1.1.1.11.1.10.45.0", Type: gosnmp.OctetString, Value: []byte("AK99000023")},
	}, func(a *fakeAgent) { a.v1Strict = true })
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	dev := config.Device{Name: "oki", Host: "127.0.0.1", Port: port, Community: "public", SNMPv1: true}
	c := New(0, 150*time.Millisecond, 0, true)

	m := c.pollDevice(context.Background(), dev)
	if !m.Online || m.SysDescr != "OKI ES6405" {
		t.Fatalf("online=%v sysDescr=%q err=%q - the v1 noSuchName GET should fall back per OID", m.Online, m.SysDescr, m.Error)
	}
	if m.PageCount == nil || *m.PageCount != 16131 {
		t.Fatalf("PageCount = %v, want 16131 (largest marker, not the 4x sum)", m.PageCount)
	}
	if m.Raw[".1.3.6.1.4.1.2001.1.1.1.1.11.1.10.45.0"] != "AK99000023" {
		t.Fatalf("vendor subtree not captured into Raw (%d entries)", len(m.Raw))
	}
	// Once per host per run.
	m = c.pollDevice(context.Background(), dev)
	if _, ok := m.Raw[".1.3.6.1.4.1.2001.1.1.1.1.11.1.10.45.0"]; ok {
		t.Fatal("vendor subtree captured again on the second poll")
	}
}

// An agent that answers no walk at all still gets its page counter by GET.
func TestPageCountReadByGetWhenNoWalkWorks(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("HP Laser MFP 432fdn")},
		{Name: oidPageCountCol + ".1.1", Type: gosnmp.Counter32, Value: uint(12345)},
	}, func(a *fakeAgent) { a.emptyBulk = true; a.noNext = true })
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	dev := config.Device{Name: "hp432", Host: "127.0.0.1", Port: port, Community: "public"}
	c := New(0, 150*time.Millisecond, 0, false)

	m := c.pollDevice(context.Background(), dev)
	if m.PageCount == nil || *m.PageCount != 12345 {
		t.Fatalf("PageCount = %v, want 12345 (read by GET)", m.PageCount)
	}
}

func TestPageCountIsNilWhenNotReadable(t *testing.T) {
	agent := startFakeAgent(t, []gosnmp.SnmpPDU{
		{Name: oidSysDescr, Type: gosnmp.OctetString, Value: []byte("no marker table")},
	})
	port := uint16(agent.conn.LocalAddr().(*net.UDPAddr).Port)
	c := New(0, 150*time.Millisecond, 0, false)

	m := c.pollDevice(context.Background(), config.Device{Host: "127.0.0.1", Port: port, Community: "public"})
	if !m.Online {
		t.Fatalf("device should be online (GET answered): %s", m.Error)
	}
	if m.PageCount != nil {
		t.Fatalf("PageCount = %d, want nil - an unreadable counter must not look like a real 0", *m.PageCount)
	}
}
