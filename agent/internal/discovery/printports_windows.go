//go:build windows

package discovery

import (
	"log"

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
		return nil
	}

	var out []printPort
	for _, monitor := range monitorNames {
		portsKey, err := registry.OpenKey(registry.LOCAL_MACHINE, printMonitorsKey+`\`+monitor+`\Ports`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue // most monitors (Local Port, USB, ...) have no Ports subkey
		}
		portNames, _ := portsKey.ReadSubKeyNames(-1)
		portsKey.Close()

		for _, name := range portNames {
			values := readPortValues(printMonitorsKey + `\` + monitor + `\Ports\` + name)
			host := portHost(name, values)
			if host == "" {
				continue
			}
			out = append(out, printPort{Name: name, Host: host, Community: values["SNMP Community"]})
		}
	}
	return out
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
