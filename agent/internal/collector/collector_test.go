package collector

import (
	"testing"

	"github.com/gosnmp/gosnmp"
)

// Real numbers from probing actual devices on 2026-09-03 (see collector.go's
// collectMarkerSplit comment) - this is the regression lock for the mono/
// color billing-safety check, not just a shape test.
func TestSplitReconciles(t *testing.T) {
	tests := []struct {
		name               string
		mono, color, total int64
		want               bool
	}{
		{"real HP Color LaserJet MFP M180nw - exact match", 2365, 15836, 18201, true},
		{"real HPF359FC mono LaserJet - color 0, exact match", 41685, 0, 41685, true},
		{"real HPF3792A mono LaserJet - ~6140 pages unaccounted for", 48101, 0, 54241, false},
		{"real HPE0D2EA mono LaserJet - huge gap", 7937, 0, 51171, false},
		{"within tolerance - a page ticked over mid-poll", 100, 50, 152, true},
		{"exactly at tolerance boundary", 100, 50, 155, true},
		{"one page past tolerance boundary", 100, 50, 156, false},
		{"split reports more than total - still rejected", 200, 200, 100, false},
		{"zero everywhere", 0, 0, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := splitReconciles(tt.mono, tt.color, tt.total); got != tt.want {
				t.Errorf("splitReconciles(%d, %d, %d) = %v, want %v", tt.mono, tt.color, tt.total, got, tt.want)
			}
		})
	}
}

func TestCleanString(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"NUL-padded field (real HP bug)", "VNB3K33304\x00\x00\x00", "VNB3K33304"},
		{"space-padded field (real Samsung behavior)", "  088WB07MA175LTM   ", "088WB07MA175LTM"},
		{"tab preserved, only other control chars stripped", "a\tb", "a\tb"},
		{"embedded NUL mid-string", "HP Color\x00LaserJet", "HP ColorLaserJet"},
		{"already clean", "clean value", "clean value"},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cleanString(tt.in); got != tt.want {
				t.Errorf("cleanString(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestGuessColorantFromDescription(t *testing.T) {
	tests := []struct {
		description string
		want        string
	}{
		{"Cyan Cartridge HP CF511A", "cyan"},
		{"Magenta Cartridge HP CF513A", "magenta"},
		{"Yellow Cartridge HP CF512A", "yellow"},
		{"Black Cartridge HP CF510A", "black"},
		{"Cartucho Ciano", "cyan"},
		{"Cartucho Preto", "black"},
		{"Cartucho Amarelo", "yellow"},
		{"Waste Toner Container", ""},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			if got := guessColorantFromDescription(tt.description); got != tt.want {
				t.Errorf("guessColorantFromDescription(%q) = %q, want %q", tt.description, got, tt.want)
			}
		})
	}
}

func TestDecodeErrorState(t *testing.T) {
	// bit 2 (LowToner) and bit 5 (Jammed) set: byte0 = 00100100 = 0x24
	b := []byte{0x24}
	got := decodeErrorState(b)
	if !got.LowToner || !got.Jammed {
		t.Errorf("expected LowToner and Jammed set, got %+v", got)
	}
	if got.NoPaper || got.DoorOpen || got.Offline {
		t.Errorf("expected only LowToner/Jammed set, got %+v", got)
	}

	// bit 8 (InputTrayMissing) lives in the second byte
	b2 := []byte{0x00, 0x80}
	got2 := decodeErrorState(b2)
	if !got2.InputTrayMissing {
		t.Errorf("expected InputTrayMissing set from second byte, got %+v", got2)
	}

	// shorter than the highest bit referenced - must not panic, missing bits read false
	got3 := decodeErrorState([]byte{})
	if got3.LowPaper || got3.OverduePreventMaint {
		t.Errorf("expected all-false ErrorState for empty input, got %+v", got3)
	}
}

func TestIndexOf(t *testing.T) {
	tests := []struct {
		pduName, base, want string
	}{
		{".1.3.6.1.2.1.43.10.2.1.4.1.1", "1.3.6.1.2.1.43.10.2.1.4.1", "1"},
		{".1.3.6.1.2.1.43.11.1.1.9.1.4", "1.3.6.1.2.1.43.11.1.1.9.1", "4"},
	}
	for _, tt := range tests {
		if got := indexOf(tt.pduName, tt.base); got != tt.want {
			t.Errorf("indexOf(%q, %q) = %q, want %q", tt.pduName, tt.base, got, tt.want)
		}
	}
}

func TestStatusLabels(t *testing.T) {
	if got := printerStatusLabel(4); got != "printing" {
		t.Errorf("printerStatusLabel(4) = %q, want printing", got)
	}
	if got := printerStatusLabel(99); got != "unknown(99)" {
		t.Errorf("printerStatusLabel(99) = %q, want unknown(99)", got)
	}
	if got := deviceStatusLabel(2); got != "running" {
		t.Errorf("deviceStatusLabel(2) = %q, want running", got)
	}
	if got := deviceStatusLabel(-1); got != "unknown(-1)" {
		t.Errorf("deviceStatusLabel(-1) = %q, want unknown(-1)", got)
	}
	if got := alertSeverityLabel(3); got != "critical" {
		t.Errorf("alertSeverityLabel(3) = %q, want critical", got)
	}
	if got := supplyClassLabel(3); got != "supply" {
		t.Errorf("supplyClassLabel(3) = %q, want supply", got)
	}
}

func TestGetIntOK(t *testing.T) {
	vars := map[string]gosnmp.SnmpPDU{
		".1.2.3": {Name: ".1.2.3", Type: gosnmp.Integer, Value: 42},
		".1.2.4": {Name: ".1.2.4", Type: gosnmp.NoSuchObject, Value: nil},
		".1.2.5": {Name: ".1.2.5", Type: gosnmp.NoSuchInstance, Value: nil},
	}

	if v, ok := getIntOK(vars, "1.2.3"); !ok || v != 42 {
		t.Errorf("getIntOK present value = (%d, %v), want (42, true)", v, ok)
	}
	if _, ok := getIntOK(vars, "1.2.4"); ok {
		t.Errorf("getIntOK on NoSuchObject should be (_, false)")
	}
	if _, ok := getIntOK(vars, "1.2.5"); ok {
		t.Errorf("getIntOK on NoSuchInstance should be (_, false)")
	}
	if _, ok := getIntOK(vars, "1.2.6"); ok {
		t.Errorf("getIntOK on a missing OID should be (_, false)")
	}
}

func TestGetString(t *testing.T) {
	vars := map[string]gosnmp.SnmpPDU{
		".1.2.3": {Name: ".1.2.3", Type: gosnmp.OctetString, Value: []byte("VNB3K33304\x00\x00")},
	}
	if got := getString(vars, "1.2.3"); got != "VNB3K33304" {
		t.Errorf("getString = %q, want VNB3K33304 (NUL-stripped)", got)
	}
	if got := getString(vars, "1.2.99"); got != "" {
		t.Errorf("getString on missing OID = %q, want empty", got)
	}
}
