//go:build windows

package usbprint

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/omniprint/agent/internal/collector"
)

// GUID_DEVINTERFACE_USBPRINT - the device interface usbprint.sys exposes for
// every USB printer; its registry entries map a USBnnn port to the device.
const usbPrintClassKey = `SYSTEM\CurrentControlSet\Control\DeviceClasses\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}`

const printServiceLog = "Microsoft-Windows-PrintService/Operational"

var (
	winspool          = windows.NewLazySystemDLL("winspool.drv")
	procEnumPrintersW = winspool.NewProc("EnumPrintersW")
)

const printerEnumLocal = 0x2

// PRINTER_INFO_2W, field for field.
type printerInfo2 struct {
	ServerName         *uint16
	PrinterName        *uint16
	ShareName          *uint16
	PortName           *uint16
	DriverName         *uint16
	Comment            *uint16
	Location           *uint16
	DevMode            uintptr
	SepFile            *uint16
	PrintProcessor     *uint16
	Datatype           *uint16
	Parameters         *uint16
	SecurityDescriptor uintptr
	Attributes         uint32
	Priority           uint32
	DefaultPriority    uint32
	StartTime          uint32
	UntilTime          uint32
	Status             uint32
	Jobs               uint32
	AveragePPM         uint32
}

type queue struct {
	name, port, driver string
	status, jobs       uint32
}

type usbDevice struct {
	link     string // \\?\USB#VID_...#serial#{guid} - what CreateFile opens
	instance string // USB\VID_...\serial
}

var usbPort = regexp.MustCompile(`(?i)^USB\d{3}$`)

// Poll reads every printer on a USB port of this PC. dir holds the state
// file. Never returns an error: a PC without USB printers (the usual case)
// returns nil, and a printer that can't be read is still reported, offline.
func Poll(ctx context.Context, dir string) []collector.Metric {
	queues, err := localQueues()
	if err != nil {
		log.Printf("usb: can't list this PC's printers: %v", err)
		return nil
	}
	var usbQueues []queue
	for _, q := range queues {
		if p := firstPort(q.port); usbPort.MatchString(p) {
			q.port = strings.ToUpper(p)
			usbQueues = append(usbQueues, q)
		}
	}
	if len(usbQueues) == 0 {
		return nil
	}

	st := loadState(dir)
	st.mu.Lock()
	defer st.mu.Unlock()

	devices := usbDevicesByPort()
	windowsPages := countWindowsPages(ctx, st)
	computer, _ := os.Hostname()

	seen := map[string]bool{}
	var out []collector.Metric
	for _, q := range usbQueues {
		// Several queues can share one USB port (e.g. a PCL and a PS driver
		// for the same printer) - report the printer once.
		if seen[q.port] {
			continue
		}
		seen[q.port] = true
		ps := st.printer(q.name)
		ps.WindowsPages += windowsPages[q.name]
		out = append(out, pollQueue(ctx, q, devices[q.port], ps, computer))
	}
	if err := st.save(); err != nil {
		log.Printf("usb: can't save %s: %v", st.path, err)
	}
	return out
}

func pollQueue(ctx context.Context, q queue, dev usbDevice, ps *printerState, computer string) collector.Metric {
	m := collector.Metric{
		DeviceName:   q.name,
		Host:         HostPrefix + computer + "/" + q.port,
		CollectedAt:  time.Now().UTC(),
		PrinterName:  q.name,
		Model:        modelFromDriver(q.driver),
		SerialNumber: usbSerial(dev.instance),
	}
	if dev.link == "" {
		m.Error = fmt.Sprintf("USB printer %q (%s): no USB device found for the port - unplugged?", q.name, q.port)
		m.SysDescr = describe(computer, q.port, ps.Source)
		return m
	}

	reply, err := askPJL(ctx, dev.link, q.jobs)
	switch {
	case errors.Is(err, windows.ERROR_FILE_NOT_FOUND), errors.Is(err, windows.ERROR_DEVICE_NOT_CONNECTED), errors.Is(err, windows.ERROR_GEN_FAILURE):
		m.Error = fmt.Sprintf("USB printer %q (%s) is off or unplugged", q.name, q.port)
		m.SysDescr = describe(computer, q.port, ps.Source)
		return m
	case err != nil:
		log.Printf("usb: %q (%s): no PJL answer this poll: %v", q.name, q.port, err)
	}
	m.Online = true
	if reply.ID != "" {
		m.Model = reply.ID
	}

	switch {
	case reply.PageCount != nil:
		if ps.Source != SourcePJL {
			log.Printf("usb: %q (%s) answers PJL - using the printer's own counter (%d)", q.name, q.port, *reply.PageCount)
		}
		ps.Source = SourcePJL
		ps.PJLMisses = 0
		m.PageCount = reply.PageCount
	case ps.Source == SourcePJL:
		// Answered before: a busy/hiccup poll, not a reason to switch.
	case err == nil || errors.Is(err, errNoReply):
		// Connected, idle, asked - and nothing. A few of these in a row and
		// it's a printer without PJL: count from Windows' print log instead.
		ps.PJLMisses++
		if ps.PJLMisses >= 3 && ps.Source != SourceWindows {
			ps.Source = SourceWindows
			log.Printf("usb: %q (%s) doesn't answer PJL - counting pages from Windows' print log from now on", q.name, q.port)
		}
	}
	if ps.Source == SourceWindows && ps.WindowsPages > 0 {
		n := ps.WindowsPages
		m.PageCount = &n
	}
	m.SysDescr = describe(computer, q.port, ps.Source)
	return m
}

func describe(computer, port, source string) string {
	s := fmt.Sprintf("Impressora USB no computador %s (%s)", computer, port)
	switch source {
	case SourcePJL:
		return s + " - contador da própria impressora"
	case SourceWindows:
		return s + " - contador pelo Windows (só o que é impresso deste computador)"
	}
	return s
}

func firstPort(ports string) string {
	return strings.TrimSpace(strings.Split(ports, ",")[0])
}

func localQueues() ([]queue, error) {
	var needed, returned uint32
	r, _, err := procEnumPrintersW.Call(printerEnumLocal, 0, 2, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 && !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
		return nil, err
	}
	if needed == 0 {
		return nil, nil
	}
	buf := make([]byte, needed)
	r, _, err = procEnumPrintersW.Call(printerEnumLocal, 0, 2, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed),
		uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 {
		return nil, err
	}
	infos := unsafe.Slice((*printerInfo2)(unsafe.Pointer(&buf[0])), returned)
	out := make([]queue, 0, returned)
	for _, pi := range infos {
		out = append(out, queue{
			name:   windows.UTF16PtrToString(pi.PrinterName),
			port:   windows.UTF16PtrToString(pi.PortName),
			driver: windows.UTF16PtrToString(pi.DriverName),
			status: pi.Status,
			jobs:   pi.Jobs,
		})
	}
	return out, nil
}

// usbDevicesByPort maps "USB001" -> its USB device, from usbprint.sys'
// device-interface registry entries ("Base Name" + "Port Number" give the
// port; the interface's SymbolicLink is the path CreateFile opens).
func usbDevicesByPort() map[string]usbDevice {
	out := map[string]usbDevice{}
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, usbPrintClassKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return out
	}
	defer root.Close()
	subs, _ := root.ReadSubKeyNames(-1)
	for _, sub := range subs {
		k, err := registry.OpenKey(root, sub, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		instance, _, _ := k.GetStringValue("DeviceInstance")
		k.Close()

		hash, err := registry.OpenKey(root, sub+`\#`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		link, _, _ := hash.GetStringValue("SymbolicLink")
		hash.Close()

		params, err := registry.OpenKey(root, sub+`\#\Device Parameters`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		base, _, _ := params.GetStringValue("Base Name")
		num, _, err := params.GetIntegerValue("Port Number")
		params.Close()
		if err != nil || link == "" {
			continue
		}
		if base == "" {
			base = "USB"
		}
		port := strings.ToUpper(fmt.Sprintf("%s%03d", base, num))
		// Windows keeps entries for printers unplugged long ago - prefer one
		// that is connected now.
		if prev, ok := out[port]; ok && present(prev.link) {
			continue
		}
		out[port] = usbDevice{link: link, instance: instance}
	}
	return out
}

func present(link string) bool {
	h, err := windows.CreateFile(windows.StringToUTF16Ptr(link), 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return !errors.Is(err, windows.ERROR_FILE_NOT_FOUND)
	}
	windows.CloseHandle(h)
	return true
}

var errNoReply = errors.New("no PJL reply")
var errBusy = errors.New("print queue has jobs - not asking")

const uel = "\x1b%-12345X"

// askPJL asks the printer for its id and page counter over its USB link.
// Never while the queue has jobs: a PJL job sent in the middle of a print
// could interleave with it.
func askPJL(ctx context.Context, link string, jobs uint32) (pjlReply, error) {
	if jobs > 0 {
		return pjlReply{}, errBusy
	}
	h, err := windows.CreateFile(windows.StringToUTF16Ptr(link),
		windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OVERLAPPED, 0)
	if err != nil {
		return pjlReply{}, err
	}
	defer windows.CloseHandle(h)

	req := []byte(uel + "@PJL\r\n@PJL INFO ID\r\n@PJL INFO PAGECOUNT\r\n" + uel)
	if _, err := overlappedIO(h, req, true, 5*time.Second); err != nil {
		return pjlReply{}, fmt.Errorf("write: %w", err)
	}

	var reply strings.Builder
	deadline := time.Now().Add(8 * time.Second)
	buf := make([]byte, 4096)
	for time.Now().Before(deadline) && ctx.Err() == nil {
		n, err := overlappedIO(h, buf, false, time.Until(deadline))
		if n > 0 {
			reply.Write(buf[:n])
			if r := parsePJL(reply.String()); r.PageCount != nil {
				return r, nil
			}
			continue
		}
		if err != nil && !errors.Is(err, errTimeout) {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	r := parsePJL(reply.String())
	if r.PageCount == nil && r.ID == "" {
		return r, errNoReply
	}
	return r, nil
}

var errTimeout = errors.New("timeout")

// overlappedIO does one read or write with a deadline - a USB printer that
// doesn't support reads would otherwise block forever.
func overlappedIO(h windows.Handle, buf []byte, write bool, timeout time.Duration) (int, error) {
	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(ev)
	ov := windows.Overlapped{HEvent: ev}
	var done uint32
	if write {
		err = windows.WriteFile(h, buf, &done, &ov)
	} else {
		err = windows.ReadFile(h, buf, &done, &ov)
	}
	if err != nil && !errors.Is(err, windows.ERROR_IO_PENDING) {
		return 0, err
	}
	ms := uint32(timeout / time.Millisecond)
	if ms == 0 {
		ms = 1
	}
	if ev, _ := windows.WaitForSingleObject(ev, ms); ev != windows.WAIT_OBJECT_0 {
		_ = windows.CancelIoEx(h, &ov)
		_ = windows.GetOverlappedResult(h, &ov, &done, true)
		return int(done), errTimeout
	}
	if err := windows.GetOverlappedResult(h, &ov, &done, false); err != nil {
		return int(done), err
	}
	return int(done), nil
}

// --- Windows print log (fallback counter) -----------------------------------

type eventsXML struct {
	Events []struct {
		RecordID uint64 `xml:"System>EventRecordID"`
		Printer  string `xml:"UserData>DocumentPrinted>Param5"`
		Pages    string `xml:"UserData>DocumentPrinted>Param8"`
	} `xml:"Event"`
}

var logEnabledChecked bool

// countWindowsPages returns pages printed per queue since the last call,
// from PrintService/Operational event 307 ("document printed"). That log
// is off by default; the agent turns it on the first time (it only records
// print jobs, nothing else).
func countWindowsPages(ctx context.Context, st *stateFile) map[string]int64 {
	out := map[string]int64{}
	if !logEnabledChecked {
		logEnabledChecked = true
		if b, err := wevtutil(ctx, "gl", printServiceLog); err == nil && strings.Contains(strings.ToLower(string(b)), "enabled: false") {
			if _, err := wevtutil(ctx, "sl", printServiceLog, "/e:true"); err != nil {
				log.Printf("usb: can't turn on Windows' print log (%s): %v", printServiceLog, err)
			} else {
				log.Printf("usb: turned on Windows' print log (%s) to count pages of printers without PJL", printServiceLog)
			}
		}
	}
	q := fmt.Sprintf("*[System[(EventID=307) and (EventRecordID>%d)]]", st.s.LastRecordID)
	b, err := wevtutil(ctx, "qe", printServiceLog, "/q:"+q, "/f:xml", "/e:Events")
	if err != nil {
		return out
	}
	var ev eventsXML
	if err := xml.Unmarshal(b, &ev); err != nil {
		log.Printf("usb: can't read Windows' print log: %v", err)
		return out
	}
	for _, e := range ev.Events {
		if e.RecordID > st.s.LastRecordID {
			st.s.LastRecordID = e.RecordID
		}
		if n, err := strconv.ParseInt(strings.TrimSpace(e.Pages), 10, 64); err == nil && n > 0 {
			out[e.Printer] += n
		}
	}
	return out
}

func wevtutil(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "wevtutil.exe", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Output()
}
