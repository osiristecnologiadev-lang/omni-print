// Package svc wraps the agent as an OS service (Windows Service / systemd)
// using kardianos/service, and drives the poll-then-send and discovery loops.
package svc

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kardianos/service"

	"github.com/omniprint/agent/internal/collector"
	"github.com/omniprint/agent/internal/config"
	"github.com/omniprint/agent/internal/discovery"
	"github.com/omniprint/agent/internal/transport"
	"github.com/omniprint/agent/internal/updater"
)

type program struct {
	cfg         *config.Config
	version     string
	logBasePath string // resolved absolute base path from LogFile, or "" if not configured (see cmd/agent/main.go)
	cancel      context.CancelFunc
	done        chan struct{}

	mu      sync.Mutex
	devices []config.Device // cfg.Devices plus anything discovery has found since startup
	logPath string          // today's actual dated file (config.DatedLogPath(logBasePath, now)), "" if unconfigured
	logDate string          // "YYYY-MM-DD" this logPath was opened for, drives rotateLogIfNeeded
	logFile *os.File        // currently open handle, closed when rotating or stopping

	// Discovery runs in the background (see startDiscovery): a sweep of a
	// big range configured in the panel can take an hour, and polling
	// printers must not stop meanwhile. discovering keeps it to one sweep at
	// a time; discoveryDone hands each sweep's "new printers" count back to
	// run()'s loop, which polls them right away - from the loop itself, so
	// two poll cycles never overlap.
	discovering   atomic.Bool
	discoveryDone chan int
	extraRanges   []string // last ranges fetched from the panel, reused when the fetch fails (guarded by mu)

	updating sync.Mutex // see checkForUpdate
}

// New builds the OS service wrapper. Name/description are set explicitly and
// descriptively - a generic or blank service name reads as suspicious to
// admins and to AV/EDR heuristics inspecting installed services. version is
// this build's own version string (see cmd/agent/main.go's -X main.version
// ldflag) - threaded through so the update checker knows what it's
// currently running. configPath is recorded as a service startup argument
// (Arguments below) so the installed service knows where config.yaml lives
// even though the OS starts it with an unrelated working directory (e.g.
// System32 on Windows) rather than the directory `install` was run from -
// without this, the started service can't find its config at all.
//
// logPath is the BASE path (undated) - New opens today's actual dated file
// itself (rotateLogIfNeeded) rather than leaving that to the caller, since a
// one-shot control command (install/start/stop/uninstall, handled by
// main.go without ever calling Run()) still needs to log its one line
// somewhere, and a long-running Run() needs the exact same open+ACL logic
// again at every midnight - both belong in one place.
func New(cfg *config.Config, version string, configPath string, logPath string) (service.Service, error) {
	svcConfig := &service.Config{
		Name:        updater.ServiceName,
		DisplayName: "OmniPrint Monitoring Agent",
		Description: "Collects printer fleet metrics via SNMP and reports them to the OmniPrint cloud platform.",
		Arguments:   []string{"-config", configPath},
	}
	prg := &program{cfg: cfg, version: version, logBasePath: logPath, done: make(chan struct{}), discoveryDone: make(chan int, 1)}
	if err := prg.rotateLogIfNeeded(); err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	return service.New(prg, svcConfig)
}

// rotateLogIfNeeded opens today's dated log file the first time it's called
// (from New, so even a one-shot control command gets a file to log into),
// and again whenever the date has changed since the last call - see
// config.DatedLogPath. The very first open's error is returned so New can
// fail fast the same way an unopenable log file always has; every later
// call (from run()'s periodic rotation check) is best-effort only - a
// midnight rotation failing should never take down an otherwise-healthy
// agent, so it just logs a warning (to whatever output is still active,
// i.e. the file from before) and keeps using the old file.
func (p *program) rotateLogIfNeeded() error {
	if p.logBasePath == "" {
		return nil
	}
	today := time.Now().Format("2006-01-02")
	p.mu.Lock()
	current := p.logDate
	p.mu.Unlock()
	if current == today {
		return nil
	}

	path := config.DatedLogPath(p.logBasePath, time.Now())
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	if err := config.RestrictFileAcl(path); err != nil {
		log.Printf("warning: failed to restrict permissions on %s: %v", path, err)
	}

	p.mu.Lock()
	old := p.logFile
	p.logFile = f
	p.logPath = path
	p.logDate = today
	p.mu.Unlock()

	log.SetOutput(f)
	if old != nil {
		log.Printf("log rotated to %s", path)
		_ = old.Close()
	}
	return nil
}

func (p *program) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	go p.run(ctx)
	return nil
}

func (p *program) run(ctx context.Context) {
	defer close(p.done)

	p.mu.Lock()
	p.devices = append([]config.Device{}, p.cfg.Devices...)
	p.mu.Unlock()

	col := collector.New(p.cfg.RequestDelay.Duration(), 5*time.Second, 2, p.cfg.FullRawCaptureEnabled())
	tc := transport.New(p.cfg.CloudURL, p.cfg.AgentToken)

	// Remote commands and log requests get their own loop, started before
	// anything slow: they used to share the select below with poll cycles,
	// and a real customer's cycle (Sabin, ~60 printers on remote subnets)
	// ran for over 20 minutes - a "Reiniciar" clicked meanwhile was never
	// picked up at all. See controlLoop.
	go p.controlLoop(ctx, tc)

	if p.cfg.Discovery.Enabled {
		p.startDiscovery(ctx, tc, nil)
	}
	// Both before the first cycle, which can take minutes on a big fleet.
	p.checkForUpdate(ctx, false, nil)
	// Also uploaded once here, not just from dailyUploadTicker below - a
	// service that restarts often (crash loop, an update applying) would
	// otherwise go a full day+ without ever contributing to the per-day
	// history if it never survives long enough for that ticker to fire.
	p.uploadDailyLog(ctx, tc)
	p.cycle(ctx, col, tc)

	pollTicker := time.NewTicker(p.cfg.PollInterval.Duration())
	defer pollTicker.Stop()

	var discoveryC <-chan time.Time
	if p.cfg.Discovery.Enabled {
		discoveryTicker := time.NewTicker(p.cfg.Discovery.Interval.Duration())
		defer discoveryTicker.Stop()
		discoveryC = discoveryTicker.C
	}

	updateTicker := time.NewTicker(p.cfg.AutoUpdate.CheckInterval.Duration())
	defer updateTicker.Stop()

	// Not config-tunable, same reasoning as logCheckTicker above - this
	// builds the per-day log history the tenant panel's Logs screen
	// filters over, independent of whether anyone ever clicks "Buscar log
	// agora". 24h from process start, not aligned to midnight - a service
	// that never restarts still gets one upload a day; one that restarts
	// often gets covered by the startup call above instead (see its
	// comment) and the same-day upsert on the server makes any overlap
	// between the two harmless.
	dailyUploadTicker := time.NewTicker(24 * time.Hour)
	defer dailyUploadTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
			p.cycle(ctx, col, tc)
		case <-discoveryC:
			if !p.startDiscovery(ctx, tc, nil) {
				log.Printf("discovery: previous sweep still running - skipping this scheduled one")
			}
		case added := <-p.discoveryDone:
			if added > 0 {
				// Collect the new ones right away instead of waiting up to a
				// full poll interval for them to show up in the panel.
				p.cycle(ctx, col, tc)
			}
		case <-updateTicker.C:
			p.checkForUpdate(ctx, false, nil)
		case <-dailyUploadTicker.C:
			p.uploadDailyLog(ctx, tc)
		}
	}
}

// controlLoop answers the tenant panel: log rotation, "Buscar log agora" and
// remote commands, every 2 minutes, independent of how long a poll cycle
// or discovery sweep takes. Fixed, not config-tunable - 2 minutes trades a
// bit of constant background traffic across the whole fleet for a request
// that actually feels responsive when someone's mid-troubleshooting.
func (p *program) controlLoop(ctx context.Context, tc *transport.Client) {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := p.rotateLogIfNeeded(); err != nil {
				log.Printf("log rotation: failed to open new log file: %v", err)
			}
			p.checkLogRequest(ctx, tc)
			p.checkCommand(ctx, tc)
		}
	}
}

// currentLogPath reads today's dated log path under the same mutex
// rotateLogIfNeeded writes it with - logPath changes at every midnight
// rotation while the service keeps running, unlike the immutable
// logBasePath it's derived from.
func (p *program) currentLogPath() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.logPath
}

// checkLogRequest asks the API whether a human requested this agent's log
// (see api/src/agent-log/), and if so, uploads the whole day's log file. A
// missing/unconfigured log_file, or any transient network error, is logged
// and simply retried on the next tick - never worth interrupting the
// agent's real job (polling printers) over.
func (p *program) checkLogRequest(ctx context.Context, tc *transport.Client) {
	pending, err := tc.CheckLogRequest(ctx)
	if err != nil {
		log.Printf("log request check failed: %v", err)
		return
	}
	if !pending {
		return
	}
	path := p.currentLogPath()
	if path == "" {
		log.Printf("log requested, but no log_file is configured - nothing to send")
		return
	}
	content, err := readLogFile(path)
	if err != nil {
		log.Printf("log requested, but failed to read %s: %v", path, err)
		return
	}
	if err := tc.UploadLog(ctx, time.Now().Format("2006-01-02"), content); err != nil {
		log.Printf("log upload failed: %v", err)
		return
	}
	log.Printf("uploaded log (%d bytes) in response to a request", len(content))
}

// uploadDailyLog builds the tenant panel's per-day log history (the Logs
// screen's date filter) independently of whether a human ever clicks
// "Buscar log agora" - see dailyUploadTicker and the extra call right after
// startup in run(), both of which land here. Same best-effort posture as
// checkLogRequest: nothing here is worth crashing the agent's real job over.
func (p *program) uploadDailyLog(ctx context.Context, tc *transport.Client) {
	path := p.currentLogPath()
	if path == "" {
		return
	}
	content, err := readLogFile(path)
	if err != nil {
		log.Printf("daily log upload: failed to read %s: %v", path, err)
		return
	}
	if err := tc.UploadLog(ctx, time.Now().Format("2006-01-02"), content); err != nil {
		log.Printf("daily log upload failed: %v", err)
		return
	}
	log.Printf("uploaded daily log snapshot (%d bytes)", len(content))
}

// checkForUpdate asks the API for the latest release and, if it's newer
// than what's currently running, downloads/verifies/applies it - unless
// auto_update is disabled in config.yaml and the release isn't flagged
// mandatory (see config.AutoUpdateEnabled and AgentRelease.mandatory on the
// API side). The check itself always runs regardless of that setting - it
// doubles as the fleet-version check-in (see AgentReleasesController.latest
// on the API side), and a disabled tenant should still be visible as
// "behind on updates", not silent.
//
// force (the remote "Verificar atualização agora" command) also skips the
// auto_update opt-out: a human explicitly asked for this update. The
// returned string is a human-readable outcome for that command's ack;
// beforeApply, if set, receives it right before Apply - Apply stops this
// process, so anything reported afterwards would never be sent.
func (p *program) checkForUpdate(ctx context.Context, force bool, beforeApply func(outcome string)) string {
	// The scheduled check (main loop) and the remote UPDATE command
	// (controlLoop) run on different goroutines - never download/apply twice.
	if !p.updating.TryLock() {
		return "Já existe uma verificação de atualização em andamento"
	}
	defer p.updating.Unlock()

	release, err := updater.CheckLatest(ctx, p.cfg.CloudURL, p.cfg.AgentToken, p.version)
	if err != nil {
		log.Printf("update check failed: %v", err)
		return fmt.Sprintf("Falha ao verificar atualização: %v", err)
	}
	if release == nil || !updater.IsNewer(p.version, release.Version) {
		return fmt.Sprintf("Já está na versão mais recente (v%s)", p.version)
	}
	if !force && !p.cfg.AutoUpdateEnabled() && !release.Mandatory {
		log.Printf("update: version %s available but auto_update is disabled and this release isn't mandatory - skipping", release.Version)
		return ""
	}

	log.Printf("update: applying version %s (mandatory=%v, forced=%v)", release.Version, release.Mandatory, force)

	exePath, err := os.Executable()
	if err != nil {
		log.Printf("update: failed to resolve own executable path: %v", err)
		return fmt.Sprintf("Falha ao atualizar: %v", err)
	}
	// Same directory as the running exe: apply_unix.go's os.Rename needs to
	// be on the same filesystem to be atomic, and apply_windows.go's helper
	// looks for its own binary at this exact path.
	downloadPath := exePath + ".new"
	sha, err := updater.Download(ctx, p.cfg.CloudURL, release.DownloadURL, p.cfg.AgentToken, downloadPath)
	if err != nil {
		log.Printf("update: download failed: %v", err)
		return fmt.Sprintf("Falha ao baixar a v%s: %v", release.Version, err)
	}
	if sha != release.SHA256 {
		log.Printf("update: checksum mismatch (got %s, expected %s) - discarding download", sha, release.SHA256)
		_ = os.Remove(downloadPath)
		return fmt.Sprintf("Download da v%s corrompido (checksum não confere) - descartado", release.Version)
	}

	outcome := fmt.Sprintf("Atualizando de v%s para v%s - o agente reinicia sozinho", p.version, release.Version)
	if beforeApply != nil {
		beforeApply(outcome)
	}
	if err := updater.Apply(ctx, downloadPath, exePath); err != nil {
		log.Printf("update: apply failed: %v", err)
		return fmt.Sprintf("Falha ao aplicar a v%s: %v", release.Version, err)
	}
	// Windows: Apply() just told the SCM to stop this service, so Stop()
	// below is about to be invoked by the OS - no need to cancel ourselves.
	// Unix: Apply() already restarted the service as a separate new
	// process, so this old process should stop polling under a now-stale
	// binary rather than keep running until the OS gets around to it.
	log.Printf("update: applied, shutting down for restart")
	p.cancel()
	return outcome
}

// checkCommand runs a remote command requested from the tenant panel
// (restart / update now / discover now - see api/src/agent-command), polled
// on the same 2-minute tick as checkLogRequest. Every outcome is acked back
// as a short Portuguese sentence the customer page shows as-is. RESTART and
// UPDATE ack BEFORE acting, since both end with this process being stopped.
func (p *program) checkCommand(ctx context.Context, tc *transport.Client) {
	cmd, err := tc.CheckCommand(ctx)
	if err != nil {
		log.Printf("command check failed: %v", err)
		return
	}
	if cmd == nil {
		return
	}
	log.Printf("remote command received: %s (requested at %s)", cmd.Type, cmd.RequestedAt)

	ack := func(result string) {
		if err := tc.AckCommand(ctx, cmd.RequestedAt, result); err != nil {
			log.Printf("command %s: ack failed: %v", cmd.Type, err)
		}
	}

	switch cmd.Type {
	case "DISCOVER":
		ack("Buscando impressoras... (redes adicionais grandes podem levar vários minutos)")
		started := p.startDiscovery(ctx, tc, func(found, added int) {
			ack(fmt.Sprintf("Busca concluída: %d impressora(s) respondendo, %d nova(s)", found, added))
		})
		if !started {
			ack("Já existe uma busca em andamento - as impressoras novas aparecem quando ela terminar")
		}
	case "UPDATE":
		ack(p.checkForUpdate(ctx, true, ack))
	case "RESTART":
		ack("Reiniciando o serviço do agente")
		log.Printf("command RESTART: restarting service")
		if err := updater.RestartService(); err != nil {
			log.Printf("command RESTART failed: %v", err)
			ack(fmt.Sprintf("Falha ao reiniciar: %v", err))
			return
		}
		p.cancel()
	default:
		ack(fmt.Sprintf("Comando %q não é suportado pela v%s do agente", cmd.Type, p.version))
	}
}

// startDiscovery runs one sweep in the background, unless one is already
// running (returns false then). onDone, if set, gets the sweep's outcome.
func (p *program) startDiscovery(ctx context.Context, tc *transport.Client, onDone func(found, added int)) bool {
	if !p.discovering.CompareAndSwap(false, true) {
		return false
	}
	go func() {
		defer p.discovering.Store(false)
		found, added := p.runDiscovery(ctx, tc)
		if onDone != nil {
			onDone(found, added)
		}
		select {
		case p.discoveryDone <- added:
		default: // loop hasn't drained the previous one yet - it'll poll anyway
		}
	}()
	return true
}

// panelRanges fetches the customer's extra ranges from the panel, falling
// back to the last ones fetched when the API is unreachable (this has hit a
// real customer whose DNS intermittently fails to resolve the API).
func (p *program) panelRanges(ctx context.Context, tc *transport.Client) []string {
	ranges, err := tc.DiscoveryRanges(ctx)
	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil {
		log.Printf("discovery: couldn't fetch extra ranges from the panel, using the last known %d: %v", len(p.extraRanges), err)
		return p.extraRanges
	}
	p.extraRanges = ranges
	if len(ranges) > 0 {
		log.Printf("discovery: %d extra range(s) configured in the panel: %v", len(ranges), ranges)
	}
	return ranges
}

// runDiscovery returns how many printers answered this sweep and how many
// of those were new. The fallbacks matter only for the remote "Buscar
// impressoras agora" command on an install with discovery disabled -
// config.validate only fills these defaults in when discovery is enabled.
func (p *program) runDiscovery(ctx context.Context, tc *transport.Client) (found, added int) {
	community := p.cfg.Discovery.Community
	if community == "" {
		community = "public"
	}
	timeout := p.cfg.Discovery.ProbeTimeout.Duration()
	if timeout <= 0 {
		timeout = 800 * time.Millisecond
	}
	devices := discovery.Run(ctx, discovery.Options{
		Ranges:       p.cfg.Discovery.Ranges,
		ExtraRanges:  p.panelRanges(ctx, tc),
		Community:    community,
		Port:         161,
		Concurrency:  p.cfg.Discovery.Concurrency,
		ProbeTimeout: timeout,
		Delay:        100 * time.Millisecond,
	})
	return len(devices), p.addDiscovered(devices)
}

// addDiscovered merges newly found devices into the in-memory poll list and
// persists just the newly-added ones to the discovered.yaml sidecar file, so
// they're picked up immediately without waiting for a restart, and survive
// one if it happens. Returns how many were new.
func (p *program) addDiscovered(found []config.Device) int {
	if len(found) == 0 {
		return 0
	}

	p.mu.Lock()
	merged, added := config.MergeDevices(p.devices, found)
	p.devices = merged
	p.mu.Unlock()

	if len(added) == 0 {
		return 0
	}
	for _, d := range added {
		log.Printf("discovery: found new printer %q at %s", d.Name, d.Host)
	}

	existing, _ := config.LoadDeviceFile(p.cfg.DiscoveredFilePath)
	persisted, _ := config.MergeDevices(existing, added)
	if err := config.SaveDeviceFile(p.cfg.DiscoveredFilePath, persisted); err != nil {
		log.Printf("discovery: failed to persist discovered devices: %v", err)
	}
	return len(added)
}

func (p *program) activeDevices() []config.Device {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]config.Device, len(p.devices))
	copy(out, p.devices)
	return out
}

func (p *program) cycle(ctx context.Context, col *collector.Collector, tc *transport.Client) {
	start := time.Now()
	metrics := col.PollAll(ctx, p.activeDevices())
	online := 0
	for _, m := range metrics {
		if m.Online {
			online++
		}
	}
	// Logged every cycle: a cycle's duration was invisible until a real
	// customer's ran for 20+ minutes and nothing in the log said so.
	log.Printf("poll: %d device(s) polled in %s, %d answered", len(metrics), time.Since(start).Round(time.Second), online)
	if err := tc.SendMetrics(ctx, p.cfg.TenantID, metrics); err != nil {
		log.Printf("failed to send metrics: %v", err)
	}
}

func (p *program) Stop(s service.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
	}
	p.mu.Lock()
	f := p.logFile
	p.mu.Unlock()
	if f != nil {
		_ = f.Close()
	}
	return nil
}
