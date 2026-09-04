// Command probe queries a single printer via SNMP and prints the collected
// Metric as JSON. It's a diagnostic tool: test connectivity/community string
// and inspect exactly what a device returns before adding it to an agent's
// config.yaml, or to validate the collector's OID assumptions against real
// hardware.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/omniprint/agent/internal/collector"
	"github.com/omniprint/agent/internal/config"
)

func main() {
	host := flag.String("host", "", "printer IP or hostname")
	community := flag.String("community", "public", "SNMP community string")
	port := flag.Uint("port", 161, "SNMP port")
	rawCapture := flag.Bool("raw", true, "capture the full Printer-MIB subtree")
	timeout := flag.Duration("timeout", 5*time.Second, "SNMP timeout per request")
	flag.Parse()

	if *host == "" {
		fmt.Fprintln(os.Stderr, "usage: probe -host <ip> [-community public] [-port 161]")
		os.Exit(1)
	}

	col := collector.New(0, *timeout, 2, *rawCapture)
	devices := []config.Device{{Name: "probe", Host: *host, Community: *community, Port: uint16(*port)}}

	results := col.PollAll(context.Background(), devices)
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(results[0]); err != nil {
		fmt.Fprintln(os.Stderr, "encode error:", err)
		os.Exit(1)
	}
}
