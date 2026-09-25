package discovery

import (
	"net"
	"testing"
)

func TestPortHost(t *testing.T) {
	tests := []struct {
		name   string
		port   string
		values map[string]string
		want   string
	}{
		// Real layout confirmed on a Windows host's Standard TCP/IP Port key.
		{"standard tcp/ip", "10.0.10.101", map[string]string{"HostName": "10.0.10.101", "IPAddress": ""}, "10.0.10.101"},
		{"hostname not ip", "Recepcao", map[string]string{"HostName": "impressora-recepcao.local"}, "impressora-recepcao.local"},
		{"older IPAddress", "Port1", map[string]string{"IPAddress": "192.168.5.20"}, "192.168.5.20"},
		{"lpr", "lpr1", map[string]string{"Server Name": "10.1.1.9"}, "10.1.1.9"},
		{"IP_ name fallback", "IP_172.16.0.40", nil, "172.16.0.40"},
		{"plain ip name fallback", "172.16.0.41", map[string]string{}, "172.16.0.41"},
		{"wsd port has no address", "WSD-2f6c1a1e-0000", nil, ""},
		{"local port", "LPT1:", nil, ""},
	}
	for _, tt := range tests {
		if got := portHost(tt.port, tt.values); got != tt.want {
			t.Errorf("%s: portHost(%q) = %q, want %q", tt.name, tt.port, got, tt.want)
		}
	}
}

func TestMergeTargetsDedupesAndPrefersPortCommunity(t *testing.T) {
	base := []target{
		{IP: net.ParseIP("10.0.0.1").To4(), Community: "public"},
		{IP: net.ParseIP("10.0.0.2").To4(), Community: "public"},
	}
	extra := []target{
		{IP: net.ParseIP("10.0.0.2").To4(), Community: "sabin-ro"}, // also in the swept subnet
		{IP: net.ParseIP("10.9.0.7").To4(), Community: "public"},   // other subnet, only the port knows it
	}
	got := mergeTargets(base, extra)
	if len(got) != 3 {
		t.Fatalf("expected 3 targets after dedupe, got %d: %v", len(got), got)
	}
	if got[1].Community != "sabin-ro" {
		t.Errorf("10.0.0.2 community = %q, want the port's own %q", got[1].Community, "sabin-ro")
	}
	if got[2].IP.String() != "10.9.0.7" {
		t.Errorf("third target = %s, want 10.9.0.7", got[2].IP)
	}
}

func TestPortHostDuplicateSuffix(t *testing.T) {
	// Windows names a second port to the same printer "<ip>_1".
	for _, name := range []string{"10.80.40.5_1", "IP_10.80.40.5_2"} {
		if got := portHost(name, nil); got != "10.80.40.5" {
			t.Errorf("portHost(%q) = %q, want 10.80.40.5", name, got)
		}
	}
}

func TestPortNameHost(t *testing.T) {
	tests := map[string]string{
		"10.80.40.5":                "10.80.40.5",
		"IP_10.80.40.5":             "10.80.40.5",
		"impressora-rh.sabin.local": "impressora-rh.sabin.local",
		"WSD-2f6c1a1e-0000":         "",
		"USB001":                    "",
		"LPT1:":                     "",
		"COM1":                      "",
		"PORTPROMPT:":               "",
		"nul:":                      "",
		"TS001":                     "",
		"Microsoft Print to PDF":    "",
		`\srv-print\Recepcao`:       "",
	}
	for name, want := range tests {
		if got := portNameHost(name); got != want {
			t.Errorf("portNameHost(%q) = %q, want %q", name, got, want)
		}
	}
}

// Real port names from Sabin's print servers (2026-09-25 log).
func TestPortHostEmbeddedAddress(t *testing.T) {
	tests := map[string]string{
		"PAPERCUT_10.96.32.10": "10.96.32.10",
		"X_10_96_16_12":        "10.96.16.12",
		"10.80.40.5_1":         "10.80.40.5",
		"USB001":               "",
		"pdfcmon":              "",
		"WSD-3ecf7f0d-8d63-4da9-b2ce-97f66287a3a4": "",
		"X_10_96_16_300": "",
		"PORT_1.2.3":     "",
	}
	for name, want := range tests {
		if got := portHost(name, nil); got != want {
			t.Errorf("portHost(%q) = %q, want %q", name, got, want)
		}
	}
}
