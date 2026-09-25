//go:build windows

package discovery

import (
	"log"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	printMonitorsKey = `SYSTEM\CurrentControlSet\Control\Print\Monitors`
	printPrintersKey = `SYSTEM\CurrentControlSet\Control\Print\Printers`
)

// printServerPorts reads every port under every print monitor's Ports key
// (Standard TCP/IP Port, HP Standard TCP/IP Port, LPR Port, ...) and returns
// the ones pointing at a network address. Read straight from the registry
// rather than shelling out to PowerShell's Get-PrinterPort: no dependency on
// PowerShell being present/allowed, and it works the same under the
// service's LocalSystem identity. WSD ports carry no address here and are
// simply skipped (portHost returns "").
func printServerPorts() []printPort {
	// Diagnostics are deliberately verbose: the first real print server
	// this ran on (Sabin, 2026-09-25) returned zero ports with no trace of
	// why, and there's no remote shell to go look - the uploaded log is the
	// only window into the machine.
	logInstalledPrinters(registry.LOCAL_MACHINE, "this host")
	return monitorPorts(registry.LOCAL_MACHINE, "this host")
}

// remotePrintServerPorts reads a REMOTE print server's ports the same way,
// over the Remote Registry service, authenticating as this machine's domain
// account (the agent runs as LocalSystem). Windows' default winreg ACL often
// doesn't let a non-admin read the Monitors key remotely but does allow the
// Printers key (it's in the default AllowedPaths list), so when Monitors
// yields nothing this falls back to each queue's port NAME - which, for a
// Standard TCP/IP port, Windows names after the printer's IP by default.
func remotePrintServerPorts(server string) []printPort {
	// OpenRemoteKey adds the leading `\\` itself - passing it here too made
	// every call fail with "invalid network address" (first real run, Sabin).
	root, err := registry.OpenRemoteKey(server, registry.LOCAL_MACHINE)
	if err != nil {
		log.Printf("discovery: can't open the registry of print server %s remotely: %v", server, err)
		return nil
	}
	defer root.Close()

	if ports := monitorPorts(root, server); len(ports) > 0 {
		return ports
	}
	return queuePorts(root, server)
}

func monitorPorts(root registry.Key, where string) []printPort {
	monitors, err := registry.OpenKey(root, printMonitorsKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		log.Printf("discovery: can't read print monitors on %s: %v", where, err)
		return nil
	}
	defer monitors.Close()

	monitorNames, err := monitors.ReadSubKeyNames(-1)
	if err != nil {
		log.Printf("discovery: can't list print monitors on %s: %v", where, err)
		return nil
	}

	var out []printPort
	for _, monitor := range monitorNames {
		portsKey, err := registry.OpenKey(root, printMonitorsKey+`\`+monitor+`\Ports`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue // most monitors (Local Port, USB, ...) have no Ports subkey
		}
		portNames, _ := portsKey.ReadSubKeyNames(-1)
		portsKey.Close()
		log.Printf("discovery: print monitor %q on %s has %d port(s)", monitor, where, len(portNames))

		for _, name := range portNames {
			path := printMonitorsKey + `\` + monitor + `\Ports\` + name
			values := readPortValues(root, path)
			host := portHost(name, values)
			if host == "" {
				log.Printf("discovery: print port %q (%s on %s) has no usable address - values present: %s", name, monitor, where, portValueNames(root, path))
				continue
			}
			out = append(out, printPort{Name: name, Host: host, Community: values["SNMP Community"]})
		}
	}
	return out
}

// queuePorts is the fallback for a remote print server whose Monitors key
// isn't readable: each queue's port name, when it's an address.
func queuePorts(root registry.Key, where string) []printPort {
	queues := installedPrinters(root, where)
	var out []printPort
	for _, q := range queues {
		if host := portNameHost(q.port); host != "" {
			out = append(out, printPort{Name: q.port + " (" + q.name + " on " + where + ")", Label: q.name, Host: host})
		}
	}
	log.Printf("discovery: %d of %d queue(s) on %s have a port named after an address", len(out), len(queues), where)
	return out
}

type installedQueue struct{ name, port string }

func installedPrinters(root registry.Key, where string) []installedQueue {
	k, err := registry.OpenKey(root, printPrintersKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		log.Printf("discovery: can't read installed printers on %s: %v", where, err)
		return nil
	}
	names, _ := k.ReadSubKeyNames(-1)
	k.Close()

	out := make([]installedQueue, 0, len(names))
	for _, name := range names {
		port := ""
		if pk, err := registry.OpenKey(root, printPrintersKey+`\`+name, registry.QUERY_VALUE); err == nil {
			port, _, _ = pk.GetStringValue("Port")
			pk.Close()
		}
		out = append(out, installedQueue{name: name, port: port})
	}
	return out
}

// logInstalledPrinters logs how many print queues a machine hosts and which
// port each one uses - tells apart "this isn't really the print server"
// (few/no queues) from "the queues are here but their ports use a layout
// portHost doesn't know".
func logInstalledPrinters(root registry.Key, where string) {
	queues := installedPrinters(root, where)
	log.Printf("discovery: %d printer queue(s) installed on %s", len(queues), where)
	for _, q := range queues {
		log.Printf("discovery:   queue %q -> port %q", q.name, q.port)
	}
}

func readPortValues(root registry.Key, path string) map[string]string {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
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

func portValueNames(root registry.Key, path string) string {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
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
