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

func startFakeAgent(t *testing.T, pdus []gosnmp.SnmpPDU) *fakeAgent {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	a := &fakeAgent{conn: conn, vals: map[string]gosnmp.SnmpPDU{}}
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
		switch req.PDUType {
		case gosnmp.GetBulkRequest:
			a.bulks++
			continue // never answered
		case gosnmp.GetRequest:
			for _, v := range req.Variables {
				name := strings.TrimPrefix(v.Name, ".")
				if p, ok := a.vals[name]; ok {
					out = append(out, p)
				} else {
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.NoSuchObject})
				}
			}
		case gosnmp.GetNextRequest:
			for _, v := range req.Variables {
				name := strings.TrimPrefix(v.Name, ".")
				i := sort.Search(len(a.oids), func(i int) bool { return oidLess(name, a.oids[i]) })
				if i < len(a.oids) {
					out = append(out, a.vals[a.oids[i]])
				} else {
					out = append(out, gosnmp.SnmpPDU{Name: name, Type: gosnmp.EndOfMibView})
				}
			}
		default:
			continue
		}
		resp := &gosnmp.SnmpPacket{
			Version:   gosnmp.Version2c,
			Community: req.Community,
			PDUType:   gosnmp.GetResponse,
			RequestID: req.RequestID,
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
