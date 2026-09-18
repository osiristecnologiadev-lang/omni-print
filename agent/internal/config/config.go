// Package config loads and validates the agent's YAML configuration.
package config

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

// Duration wraps time.Duration so it can be parsed from strings like "30m" in YAML.
type Duration time.Duration

func (d *Duration) UnmarshalYAML(value *yaml.Node) error {
	var s string
	if err := value.Decode(&s); err != nil {
		return err
	}
	parsed, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	*d = Duration(parsed)
	return nil
}

func (d Duration) Duration() time.Duration {
	return time.Duration(d)
}

// Device is one printer to poll via SNMP - listed explicitly in config.yaml,
// or found by Discovery and persisted to the discovered.yaml sidecar file.
type Device struct {
	Name      string `yaml:"name"`
	Host      string `yaml:"host"`
	Community string `yaml:"community"`
	Port      uint16 `yaml:"port"`
}

// Discovery sweeps the local network for printers instead of requiring every
// IP to be typed by hand. It's still bounded and admin-controlled: by
// default it only scans the subnet(s) actually configured on the host
// machine's own network interfaces (see internal/discovery), never an
// arbitrary or unconfigured range, and it runs on a slow interval rather
// than continuously.
type Discovery struct {
	Enabled      bool     `yaml:"enabled"`
	Ranges       []string `yaml:"ranges"` // CIDRs; empty = auto-detect the host's own subnet(s)
	Community    string   `yaml:"community"`
	Interval     Duration `yaml:"interval"`
	Concurrency  int      `yaml:"concurrency"`
	ProbeTimeout Duration `yaml:"probe_timeout"`
}

// AutoUpdate controls the self-update check (see internal/updater). Enabled
// defaults to true (a pointer so "unset" and "explicitly false" are
// distinguishable, same trick as FullRawCapture below) - a release flagged
// mandatory on the server side still applies even when this is false; see
// internal/updater's CheckAndApply for that bypass rule.
type AutoUpdate struct {
	Enabled       *bool    `yaml:"enabled"`
	CheckInterval Duration `yaml:"check_interval"`
}

type Config struct {
	TenantID     string     `yaml:"tenant_id"`
	AgentToken   string     `yaml:"agent_token"`
	CloudURL     string     `yaml:"cloud_url"`
	PollInterval Duration   `yaml:"poll_interval"`
	RequestDelay Duration   `yaml:"request_delay"`
	LogFile      string     `yaml:"log_file"`
	Devices      []Device   `yaml:"devices"`
	Discovery    Discovery  `yaml:"discovery"`
	AutoUpdate   AutoUpdate `yaml:"auto_update"`

	// FullRawCapture controls whether every OID under the Printer-MIB
	// subtree is captured verbatim alongside the parsed fields (see
	// collector.Metric.Raw). Defaults to true - unset it to false to shrink
	// payload size/poll duration once the parsed fields are all you need.
	FullRawCapture *bool `yaml:"full_raw_capture"`

	// DiscoveredFilePath is computed from the config file's location, not
	// read from YAML: it's the sidecar file (discovered.yaml, next to
	// config.yaml) where devices found by Discovery are persisted so they
	// survive an agent restart without needing to be re-discovered.
	DiscoveredFilePath string `yaml:"-"`
}

// DatedLogPath inserts t's date (YYYY-MM-DD) before path's extension, e.g.
// "omniprint-agent.log" -> "omniprint-agent-2026-09-18.log". Used for the
// agent's daily log rotation (see internal/svc's rotateLogIfNeeded) - added
// after a real incident where a single ever-growing log file made it hard
// to know which day's content a support snapshot even covered, and the
// tenant panel had no way to browse more than "whatever's there right now".
func DatedLogPath(path string, t time.Time) string {
	ext := filepath.Ext(path)
	base := path[:len(path)-len(ext)]
	return fmt.Sprintf("%s-%s%s", base, t.Format("2006-01-02"), ext)
}

// FullRawCaptureEnabled returns the effective value, defaulting to true.
func (c *Config) FullRawCaptureEnabled() bool {
	return c.FullRawCapture == nil || *c.FullRawCapture
}

// AutoUpdateEnabled returns the effective value, defaulting to true - new
// installs self-update unless the admin explicitly opts out.
func (c *Config) AutoUpdateEnabled() bool {
	return c.AutoUpdate.Enabled == nil || *c.AutoUpdate.Enabled
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	cfg.DiscoveredFilePath = filepath.Join(filepath.Dir(path), "discovered.yaml")
	if discovered, err := LoadDeviceFile(cfg.DiscoveredFilePath); err == nil {
		cfg.Devices, _ = MergeDevices(cfg.Devices, discovered)
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *Config) validate() error {
	if c.TenantID == "" {
		return fmt.Errorf("tenant_id is required")
	}
	if c.AgentToken == "" {
		return fmt.Errorf("agent_token is required")
	}
	if c.CloudURL == "" {
		return fmt.Errorf("cloud_url is required")
	}
	if c.PollInterval.Duration() <= 0 {
		c.PollInterval = Duration(30 * time.Minute)
	}
	if c.RequestDelay.Duration() <= 0 {
		c.RequestDelay = Duration(500 * time.Millisecond)
	}
	if len(c.Devices) == 0 && !c.Discovery.Enabled {
		return fmt.Errorf("at least one device must be configured, or enable discovery")
	}
	for i, d := range c.Devices {
		if d.Host == "" {
			return fmt.Errorf("devices[%d]: host is required", i)
		}
		if d.Community == "" {
			c.Devices[i].Community = "public"
		}
		if d.Port == 0 {
			c.Devices[i].Port = 161
		}
	}
	if c.Discovery.Enabled {
		if c.Discovery.Community == "" {
			c.Discovery.Community = "public"
		}
		if c.Discovery.Interval.Duration() <= 0 {
			c.Discovery.Interval = Duration(24 * time.Hour)
		}
		if c.Discovery.Concurrency <= 0 {
			c.Discovery.Concurrency = 8
		}
		if c.Discovery.ProbeTimeout.Duration() <= 0 {
			c.Discovery.ProbeTimeout = Duration(800 * time.Millisecond)
		}
	}
	if c.AutoUpdate.CheckInterval.Duration() <= 0 {
		c.AutoUpdate.CheckInterval = Duration(6 * time.Hour)
	}
	return nil
}

// deviceFile is the shape of the discovered.yaml sidecar file.
type deviceFile struct {
	Devices []Device `yaml:"devices"`
}

func LoadDeviceFile(path string) ([]Device, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var df deviceFile
	if err := yaml.Unmarshal(data, &df); err != nil {
		return nil, err
	}
	return df.Devices, nil
}

func SaveDeviceFile(path string, devices []Device) error {
	out, err := yaml.Marshal(deviceFile{Devices: devices})
	if err != nil {
		return fmt.Errorf("marshal devices: %w", err)
	}
	if err := os.WriteFile(path, out, 0644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	// Holds real SNMP community strings ("passwords" for discovered
	// printers) in plaintext - same exposure config.yaml's agent_token had
	// before its own icacls lockdown, just missed the first time.
	if err := RestrictFileAcl(path); err != nil {
		log.Printf("warning: failed to restrict permissions on %s: %v", path, err)
	}
	return nil
}

// MergeDevices appends devices from extra that aren't already present in
// existing (matched by Host), returning the merged list and just the ones
// that were newly added.
func MergeDevices(existing, extra []Device) (merged []Device, added []Device) {
	seen := make(map[string]bool, len(existing))
	for _, d := range existing {
		seen[d.Host] = true
	}
	merged = existing
	for _, d := range extra {
		if !seen[d.Host] {
			merged = append(merged, d)
			added = append(added, d)
			seen[d.Host] = true
		}
	}
	return merged, added
}
