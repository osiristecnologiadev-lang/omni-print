package usbprint

import "testing"

func TestParsePJL(t *testing.T) {
	cases := []struct {
		name  string
		reply string
		id    string
		count int64
	}{
		{"hp", "@PJL INFO ID\r\n\"HP LaserJet Pro M404dn\"\r\n\f@PJL INFO PAGECOUNT\r\nPAGECOUNT=12345\r\n\f", "HP LaserJet Pro M404dn", 12345},
		{"bare number", "@PJL INFO ID\r\n\"Brother HL-L5100DN series\"\r\n\f@PJL INFO PAGECOUNT\r\n987654\r\n\f", "Brother HL-L5100DN series", 987654},
		{"no pagecount support", "@PJL INFO ID\r\n\"KYOCERA ECOSYS P2040dn\"\r\n\f@PJL INFO PAGECOUNT\r\n?\r\n\f", "KYOCERA ECOSYS P2040dn", 0},
		{"empty", "", "", 0},
	}
	for _, c := range cases {
		r := parsePJL(c.reply)
		if r.ID != c.id {
			t.Errorf("%s: id = %q, want %q", c.name, r.ID, c.id)
		}
		got := int64(0)
		if r.PageCount != nil {
			got = *r.PageCount
		}
		if got != c.count {
			t.Errorf("%s: count = %d, want %d", c.name, got, c.count)
		}
	}
}

func TestModelFromDriver(t *testing.T) {
	cases := map[string]string{
		"HP LaserJet Pro M404-M405 PCL-6 (V4)":             "HP LaserJet Pro M404-M405",
		"Brother HL-L2350DW series":                        "Brother HL-L2350DW",
		"HP Laser MFP 432 PCL6":                            "HP Laser MFP 432",
		"EPSON L3250 Series":                               "EPSON L3250",
		"HP Universal Printing PCL 6":                      "",
		"Microsoft IPP Class Driver":                       "",
		"Samsung M337x 387x 407x Series PCL6 Class Driver": "Samsung M337x 387x 407x",
	}
	for in, want := range cases {
		if got := modelFromDriver(in); got != want {
			t.Errorf("modelFromDriver(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUSBSerial(t *testing.T) {
	cases := map[string]string{
		`USB\VID_03F0&PID_8A17\VNB3K33221`:   "VNB3K33221",
		`USB\VID_04F9&PID_0062\E73475K9N12`:  "E73475K9N12",
		`USB\VID_04B8&PID_1186\6&1A2B3C&0&1`: "",
		`garbage`:                            "",
	}
	for in, want := range cases {
		if got := usbSerial(in); got != want {
			t.Errorf("usbSerial(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseDeviceID(t *testing.T) {
	id := parseDeviceID("MFG:Hewlett-Packard;CMD:PJL,PCL,PCLXL,POSTSCRIPT;MDL:HP LaserJet Pro M404dn;CLS:PRINTER;SN:PHBLB12345;")
	if !id.speaksPJL() || id.fullModel() != "HP LaserJet Pro M404dn" || id.Serial != "PHBLB12345" {
		t.Errorf("hp: %+v model=%q", id, id.fullModel())
	}
	gdi := parseDeviceID("MFG:Hewlett-Packard;MDL:HP LaserJet Professional P1102;CMD:ACL,ZJS,PJL-ZJS;CLS:PRINTER;")
	if gdi.speaksPJL() {
		t.Errorf("host-based printer must not be sent PJL: %+v", gdi)
	}
	epson := parseDeviceID("MFG:EPSON;CMD:ESCPL2,BDC,D4,D4PX,ESCPR1;MDL:L3250 Series;CLS:PRINTER;")
	if epson.speaksPJL() || epson.fullModel() != "EPSON L3250 Series" {
		t.Errorf("epson: %+v model=%q", epson, epson.fullModel())
	}
	brother := parseDeviceID("MFG:Brother;CMD:PJL,PCL,PCLXL,URF;MDL:HL-L5100DN series;CLS:PRINTER;")
	if !brother.speaksPJL() || brother.fullModel() != "Brother HL-L5100DN series" {
		t.Errorf("brother: %+v model=%q", brother, brother.fullModel())
	}
}
