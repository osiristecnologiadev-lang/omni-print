package collector

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/omniprint/agent/internal/config"
)

// 16 silent hosts at a 300ms timeout: one at a time that's ~5s, in
// parallel ~0.6s. Order of results must follow the input.
func TestPollAllRunsInParallelAndKeepsOrder(t *testing.T) {
	devices := make([]config.Device, 16)
	for i := range devices {
		// TEST-NET-1 (RFC 5737): never routed, nothing answers.
		devices[i] = config.Device{Name: fmt.Sprint(i), Host: fmt.Sprintf("192.0.2.%d", i+1), Community: "public", Port: 161}
	}
	c := New(0, 300*time.Millisecond, 0, false)

	start := time.Now()
	got := c.PollAll(context.Background(), devices)
	elapsed := time.Since(start)

	if len(got) != len(devices) {
		t.Fatalf("got %d metrics, want %d", len(got), len(devices))
	}
	for i, m := range got {
		if m.Host != devices[i].Host || m.Online {
			t.Errorf("metric %d = %s online=%v, want %s offline", i, m.Host, m.Online, devices[i].Host)
		}
	}
	if elapsed > 3*time.Second {
		t.Errorf("took %s - looks sequential", elapsed)
	}
}

func TestPollErrorMarksNoSNMPDevices(t *testing.T) {
	if got := pollError(config.Device{NoSNMP: true}, "get: timeout"); got != NoSNMPError+" - get: timeout" {
		t.Errorf("no-snmp device error = %q", got)
	}
	if got := pollError(config.Device{}, "get: timeout"); got != "get: timeout" {
		t.Errorf("regular device error = %q", got)
	}
}
