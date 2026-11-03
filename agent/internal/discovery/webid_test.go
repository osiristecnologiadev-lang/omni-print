package discovery

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestParseWebIdentity(t *testing.T) {
	cases := []struct {
		name, title, body, server string
		ok                        bool
		model, serial             string
		label                     bool
	}{
		{"hp 4303 title + serial in a table", "HP Color LaserJet Pro MFP 4303fdw",
			`<td>Número de série</td><td>BRBST4S07W</td>`, "", true, "HP Color LaserJet Pro MFP 4303fdw", "BRBST4S07W", false},
		{"old cp1515n page", "hp Color LaserJet CP1515n&nbsp;&nbsp;&nbsp;10.0.0.5",
			`<b>Serial Number:</b> CNB1234567`, "", true, "hp Color LaserJet CP1515n", "CNB1234567", false},
		{"samsung", "SyncThru Web Service", `<div>Samsung M408x Series</div> Serial No. 088WB07K813RWWN`, "", true,
			"Samsung M408x Series", "088WB07K813RWWN", false},
		{"zebra is a label printer", "Zebra Technologies ZTC ZD220", "", "", true, "", "", true},
		{"router page", "Login", `<p>Mikrotik RouterOS</p>`, "", false, "", "", false},
		{"cookie must not match oki", "Portal", `<script>document.cookie</script>`, "", false, "", "", false},
		{"serial word that isn't a serial", "HP LaserJet M404", `Serial number: UNAVAILABLE`, "", true, "HP LaserJet M404", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, ok := parseWebIdentity(c.title, c.body, c.server)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v (%+v)", ok, c.ok, id)
			}
			if !ok {
				return
			}
			if id.Label != c.label {
				t.Errorf("label = %v, want %v", id.Label, c.label)
			}
			if c.model != "" && id.Model != c.model {
				t.Errorf("model = %q, want %q", id.Model, c.model)
			}
			if id.Serial != c.serial {
				t.Errorf("serial = %q, want %q", id.Serial, c.serial)
			}
		})
	}
}

func cidr(t *testing.T, s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestJetdirectScopeLeavesBigRangesOut(t *testing.T) {
	own := []*net.IPNet{cidr(t, "192.168.48.0/22")}
	neigh := []*net.IPNet{cidr(t, "192.168.52.0/24")}
	others := []*net.IPNet{cidr(t, "10.0.0.0/16"), cidr(t, "172.31.20.0/24")}
	scope := jetdirectScope(own, neigh, others)
	if len(scope) != 3 {
		t.Fatalf("scope = %v, want own + neighbour + the /24 only", scope)
	}
	silent := []net.IP{net.ParseIP("192.168.50.7"), net.ParseIP("10.0.5.5"), net.ParseIP("172.31.20.9"), net.ParseIP("192.168.49.44")}
	got := jetdirectCandidates(silent, scope, map[string]bool{"192.168.49.44": true})
	if len(got) != 2 || got[0].String() != "192.168.50.7" || got[1].String() != "172.31.20.9" {
		t.Fatalf("candidates = %v", got)
	}
}

// A fake printer on 127.0.0.1: tcp/9100 open and a web page naming a 4303.
func TestJetdirectPrintersFindsAPrinterWithoutSNMP(t *testing.T) {
	raw, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	go func() {
		for {
			c, err := raw.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><title>HP Color LaserJet Pro MFP 4303fdw</title><body>Serial Number: BRBST4S07W</body></html>`)
	}))
	defer page.Close()

	_, rawPort, _ := net.SplitHostPort(raw.Addr().String())
	_, webPort, _ := net.SplitHostPort(page.Listener.Addr().String())
	oldJet, oldWeb := jetdirectPort, webPorts
	jetdirectPort, _ = strconv.Atoi(rawPort)
	wp, _ := strconv.Atoi(webPort)
	webPorts = []struct {
		scheme string
		port   int
	}{{"http", wp}}
	defer func() { jetdirectPort, webPorts = oldJet, oldWeb }()

	devs := jetdirectPrinters(context.Background(), []net.IP{net.ParseIP("127.0.0.1")}, "public")
	if len(devs) != 1 {
		t.Fatalf("devices = %+v", devs)
	}
	d := devs[0]
	if !d.NoSNMP || d.WebModel != "HP Color LaserJet Pro MFP 4303fdw" || d.WebSerial != "BRBST4S07W" || d.Host != "127.0.0.1" {
		t.Fatalf("device = %+v", d)
	}
}
