// Package usbprint monitors printers plugged into THIS computer by USB -
// printers with no network address, which SNMP discovery can never reach.
// Installing the agent on the PC the printer hangs off is enough.
//
// Per printer, every poll:
//   - identity: the Windows print queue (name, driver = model) on a USBnnn
//     port, and the USB device's own serial number when it has one (most
//     HP/Brother/Kyocera/Epson units report the printer's serial there);
//   - page counter, best source first:
//     1. the printer's own lifetime counter, asked over USB with PJL
//     (@PJL INFO PAGECOUNT) - what most lasers (HP, Brother, Kyocera,
//     Lexmark, Ricoh, Samsung...) answer. Only sent to a printer whose
//     IEEE 1284 id lists PJL in its command set (a host-based "GDI"
//     printer could print an unknown command as a page of garbage), and
//     never while a job is queued, so it can't land inside a print job;
//     2. a printer without PJL (host-based lasers, most inkjets): pages counted
//     from Windows' own print log (PrintService/Operational, event 307),
//     kept by the agent from the day it starts. That only sees what is
//     printed FROM this PC - not copies made on the printer itself.
//     A printer that has answered PJL once stays on PJL: mixing the two
//     sources would make the counter jump.
//
// Reported like any other printer, with Host "USB:<computer>/<port>" (no IP)
// and the counter source in SysDescr so the panel can show it.
package usbprint

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// Counter sources, as stored in the state file and shown in SysDescr.
const (
	SourcePJL     = "pjl"
	SourceWindows = "windows"
)

// HostPrefix marks a USB printer's Host - svc must not treat it as an
// address (it isn't "outside the agent's network").
const HostPrefix = "USB:"

// IsUSBHost reports whether host names a USB printer rather than an address.
func IsUSBHost(host string) bool { return strings.HasPrefix(host, HostPrefix) }

// pjlReply is what a printer answered to the PJL inquiry.
type pjlReply struct {
	ID        string
	PageCount *int64
}

var pjlNumber = regexp.MustCompile(`^\s*(?:PAGECOUNT\s*=\s*)?(\d+)`)

// parsePJL reads a reply to "@PJL INFO ID" + "@PJL INFO PAGECOUNT". Each
// answer echoes its command line, then the value on the next line(s):
//
//	@PJL INFO ID
//	"HP LaserJet Pro M404dn"
//	@PJL INFO PAGECOUNT
//	PAGECOUNT=12345        (some models: just 12345)
func parsePJL(reply string) pjlReply {
	var r pjlReply
	lines := strings.FieldsFunc(reply, func(c rune) bool { return c == '\r' || c == '\n' || c == '\f' })
	for i := 0; i < len(lines); i++ {
		cmd := strings.ToUpper(strings.TrimSpace(lines[i]))
		if i+1 >= len(lines) {
			break
		}
		next := strings.TrimSpace(lines[i+1])
		switch {
		case strings.HasPrefix(cmd, "@PJL INFO ID"):
			if id := strings.Trim(next, `"`); id != "" && !strings.HasPrefix(id, "?") && !strings.HasPrefix(strings.ToUpper(id), "@PJL") {
				r.ID = strings.TrimSpace(id)
			}
		case strings.HasPrefix(cmd, "@PJL INFO PAGECOUNT"):
			if m := pjlNumber.FindStringSubmatch(next); m != nil {
				if n, err := strconv.ParseInt(m[1], 10, 64); err == nil && n > 0 {
					r.PageCount = &n
				}
			}
		}
	}
	return r
}

// deviceID is a printer's IEEE 1284 device id, which every USB printer
// reports: "MFG:Hewlett-Packard;MDL:HP LaserJet Pro M404dn;CMD:PJL,PCL,PCLXL,POSTSCRIPT;SN:PHBL123456;".
type deviceID struct {
	Manufacturer, Model, Serial string
	Commands                    []string
}

func parseDeviceID(raw string) deviceID {
	var id deviceID
	for _, field := range strings.Split(raw, ";") {
		k, v, ok := strings.Cut(field, ":")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		switch strings.ToUpper(strings.TrimSpace(k)) {
		case "MFG", "MANUFACTURER":
			id.Manufacturer = v
		case "MDL", "MODEL":
			id.Model = v
		case "SN", "SERN", "SERIALNUMBER":
			id.Serial = v
		case "CMD", "COMMAND SET":
			for _, c := range strings.Split(v, ",") {
				if c = strings.ToUpper(strings.TrimSpace(c)); c != "" {
					id.Commands = append(id.Commands, c)
				}
			}
		}
	}
	return id
}

// speaksPJL: only a printer that lists PJL in its command set is ever sent
// PJL - a host-based (GDI) printer may PRINT an unknown command as a page
// of garbage.
func (id deviceID) speaksPJL() bool {
	for _, c := range id.Commands {
		if c == "PJL" {
			return true
		}
	}
	return false
}

// fullModel: "HP LaserJet Pro M404dn" (MDL usually already starts with the
// brand; when it doesn't, MFG is put in front).
func (id deviceID) fullModel() string {
	if id.Model == "" {
		return ""
	}
	mfg := strings.Fields(id.Manufacturer)
	if len(mfg) > 0 && !strings.HasPrefix(strings.ToLower(id.Model), strings.ToLower(mfg[0])) &&
		!(strings.EqualFold(mfg[0], "Hewlett-Packard") && strings.HasPrefix(strings.ToUpper(id.Model), "HP")) {
		return id.Manufacturer + " " + id.Model
	}
	return id.Model
}

var driverNoise = regexp.MustCompile(`(?i)\s*(?:\(V\d\)|\bPCL[- ]?\d[\w.]*|\bPCL\b|\bPostScript\b|\bPS\b|\bXPS\b|\bGDI\b|\bUPD\b|\bClass Driver\b|\bBi-di\b|\bSeries\b|\bseries\b|\bPrinter\b)`)

// modelFromDriver turns a Windows driver name into a model:
// "HP LaserJet Pro M404-M405 PCL-6 (V4)" -> "HP LaserJet Pro M404-M405",
// "Brother HL-L2350DW series" -> "Brother HL-L2350DW". Universal/generic
// drivers name no model and give "".
func modelFromDriver(driver string) string {
	low := strings.ToLower(driver)
	for _, generic := range []string{"universal", "generic", "microsoft", "class driver", "ipp", "wsd"} {
		if strings.Contains(low, generic) && !strings.Contains(low, "series") {
			return ""
		}
	}
	m := driverNoise.ReplaceAllString(driver, "")
	return strings.Join(strings.Fields(m), " ")
}

// usbSerial takes the USB device instance's serial part, when it is a real
// serial: "USB\VID_03F0&PID_8A17\VNB3K33221" -> "VNB3K33221". Windows makes
// up an id with '&' in it ("6&1A2B3C&0&1") for devices without one.
func usbSerial(deviceInstance string) string {
	parts := strings.Split(deviceInstance, `\`)
	if len(parts) < 3 {
		return ""
	}
	s := strings.TrimSpace(parts[len(parts)-1])
	if len(s) < 5 || strings.Contains(s, "&") {
		return ""
	}
	return s
}

// state persists, per printer, which counter source it settled on and the
// Windows page count so far, plus the last print-log record read.
type state struct {
	LastRecordID uint64                   `json:"last_record_id"`
	Printers     map[string]*printerState `json:"printers"`
}

type printerState struct {
	Source       string `json:"source,omitempty"`
	WindowsPages int64  `json:"windows_pages"`
	PJLMisses    int    `json:"pjl_misses,omitempty"`
}

type stateFile struct {
	mu   sync.Mutex
	path string
	s    state
}

func loadState(dir string) *stateFile {
	f := &stateFile{path: filepath.Join(dir, "usb-printers.json"), s: state{Printers: map[string]*printerState{}}}
	if b, err := os.ReadFile(f.path); err == nil {
		_ = json.Unmarshal(b, &f.s)
		if f.s.Printers == nil {
			f.s.Printers = map[string]*printerState{}
		}
	}
	return f
}

func (f *stateFile) printer(key string) *printerState {
	p := f.s.Printers[key]
	if p == nil {
		p = &printerState{}
		f.s.Printers[key] = p
	}
	return p
}

func (f *stateFile) save() error {
	b, err := json.MarshalIndent(f.s, "", "  ")
	if err != nil {
		return err
	}
	tmp := f.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f.path)
}
