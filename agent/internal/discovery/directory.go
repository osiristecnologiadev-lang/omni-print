package discovery

import (
	"context"
	"errors"
	"log"
	"sort"
	"time"
)

// adQueue is one printQueue object published in Active Directory. On a
// domain, a shared printer on any print server is published by default
// ("List in the directory"), with the server that hosts it and its port.
//
// Added after a real customer (Sabin, 2026-09): the agent was installed on
// a machine that turned out NOT to be the print server (one queue: "Print
// to PDF"), with most printers on other subnets. AD is the one place a
// domain member can ask "which print servers exist, and what do they
// print to?" with no configuration and no one on-site to answer.
type adQueue struct {
	Printer string
	Server  string   // DNS name of the print server hosting the queue
	Ports   []string // port names, e.g. "10.80.40.5" or "IP_10.80.40.5"
}

// errNotInDomain is returned by adPrintQueues when this machine isn't
// joined to a domain - the common case for small customers, not a failure.
var errNotInDomain = errors.New("this machine isn't joined to an Active Directory domain")

const (
	adLookupTimeout     = 60 * time.Second
	remoteServerTimeout = 30 * time.Second
)

// directoryTargets turns AD's published printers into probe targets, via
// two routes: each queue's own port name (when it's an address), and each
// print server AD names, whose ports are then read over Remote Registry
// (see remotePrintServerPorts) - that catches queues that were never
// published, and ports whose names aren't addresses.
func directoryTargets(ctx context.Context, community string) []target {
	queues, err := withTimeout(ctx, adLookupTimeout, adPrintQueues)
	if err != nil {
		log.Printf("discovery: active directory: %v", err)
		return nil
	}
	log.Printf("discovery: active directory lists %d published printer(s)", len(queues))

	var ports []printPort
	perServer := map[string]int{}
	// Only servers with at least one queue on a network-style port are
	// worth a remote registry read. On a real domain (Sabin: 98 published
	// printers) most "print servers" AD names are workstations sharing a
	// USB label printer - reading each costs up to remoteServerTimeout when
	// it's off or firewalled, for no network printer at the end.
	networkServer := map[string]bool{}
	for _, q := range queues {
		perServer[q.Server]++
		for _, p := range q.Ports {
			if !isLocalPortName(p) {
				networkServer[q.Server] = true
			}
		}
		usable := false
		for _, p := range q.Ports {
			if h := portNameHost(p); h != "" {
				ports = append(ports, printPort{Name: p + " (" + q.Printer + " on " + q.Server + ")", Label: q.Printer, Host: h})
				usable = true
			}
		}
		if !usable {
			log.Printf("discovery: AD printer %q on %s has no port named after an address (ports: %v)", q.Printer, q.Server, q.Ports)
		}
	}

	servers := make([]string, 0, len(perServer))
	for s := range perServer {
		if s != "" {
			servers = append(servers, s)
		}
	}
	sort.Strings(servers)
	skipped := 0
	for _, s := range servers {
		if !networkServer[s] {
			skipped++
			continue
		}
		log.Printf("discovery: print server %s publishes %d printer(s) in AD - reading its ports", s, perServer[s])
		server := s
		remote, err := withTimeout(ctx, remoteServerTimeout, func() ([]printPort, error) {
			return remotePrintServerPorts(server), nil
		})
		if err != nil {
			log.Printf("discovery: print server %s: %v", s, err)
			continue
		}
		log.Printf("discovery: print server %s: %d network port(s) read remotely", s, len(remote))
		ports = append(ports, remote...)
	}

	if skipped > 0 {
		log.Printf("discovery: skipped %d machine(s) whose AD printers are all local (USB/WSD/shared connections)", skipped)
	}

	targets := portTargets(ctx, ports, community)
	log.Printf("discovery: active directory route found %d printer address(es) to probe", len(targets))
	return targets
}

// withTimeout runs fn but stops waiting after d - an unreachable domain
// controller or print server can otherwise stall a Windows RPC/LDAP call
// for minutes. The abandoned call finishes (or not) in the background.
func withTimeout[T any](ctx context.Context, d time.Duration, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	ch := make(chan result, 1)
	go func() {
		v, err := fn()
		ch <- result{v, err}
	}()
	var zero T
	select {
	case r := <-ch:
		return r.v, r.err
	case <-time.After(d):
		return zero, errors.New("timed out after " + d.String())
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}
