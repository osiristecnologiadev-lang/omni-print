//go:build windows

package discovery

import (
	"log"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const printMonitorsKey = `SYSTEM\CurrentControlSet\Control\Print\Monitors`

// printServerPorts reads every port under every print monitor's Ports key
// (Standard TCP/IP Port, HP Standard TCP/IP Port, LPR Port, ...) and returns
// the ones pointing at a network address. Read straight from the registry
// rather than shelling out to PowerShell's Get-PrinterPort: no dependency on
// PowerShell being present/allowed, and it works the same under the
// service's LocalSystem identity. WSD ports carry no address here and are
// simply skipped (portHost returns "").
func printServerPorts() []printPort {
	monitors, err := registry.OpenKey(registry.LOCAL_MACHINE, printMonitorsKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		log.Printf("discovery: can't read print monitors from the registry: %v", err)
		return nil
	}
	defer monitors.Close()

	monitorNames, err := monitors.ReadSubKeyNames(-1)
	if err != nil {
		log.Printf("discovery: can't list print monitors: %v", err)
		return nil
	}

	// Diagnostics below are deliberately verbose: the first real print
	// server this ran on (Sabin, 2026-09-25) returned zero ports with no
	// trace of why, and there's no remote shell to go look - the uploaded
	// log is the only window into the machine.
	logInstalledPrinters()

	var out []printPort
	for _, monitor := range monitorNames {
		portsKey, err := registry.OpenKey(registry.LOCAL_MACHINE, printMonitorsKey+`\`+monitor+`\Ports`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue // most monitors (Local Port, USB, ...) have no Ports subkey
		}
		portNames, _ := portsKey.ReadSubKeyNames(-1)
		portsKey.Close()
		log.Printf("discovery: print monitor %q has %d port(s)", monitor, len(portNames))

		for _, name := range portNames {
			path := printMonitorsKey + `\` + monitor + `\Ports\` + name
			values := readPortValues(path)
			host := portHost(name, values)
			if host == "" {
				log.Printf("discovery: print port %q (%s) has no usable address - values present: %s", name, monitor, portValueNames(path))
				continue
			}
			out = append(out, printPort{Name: name, Host: host, Community: values["SNMP Community"]})
		}
	}
	return out
}

// logInstalledPrinters logs how many print queues this machine hosts and
// which port each one uses - tells apart "this isn't really the print
// server" (few/no queues, or queues pointing at \\otherserver) from "the
// queues are here but their ports use a layout portHost doesn't know".
func logInstalledPrinters() {
	const printersKey = `SYSTEM\CurrentControlSet\Control\Print\Printers`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, printersKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		log.Printf("discovery: can't read installed printers: %v", err)
		return
	}
	names, _ := k.ReadSubKeyNames(-1)
	k.Close()
	log.Printf("discovery: %d printer queue(s) installed on this host", len(names))
	for _, name := range names {
		port := ""
		if pk, err := registry.OpenKey(registry.LOCAL_MACHINE, printersKey+`\`+name, registry.QUERY_VALUE); err == nil {
			port, _, _ = pk.GetStringValue("Port")
			pk.Close()
		}
		log.Printf("discovery:   queue %q -> port %q", name, port)
	}
}

func portValueNames(path string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return "(unreadable: " + err.Error() + ")"
	}
	defer k.Close()
	names, _ := k.ReadValueNames(-1)
	if len(names) == 0 {
		return "(none)"
	}
	return strings.Join(names, ", ")
}

func readPortValues(path string) map[string]string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()

	values := make(map[string]string)
	for _, name := range []string{"HostName", "IPAddress", "Server Name", "SNMP Community"} {
		if v, _, err := k.GetStringValue(name); err == nil {
			values[name] = v
		}
	}
	return values
}
