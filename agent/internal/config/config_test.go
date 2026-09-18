package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writing temp config: %v", err)
	}
	return path
}

func TestLoadMinimalValidConfig(t *testing.T) {
	path := writeTempConfig(t, `
tenant_id: t1
agent_token: tok123
cloud_url: https://example.com
devices:
  - host: 10.0.0.5
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.PollInterval.Duration() != 30*time.Minute {
		t.Errorf("PollInterval default = %v, want 30m", cfg.PollInterval.Duration())
	}
	if cfg.RequestDelay.Duration() != 500*time.Millisecond {
		t.Errorf("RequestDelay default = %v, want 500ms", cfg.RequestDelay.Duration())
	}
	if len(cfg.Devices) != 1 || cfg.Devices[0].Community != "public" || cfg.Devices[0].Port != 161 {
		t.Errorf("device defaults not applied: %+v", cfg.Devices)
	}
}

func TestLoadMissingRequiredFields(t *testing.T) {
	tests := []struct {
		name    string
		content string
	}{
		{"missing tenant_id", "agent_token: t\ncloud_url: https://example.com\ndevices:\n  - host: 1.2.3.4\n"},
		{"missing agent_token", "tenant_id: t\ncloud_url: https://example.com\ndevices:\n  - host: 1.2.3.4\n"},
		{"missing cloud_url", "tenant_id: t\nagent_token: t\ndevices:\n  - host: 1.2.3.4\n"},
		{"no devices and discovery disabled", "tenant_id: t\nagent_token: t\ncloud_url: https://example.com\n"},
		{"device with no host", "tenant_id: t\nagent_token: t\ncloud_url: https://example.com\ndevices:\n  - community: public\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeTempConfig(t, tt.content)
			if _, err := Load(path); err == nil {
				t.Errorf("expected an error, got nil")
			}
		})
	}
}

func TestLoadDiscoveryDefaults(t *testing.T) {
	path := writeTempConfig(t, `
tenant_id: t1
agent_token: tok123
cloud_url: https://example.com
discovery:
  enabled: true
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Discovery.Community != "public" {
		t.Errorf("Discovery.Community = %q, want public", cfg.Discovery.Community)
	}
	if cfg.Discovery.Interval.Duration() != 24*time.Hour {
		t.Errorf("Discovery.Interval = %v, want 24h", cfg.Discovery.Interval.Duration())
	}
	if cfg.Discovery.Concurrency != 8 {
		t.Errorf("Discovery.Concurrency = %d, want 8", cfg.Discovery.Concurrency)
	}
	if cfg.Discovery.ProbeTimeout.Duration() != 800*time.Millisecond {
		t.Errorf("Discovery.ProbeTimeout = %v, want 800ms", cfg.Discovery.ProbeTimeout.Duration())
	}
}

func TestFullRawCaptureEnabledDefaultsTrue(t *testing.T) {
	var cfg Config
	if !cfg.FullRawCaptureEnabled() {
		t.Errorf("FullRawCaptureEnabled() = false when unset, want true (default)")
	}
	f := false
	cfg.FullRawCapture = &f
	if cfg.FullRawCaptureEnabled() {
		t.Errorf("FullRawCaptureEnabled() = true when explicitly false")
	}
}

func TestAutoUpdateEnabledDefaultsTrue(t *testing.T) {
	var cfg Config
	if !cfg.AutoUpdateEnabled() {
		t.Errorf("AutoUpdateEnabled() = false when unset, want true (default)")
	}
	f := false
	cfg.AutoUpdate.Enabled = &f
	if cfg.AutoUpdateEnabled() {
		t.Errorf("AutoUpdateEnabled() = true when explicitly false")
	}
}

func TestLoadAutoUpdateCheckIntervalDefault(t *testing.T) {
	path := writeTempConfig(t, `
tenant_id: t1
agent_token: tok123
cloud_url: https://example.com
devices:
  - host: 10.0.0.5
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AutoUpdate.CheckInterval.Duration() != 6*time.Hour {
		t.Errorf("AutoUpdate.CheckInterval = %v, want 6h", cfg.AutoUpdate.CheckInterval.Duration())
	}
}

func TestLoadMergesDiscoveredDevices(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	discoveredPath := filepath.Join(dir, "discovered.yaml")

	if err := os.WriteFile(configPath, []byte(`
tenant_id: t1
agent_token: tok123
cloud_url: https://example.com
devices:
  - host: 10.0.0.5
`), 0644); err != nil {
		t.Fatalf("writing config: %v", err)
	}
	if err := SaveDeviceFile(discoveredPath, []Device{
		{Name: "found1", Host: "10.0.0.9", Community: "public", Port: 161},
	}); err != nil {
		t.Fatalf("SaveDeviceFile: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if len(cfg.Devices) != 2 {
		t.Fatalf("expected 2 merged devices, got %d: %+v", len(cfg.Devices), cfg.Devices)
	}
}

func TestMergeDevices(t *testing.T) {
	existing := []Device{{Name: "a", Host: "10.0.0.1"}}
	extra := []Device{
		{Name: "b", Host: "10.0.0.2"},
		{Name: "a-dup", Host: "10.0.0.1"}, // same host as existing - must not be re-added
	}
	merged, added := MergeDevices(existing, extra)

	if len(merged) != 2 {
		t.Errorf("merged has %d devices, want 2: %+v", len(merged), merged)
	}
	if len(added) != 1 || added[0].Host != "10.0.0.2" {
		t.Errorf("added = %+v, want just the 10.0.0.2 device", added)
	}
}

func TestMergeDevicesEmptyInputs(t *testing.T) {
	merged, added := MergeDevices(nil, nil)
	if len(merged) != 0 || len(added) != 0 {
		t.Errorf("expected empty results for empty inputs, got merged=%v added=%v", merged, added)
	}
}

func TestDurationUnmarshalYAML(t *testing.T) {
	path := writeTempConfig(t, `
tenant_id: t1
agent_token: tok123
cloud_url: https://example.com
poll_interval: 15m
request_delay: 250ms
devices:
  - host: 10.0.0.5
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.PollInterval.Duration() != 15*time.Minute {
		t.Errorf("PollInterval = %v, want 15m", cfg.PollInterval.Duration())
	}
	if cfg.RequestDelay.Duration() != 250*time.Millisecond {
		t.Errorf("RequestDelay = %v, want 250ms", cfg.RequestDelay.Duration())
	}
}

func TestDatedLogPath(t *testing.T) {
	day := time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)
	got := DatedLogPath("omniprint-agent.log", day)
	want := "omniprint-agent-2026-09-18.log"
	if got != want {
		t.Errorf("DatedLogPath = %q, want %q", got, want)
	}
}

func TestDatedLogPathPreservesDirectory(t *testing.T) {
	day := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	got := DatedLogPath(filepath.Join("C:", "agent", "omniprint-agent.log"), day)
	want := filepath.Join("C:", "agent", "omniprint-agent-2026-01-02.log")
	if got != want {
		t.Errorf("DatedLogPath = %q, want %q", got, want)
	}
}
