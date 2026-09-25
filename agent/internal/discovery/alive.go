package discovery

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"syscall"
	"time"

	"github.com/omniprint/agent/internal/config"
)

// printerTCPPorts are the ports a network printer almost always listens on:
// raw printing (9100), LPD (515), IPP (631) and its web page (80/443).
var printerTCPPorts = []int{9100, 515, 631, 80, 443}

const (
	aliveDialTimeout = 2 * time.Second
	aliveConcurrency = 16
)

// aliveWithoutSNMP sorts out printers that a specific source named (Active
// Directory, a print server's port) but that never answered SNMP. A real
// customer (Sabin, 2026-09) had ~25 of 42 such addresses stay silent, with
// no way to tell "switched off / retired" from "up, but SNMP disabled or on
// another community". A TCP handshake on a printing port answers that: up
// ones come back as devices flagged NoSNMP (they show in the panel as "Sem
// SNMP", named after the AD queue); unreachable ones are only logged.
//
// Only ever called for named targets, never a subnet sweep's addresses -
// dialing five ports on every silent address of a /16 would be a real port
// scan, not a check of printers someone already told us about.
func aliveWithoutSNMP(ctx context.Context, silent []target) []config.Device {
	type result struct {
		t    target
		port int
	}
	jobs := make(chan target)
	results := make(chan result)
	var wg sync.WaitGroup
	for w := 0; w < aliveConcurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range jobs {
				results <- result{t, firstOpenPort(ctx, t.IP)}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, t := range silent {
			select {
			case jobs <- t:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	var devices []config.Device
	down := 0
	for r := range results {
		if r.port == 0 {
			down++
			log.Printf("discovery: %q at %s doesn't answer SNMP nor any printing port - probably switched off or retired", r.t.Label, r.t.IP)
			continue
		}
		log.Printf("discovery: %q at %s is up (tcp/%d) but doesn't answer SNMP - adding it as a printer without SNMP", r.t.Label, r.t.IP, r.port)
		devices = append(devices, config.Device{
			Name:      r.t.Label,
			Host:      r.t.IP.String(),
			Community: r.t.Community,
			Port:      161,
			NoSNMP:    true,
		})
	}
	log.Printf("discovery: of %d named printer(s) without SNMP reply: %d up on the network, %d unreachable", len(silent), len(devices), down)
	return devices
}

// firstOpenPort returns the first printing port that proves the host is up
// - an accepted connection, or an explicit refusal (a RST also means a live
// machine answered) - or 0 when nothing answered at all.
func firstOpenPort(ctx context.Context, ip net.IP) int {
	d := net.Dialer{Timeout: aliveDialTimeout}
	for _, port := range printerTCPPorts {
		conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), fmt.Sprint(port)))
		if err == nil {
			conn.Close()
			return port
		}
		if isConnRefused(err) {
			return port
		}
	}
	return 0
}

// wsaeconnrefused is Windows' "connection refused" - syscall.ECONNREFUSED
// is a different, invented value there.
const wsaeconnrefused = syscall.Errno(10061)

func isConnRefused(err error) bool {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno == syscall.ECONNREFUSED || errno == wsaeconnrefused
	}
	return false
}
