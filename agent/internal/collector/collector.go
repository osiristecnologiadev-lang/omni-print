// Package collector polls printers over SNMP (Printer-MIB, RFC 3805, and
// Host Resources MIB, RFC 2790) and reports as much data as each device
// exposes: identity, status/error flags, page counts, supply levels, paper
// trays and active alerts.
//
// Enum mappings below (status codes, supply class, alert severity, error
// bits) follow RFC 3805 and were cross-checked against a real Samsung
// M4080FX (see agent/README.md for what was confirmed vs. still unverified).
// Many Printer-MIB integer fields use -1 for "unknown" and -2 for "not
// supported by this device" - these are legitimate values, not parse
// failures; don't treat a negative level/capacity as an error.
//
// When full_raw_capture is enabled, every OID under the Printer-MIB subtree
// is also captured verbatim in Metric.Raw as a cross-check/catch-all.
package collector

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/omniprint/agent/internal/config"
)

const (
	// System group (SNMPv2-MIB)
	oidSysDescr    = "1.3.6.1.2.1.1.1.0"
	oidSysUpTime   = "1.3.6.1.2.1.1.3.0"
	oidSysContact  = "1.3.6.1.2.1.1.4.0"
	oidSysName     = "1.3.6.1.2.1.1.5.0"
	oidSysLocation = "1.3.6.1.2.1.1.6.0"

	// Host Resources MIB - device/printer status.
	// Single-engine assumption: hrDeviceIndex=1 (true for the vast majority
	// of network printers/MFPs, which expose exactly one print engine).
	oidHrDeviceStatus      = "1.3.6.1.2.1.25.3.2.1.5.1"
	oidHrPrinterStatus     = "1.3.6.1.2.1.25.3.5.1.1.1"
	oidHrPrinterErrorState = "1.3.6.1.2.1.25.3.5.1.2.1"

	// Printer-MIB general info
	oidPrinterName  = "1.3.6.1.2.1.43.5.1.1.16.1"
	oidSerialNumber = "1.3.6.1.2.1.43.5.1.1.17.1"

	// Printer-MIB marker (print engine) counters. Trailing ".1" fixes
	// hrDeviceIndex=1 (see the Host Resources comment above); prtMarkerIndex
	// itself is walked, not hardcoded to 1, for the rare device with more
	// than one marker (e.g. separate impression/copy engines) - RFC 3805
	// doesn't reserve a specific marker index for "mono" vs "color", so this
	// walk-and-sum is about correctness for multi-marker devices in general,
	// not a source of the mono/color split (see collectMarkerSplit for that).
	oidPageCountCol = "1.3.6.1.2.1.43.10.2.1.4.1"
	oidPowerOnCount = "1.3.6.1.2.1.43.10.2.1.11.1.1"

	// HP-private mono/color page count split (HP enterprise number
	// 1.3.6.1.4.1.11) - see collectMarkerSplit for how this was verified
	// against a real device rather than guessed. HP-only; every other
	// vendor's devices simply don't have these OIDs.
	oidHPTotalMonoPageCount  = "1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0"
	oidHPTotalColorPageCount = "1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.7.0"

	// Printer-MIB marker supplies table columns (walked; trailing ".1" fixes
	// hrDeviceIndex=1, the walk iterates prtMarkerSuppliesIndex)
	oidSuppliesClass    = "1.3.6.1.2.1.43.11.1.1.4.1"
	oidSuppliesType     = "1.3.6.1.2.1.43.11.1.1.5.1"
	oidSuppliesDescr    = "1.3.6.1.2.1.43.11.1.1.6.1"
	oidSuppliesUnit     = "1.3.6.1.2.1.43.11.1.1.7.1"
	oidSuppliesMax      = "1.3.6.1.2.1.43.11.1.1.8.1"
	oidSuppliesLevel    = "1.3.6.1.2.1.43.11.1.1.9.1"
	oidSuppliesColorant = "1.3.6.1.2.1.43.11.1.1.10.1"

	// Printer-MIB marker colorant table (walked) - maps a colorant index to
	// a human name ("black", "cyan", ...); referenced by prtMarkerSuppliesColorantIndex.
	oidColorantValue = "1.3.6.1.2.1.43.12.1.1.4.1"

	// Printer-MIB input tray table (walked)
	oidInputMaxCapacity = "1.3.6.1.2.1.43.8.2.1.9.1"
	oidInputLevel       = "1.3.6.1.2.1.43.8.2.1.10.1"
	oidInputStatus      = "1.3.6.1.2.1.43.8.2.1.11.1"
	oidInputMediaName   = "1.3.6.1.2.1.43.8.2.1.12.1"
	oidInputName        = "1.3.6.1.2.1.43.8.2.1.13.1"

	// Printer-MIB alert table (walked) - currently active alerts/warnings
	oidAlertSeverity    = "1.3.6.1.2.1.43.18.1.1.2.1"
	oidAlertCode        = "1.3.6.1.2.1.43.18.1.1.7.1"
	oidAlertDescription = "1.3.6.1.2.1.43.18.1.1.8.1"

	// Printer-MIB console display (walked) - the literal text shown on the
	// device's own front panel, e.g. "Printing" / "Imprimindo". Confirmed
	// against real hardware: a Samsung M4080FX returned "Imprimindo" here
	// while mid-print, matching prtGeneralPrinterStatus.
	oidConsoleDisplay = "1.3.6.1.2.1.43.16.5.1.2.1"

	// Whole Printer-MIB subtree, walked as a catch-all so nothing exposed by
	// the device - including vendor-specific extensions - gets missed by the
	// hand-picked columns above.
	oidPrinterMIB = "1.3.6.1.2.1.43"
)

type ErrorState struct {
	LowPaper            bool `json:"low_paper,omitempty"`
	NoPaper             bool `json:"no_paper,omitempty"`
	LowToner            bool `json:"low_toner,omitempty"`
	NoToner             bool `json:"no_toner,omitempty"`
	DoorOpen            bool `json:"door_open,omitempty"`
	Jammed              bool `json:"jammed,omitempty"`
	Offline             bool `json:"offline,omitempty"`
	ServiceRequested    bool `json:"service_requested,omitempty"`
	InputTrayMissing    bool `json:"input_tray_missing,omitempty"`
	OutputTrayMissing   bool `json:"output_tray_missing,omitempty"`
	MarkerSupplyMissing bool `json:"marker_supply_missing,omitempty"`
	OutputNearFull      bool `json:"output_near_full,omitempty"`
	OutputFull          bool `json:"output_full,omitempty"`
	InputTrayEmpty      bool `json:"input_tray_empty,omitempty"`
	OverduePreventMaint bool `json:"overdue_prevent_maint,omitempty"`
}

type Supply struct {
	Description string `json:"description"`
	Class       string `json:"class,omitempty"`
	TypeCode    int64  `json:"type_code,omitempty"` // PrtMarkerSuppliesTypeTC (RFC 3805) - see Metric.Raw to decode
	UnitCode    int64  `json:"unit_code,omitempty"` // PrtCapacityUnitTC (RFC 3805) - see Metric.Raw to decode
	Colorant    string `json:"colorant,omitempty"`
	Level       int64  `json:"level"`
	MaxLevel    int64  `json:"max_level"`
}

type Tray struct {
	Name        string `json:"name,omitempty"`
	MediaName   string `json:"media_name,omitempty"`
	StatusCode  int64  `json:"status_code"`
	MaxCapacity int64  `json:"max_capacity"`
	Level       int64  `json:"level"`
}

type Alert struct {
	Severity    string `json:"severity"`
	Code        int64  `json:"code"`
	Description string `json:"description,omitempty"`
}

type Metric struct {
	DeviceName  string    `json:"device_name"`
	Host        string    `json:"host"`
	CollectedAt time.Time `json:"collected_at"`
	Online      bool      `json:"online"`

	SysDescr    string `json:"sys_descr,omitempty"`
	SysName     string `json:"sys_name,omitempty"`
	SysLocation string `json:"sys_location,omitempty"`
	SysContact  string `json:"sys_contact,omitempty"`
	UptimeTicks int64  `json:"uptime_ticks"` // hundredths of a second (SNMP TimeTicks) - 0 right after a reboot is valid

	PrinterName  string `json:"printer_name,omitempty"`
	SerialNumber string `json:"serial_number,omitempty"`

	// ConsoleDisplay is the literal text shown on the device's own front
	// panel right now (e.g. "Printing", "Ready", "Door Open").
	ConsoleDisplay string `json:"console_display,omitempty"`

	PrinterStatusCode int64      `json:"printer_status_code,omitempty"`
	PrinterStatus     string     `json:"printer_status,omitempty"`
	DeviceStatusCode  int64      `json:"device_status_code,omitempty"`
	DeviceStatus      string     `json:"device_status,omitempty"`
	ErrorState        ErrorState `json:"error_state,omitempty"`

	// PageCount/PowerOnCount: 0 is a valid count (brand new device), -1
	// means "unknown", -2 means "not supported by this device" (RFC 3805) -
	// these are never omitted so consumers can tell "zero" from "missing".
	PageCount    int64 `json:"page_count"`
	PowerOnCount int64 `json:"power_on_count"`

	// MonoPageCount/ColorPageCount: a per-colorant split of PageCount, when
	// this device exposes one. Pointers (not plain int64 like PageCount)
	// because "not available" has to be distinguishable from a real zero -
	// nil means omit, so the backend can tell "this device can't split" from
	// "this device split and got zero color pages this period". See
	// collectMarkerSplit for why this returns nil for every device tested so
	// far - not a bug, a real gap that needs a real color device to close.
	MonoPageCount  *int64 `json:"mono_page_count,omitempty"`
	ColorPageCount *int64 `json:"color_page_count,omitempty"`

	Supplies   []Supply `json:"supplies,omitempty"`
	InputTrays []Tray   `json:"input_trays,omitempty"`
	Alerts     []Alert  `json:"alerts,omitempty"`

	// Raw holds every OID under the Printer-MIB subtree, verbatim, as a
	// catch-all - populated only when full_raw_capture is enabled.
	Raw map[string]string `json:"raw,omitempty"`

	Error string `json:"error,omitempty"`
}

type Collector struct {
	requestDelay   time.Duration
	timeout        time.Duration
	retries        int
	fullRawCapture bool
}

func New(requestDelay, timeout time.Duration, retries int, fullRawCapture bool) *Collector {
	return &Collector{
		requestDelay:   requestDelay,
		timeout:        timeout,
		retries:        retries,
		fullRawCapture: fullRawCapture,
	}
}

// PollAll queries every configured device one at a time, pausing requestDelay
// between them. The pause is deliberate: bursting SNMP requests at many hosts
// back-to-back is exactly the pattern IDS/EDR heuristics flag as a port scan.
func (c *Collector) PollAll(ctx context.Context, devices []config.Device) []Metric {
	results := make([]Metric, 0, len(devices))
	for i, d := range devices {
		select {
		case <-ctx.Done():
			return results
		default:
		}
		results = append(results, c.pollDevice(d))
		if i < len(devices)-1 {
			time.Sleep(c.requestDelay)
		}
	}
	return results
}

func (c *Collector) pollDevice(d config.Device) Metric {
	m := Metric{DeviceName: d.Name, Host: d.Host, CollectedAt: time.Now().UTC()}

	g := &gosnmp.GoSNMP{
		Target:    d.Host,
		Port:      d.Port,
		Community: d.Community,
		Version:   gosnmp.Version2c,
		Timeout:   c.timeout,
		Retries:   c.retries,
	}

	if err := g.Connect(); err != nil {
		m.Error = fmt.Sprintf("connect: %v", err)
		return m
	}
	defer g.Conn.Close()

	scalarOIDs := []string{
		oidSysDescr, oidSysUpTime, oidSysContact, oidSysName, oidSysLocation,
		oidHrDeviceStatus, oidHrPrinterStatus, oidHrPrinterErrorState,
		oidPrinterName, oidSerialNumber,
		oidPowerOnCount,
	}
	result, err := g.Get(scalarOIDs)
	if err != nil {
		m.Error = fmt.Sprintf("get: %v", err)
		return m
	}
	m.Online = true
	vars := varMap(result.Variables)

	m.SysDescr = getString(vars, oidSysDescr)
	m.SysName = getString(vars, oidSysName)
	m.SysLocation = getString(vars, oidSysLocation)
	m.SysContact = getString(vars, oidSysContact)
	m.UptimeTicks = getInt(vars, oidSysUpTime)
	m.PrinterName = getString(vars, oidPrinterName)
	m.SerialNumber = getString(vars, oidSerialNumber)
	m.DeviceStatusCode = getInt(vars, oidHrDeviceStatus)
	m.DeviceStatus = deviceStatusLabel(m.DeviceStatusCode)
	m.PrinterStatusCode = getInt(vars, oidHrPrinterStatus)
	m.PrinterStatus = printerStatusLabel(m.PrinterStatusCode)
	m.PageCount = c.walkPageCount(g)
	m.PowerOnCount = getInt(vars, oidPowerOnCount)
	m.MonoPageCount, m.ColorPageCount = c.collectMarkerSplit(g, m.PageCount)

	if p, ok := vars["."+oidHrPrinterErrorState]; ok {
		if b, ok := p.Value.([]byte); ok {
			m.ErrorState = decodeErrorState(b)
		}
	}

	m.ConsoleDisplay = c.walkConsoleDisplay(g)
	m.Supplies = c.walkSupplies(g)
	m.InputTrays = c.walkInputTrays(g)
	m.Alerts = c.walkAlerts(g)

	if c.fullRawCapture {
		m.Raw = c.walkRaw(g, oidPrinterMIB)
	}

	return m
}

// walkPageCount sums prtMarkerLifeCount across every prtMarkerIndex the
// device exposes. Confirmed against every real device tested this project
// (see agent/README.md) to expose exactly one marker, so this sums to the
// same single value oidPageCount used to read directly - the walk only
// changes behavior for a device with more than one marker, which none
// tested so far have had.
func (c *Collector) walkPageCount(g *gosnmp.GoSNMP) int64 {
	counts := map[string]int64{}
	walkInt(g, oidPageCountCol, counts)
	var total int64
	for _, v := range counts {
		if v > 0 {
			total += v
		}
	}
	return total
}

// markerSplitTolerancePages allows for a page or two ticking over between
// walkPageCount's GET and this one within the same poll (a customer
// actively printing at that exact instant) - not a license to accept a
// systematically wrong split, see collectMarkerSplit's reconciliation check.
const markerSplitTolerancePages = 5

// collectMarkerSplit reads HP's private mono/color total-page-count scalars
// (oidHPTotalMonoPageCount/oidHPTotalColorPageCount). RFC 3805's
// prtMarkerTable doesn't reserve marker indices for "mono" vs "color" - a
// color device's whole engine is typically one marker with one combined
// lifetime count - so a real split needs a vendor-specific OID, not
// guesswork: reporting a wrong split would silently corrupt a customer's
// bill (see ContractsService.resolveBilling on the backend for how this
// value is used).
//
// Both OID labels are independently confirmed by a third-party monitoring
// vendor's own published OID table for HP LaserJet Color MFPs ("Total
// Black/white printed Page Count" / "Total Color printed Page Count"), and
// on a real HP Color LaserJet MFP M180nw (2026-09-03) the two summed to
// exactly the same total walkPageCount already reports (2365 + 15836 =
// 18201).
//
// **But that agreement doesn't hold on every HP device**: probing 3 other
// real HP mono LaserJet units the same session, mono+color came back
// noticeably short of the true total (e.g. one read mono=48101 against a
// true total of 54241 - color read 0, so ~6,140 pages simply unaccounted
// for). The OID's own vendor label says "printed Page Count" - the working
// theory is it counts only host-originated print jobs, excluding walk-up
// copies/faxes that the standard prtMarkerLifeCount marker counter (which
// physically counts engine impressions regardless of source) still
// includes - but that's unconfirmed, and doesn't matter for correctness
// either way: whatever the cause, silently trusting an undercounting split
// would erase real pages from a customer's bill, the exact undercounting
// failure mode this project already hit once with the counter-reset logic
// (see counter.util.ts). So this reconciles mono+color against the poll's
// own already-trusted total (walkPageCount) before ever returning a split;
// anything off by more than markerSplitTolerancePages is treated as "this
// device's split isn't trustworthy" and returns (nil, nil) - same as a
// device that doesn't support the OID at all. This is why the mono-LaserJet
// units correctly stay nil (not a wrong split) despite the OIDs resolving.
//
// HP-only: these OIDs live under HP's enterprise number (1.3.6.1.4.1.11)
// and simply don't exist on other vendors' devices. SNMPv2c returns
// noSuchObject/noSuchInstance in-band for an unsupported OID rather than
// failing the whole GET, so this safely returns (nil, nil) on every non-HP
// device too, and billing correctly falls back to treating every page as
// mono, same as before this existed.
func (c *Collector) collectMarkerSplit(g *gosnmp.GoSNMP, totalPageCount int64) (mono *int64, color *int64) {
	result, err := g.Get([]string{oidHPTotalMonoPageCount, oidHPTotalColorPageCount})
	if err != nil {
		return nil, nil
	}
	vars := varMap(result.Variables)
	monoVal, monoOK := getIntOK(vars, oidHPTotalMonoPageCount)
	colorVal, colorOK := getIntOK(vars, oidHPTotalColorPageCount)
	if !monoOK || !colorOK {
		return nil, nil
	}
	if !splitReconciles(monoVal, colorVal, totalPageCount) {
		return nil, nil
	}
	return &monoVal, &colorVal
}

// splitReconciles reports whether mono+color is close enough to the poll's
// own already-trusted total (within markerSplitTolerancePages) to be
// reported at all - see collectMarkerSplit's comment for why this exists
// and isn't just an arithmetic nicety.
func splitReconciles(mono, color, total int64) bool {
	diff := (mono + color) - total
	if diff < 0 {
		diff = -diff
	}
	return diff <= markerSplitTolerancePages
}

func (c *Collector) walkSupplies(g *gosnmp.GoSNMP) []Supply {
	classes := map[string]int64{}
	types := map[string]int64{}
	descrs := map[string]string{}
	units := map[string]int64{}
	levels := map[string]int64{}
	maxes := map[string]int64{}
	colorantIdx := map[string]int64{}

	walkString(g, oidSuppliesDescr, descrs)
	walkInt(g, oidSuppliesClass, classes)
	walkInt(g, oidSuppliesType, types)
	walkInt(g, oidSuppliesUnit, units)
	walkInt(g, oidSuppliesLevel, levels)
	walkInt(g, oidSuppliesMax, maxes)
	walkInt(g, oidSuppliesColorant, colorantIdx)

	colorantNames := map[int64]string{}
	_ = g.BulkWalk(oidColorantValue, func(pdu gosnmp.SnmpPDU) error {
		idx := indexOf(pdu.Name, oidColorantValue)
		parts := strings.Split(idx, ".")
		ci, err := strconv.ParseInt(parts[len(parts)-1], 10, 64)
		if err != nil {
			return nil
		}
		if b, ok := pdu.Value.([]byte); ok {
			colorantNames[ci] = cleanString(string(b))
		}
		return nil
	})

	supplies := make([]Supply, 0, len(descrs))
	for idx, desc := range descrs {
		s := Supply{
			Description: desc,
			Class:       supplyClassLabel(classes[idx]),
			TypeCode:    types[idx],
			UnitCode:    units[idx],
			Level:       levels[idx],
			MaxLevel:    maxes[idx],
		}
		if name, ok := colorantNames[colorantIdx[idx]]; ok {
			s.Colorant = name
		}
		if s.Colorant == "" {
			s.Colorant = guessColorantFromDescription(desc)
		}
		supplies = append(supplies, s)
	}
	return supplies
}

// colorKeywords maps free-text words to a normalized colorant name, English
// and Portuguese only for now - extend as new languages turn up in the wild.
var colorKeywords = []struct {
	keyword string
	name    string
}{
	{"cyan", "cyan"},
	{"ciano", "cyan"},
	{"magenta", "magenta"},
	{"yellow", "yellow"},
	{"amarelo", "yellow"},
	{"black", "black"},
	{"preto", "black"},
}

// guessColorantFromDescription is a best-effort fallback for when a device
// doesn't populate prtMarkerSuppliesColorantIndex - confirmed against 2/2
// real devices tested (a monochrome Samsung and a color HP MFP) that it
// doesn't, even though the HP's colorant table itself was populated and
// reachable. Matches known color words in the supply's free-text
// description; leaves Colorant empty rather than guessing wrong for a
// description in a language not in colorKeywords.
func guessColorantFromDescription(description string) string {
	lower := strings.ToLower(description)
	for _, ck := range colorKeywords {
		if strings.Contains(lower, ck.keyword) {
			return ck.name
		}
	}
	return ""
}

func (c *Collector) walkInputTrays(g *gosnmp.GoSNMP) []Tray {
	names := map[string]string{}
	mediaNames := map[string]string{}
	statuses := map[string]int64{}
	maxes := map[string]int64{}
	levels := map[string]int64{}

	walkString(g, oidInputName, names)
	walkString(g, oidInputMediaName, mediaNames)
	walkInt(g, oidInputStatus, statuses)
	walkInt(g, oidInputMaxCapacity, maxes)
	walkInt(g, oidInputLevel, levels)

	seen := map[string]bool{}
	for idx := range maxes {
		seen[idx] = true
	}
	for idx := range levels {
		seen[idx] = true
	}
	for idx := range names {
		seen[idx] = true
	}

	trays := make([]Tray, 0, len(seen))
	for idx := range seen {
		trays = append(trays, Tray{
			Name:        names[idx],
			MediaName:   mediaNames[idx],
			StatusCode:  statuses[idx],
			MaxCapacity: maxes[idx],
			Level:       levels[idx],
		})
	}
	return trays
}

func (c *Collector) walkAlerts(g *gosnmp.GoSNMP) []Alert {
	severities := map[string]int64{}
	codes := map[string]int64{}
	descrs := map[string]string{}

	walkInt(g, oidAlertSeverity, severities)
	walkInt(g, oidAlertCode, codes)
	walkString(g, oidAlertDescription, descrs)

	alerts := make([]Alert, 0, len(descrs))
	for idx, desc := range descrs {
		alerts = append(alerts, Alert{
			Severity:    alertSeverityLabel(severities[idx]),
			Code:        codes[idx],
			Description: desc,
		})
	}
	return alerts
}

// walkConsoleDisplay reads the printer's front-panel display lines and joins
// them in display order (lines are numerically indexed, e.g. "1", "2", ...).
func (c *Collector) walkConsoleDisplay(g *gosnmp.GoSNMP) string {
	lines := map[string]string{}
	walkString(g, oidConsoleDisplay, lines)

	keys := make([]string, 0, len(lines))
	for k := range lines {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, _ := strconv.Atoi(keys[i])
		b, _ := strconv.Atoi(keys[j])
		return a < b
	})

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		if v := strings.TrimSpace(lines[k]); v != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " ")
}

func (c *Collector) walkRaw(g *gosnmp.GoSNMP, root string) map[string]string {
	raw := map[string]string{}
	_ = g.BulkWalk(root, func(pdu gosnmp.SnmpPDU) error {
		raw[pdu.Name] = formatPDUValue(pdu)
		return nil
	})
	return raw
}

// walkString/walkInt walk one table column and index the results by the
// table index suffix (everything after the column OID), so columns from
// separate walks can be correlated by that shared index afterwards.

func walkString(g *gosnmp.GoSNMP, columnOID string, dest map[string]string) {
	_ = g.BulkWalk(columnOID, func(pdu gosnmp.SnmpPDU) error {
		if b, ok := pdu.Value.([]byte); ok {
			dest[indexOf(pdu.Name, columnOID)] = cleanString(string(b))
		}
		return nil
	})
}

// cleanString strips NUL bytes and other non-printable control characters,
// then trims surrounding whitespace. Some vendors pad fixed-width SNMP
// fields (serial numbers, names) with spaces (confirmed: Samsung); others
// pad with NUL bytes (confirmed against a real HP printer - the raw NUL made
// it all the way to Postgres, which flatly rejects embedded NUL bytes in
// text columns and 500'd the ingest endpoint). Not applied to the raw
// full-MIB capture, which stays byte-for-byte honest - see the backend's own
// sanitization for that field instead.
func cleanString(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == 0 || (r < 0x20 && r != '\t') {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}

func walkInt(g *gosnmp.GoSNMP, columnOID string, dest map[string]int64) {
	_ = g.BulkWalk(columnOID, func(pdu gosnmp.SnmpPDU) error {
		dest[indexOf(pdu.Name, columnOID)] = gosnmp.ToBigInt(pdu.Value).Int64()
		return nil
	})
}

func indexOf(pduName, baseOID string) string {
	return strings.TrimPrefix(pduName, "."+baseOID+".")
}

func formatPDUValue(pdu gosnmp.SnmpPDU) string {
	if b, ok := pdu.Value.([]byte); ok {
		return string(b)
	}
	return fmt.Sprintf("%v", pdu.Value)
}

func varMap(pdus []gosnmp.SnmpPDU) map[string]gosnmp.SnmpPDU {
	m := make(map[string]gosnmp.SnmpPDU, len(pdus))
	for _, p := range pdus {
		m[p.Name] = p
	}
	return m
}

func getString(vars map[string]gosnmp.SnmpPDU, oid string) string {
	if p, ok := vars["."+oid]; ok {
		if b, ok := p.Value.([]byte); ok {
			return cleanString(string(b))
		}
	}
	return ""
}

func getInt(vars map[string]gosnmp.SnmpPDU, oid string) int64 {
	if p, ok := vars["."+oid]; ok && p.Value != nil {
		return gosnmp.ToBigInt(p.Value).Int64()
	}
	return 0
}

// getIntOK is like getInt but distinguishes "the device doesn't support
// this OID" from "the device reported zero" - unlike getInt's callers
// (which treat a missing scalar as an ordinary 0), collectMarkerSplit needs
// to know the difference so it can return nil (not a false 0) when a
// vendor-specific OID isn't implemented. noSuchObject/noSuchInstance/
// endOfMibView are SNMPv2c's in-band "this OID doesn't exist here" markers.
func getIntOK(vars map[string]gosnmp.SnmpPDU, oid string) (int64, bool) {
	p, ok := vars["."+oid]
	if !ok || p.Value == nil {
		return 0, false
	}
	switch p.Type {
	case gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView:
		return 0, false
	}
	return gosnmp.ToBigInt(p.Value).Int64(), true
}

// decodeErrorState reads hrPrinterDetectedErrorState, a BITS value: bit N
// lives at byte N/8, bit position (7 - N%8) within that byte (MSB-first).
func decodeErrorState(b []byte) ErrorState {
	has := func(bit int) bool {
		byteIdx := bit / 8
		if byteIdx >= len(b) {
			return false
		}
		return b[byteIdx]&(1<<uint(7-bit%8)) != 0
	}
	return ErrorState{
		LowPaper:            has(0),
		NoPaper:             has(1),
		LowToner:            has(2),
		NoToner:             has(3),
		DoorOpen:            has(4),
		Jammed:              has(5),
		Offline:             has(6),
		ServiceRequested:    has(7),
		InputTrayMissing:    has(8),
		OutputTrayMissing:   has(9),
		MarkerSupplyMissing: has(10),
		OutputNearFull:      has(11),
		OutputFull:          has(12),
		InputTrayEmpty:      has(13),
		OverduePreventMaint: has(14),
	}
}

func printerStatusLabel(v int64) string {
	switch v {
	case 1:
		return "other"
	case 2:
		return "unknown"
	case 3:
		return "idle"
	case 4:
		return "printing"
	case 5:
		return "warmup"
	default:
		return fmt.Sprintf("unknown(%d)", v)
	}
}

func deviceStatusLabel(v int64) string {
	switch v {
	case 1:
		return "unknown"
	case 2:
		return "running"
	case 3:
		return "warning"
	case 4:
		return "testing"
	case 5:
		return "down"
	default:
		return fmt.Sprintf("unknown(%d)", v)
	}
}

func alertSeverityLabel(v int64) string {
	switch v {
	case 1:
		return "other"
	case 3:
		return "critical"
	case 4:
		return "warning"
	default:
		return fmt.Sprintf("unknown(%d)", v)
	}
}

func supplyClassLabel(v int64) string {
	switch v {
	case 1:
		return "other"
	case 3:
		return "supply"
	case 4:
		return "receptacle"
	default:
		return fmt.Sprintf("unknown(%d)", v)
	}
}
