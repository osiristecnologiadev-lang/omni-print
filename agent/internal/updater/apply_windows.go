//go:build windows

package updater

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/kardianos/service"
	"golang.org/x/sys/windows"
)

// GetExitCodeProcess reports this value while the process is still
// running - not exported as a named constant by x/sys/windows, but it's a
// stable, documented Win32 value (STILL_ACTIVE, same as STATUS_PENDING).
const stillActive = 259

// noopProgram exists only so Control() has a service.Service to operate
// on - it never actually Starts/Stops through this Interface, only through
// the real Windows SCM, so its methods are never called in practice.
type noopProgram struct{}

func (noopProgram) Start(s service.Service) error { return nil }
func (noopProgram) Stop(s service.Service) error  { return nil }

func controlService(action string) error {
	svc, err := service.New(noopProgram{}, &service.Config{Name: ServiceName})
	if err != nil {
		return fmt.Errorf("build service handle: %w", err)
	}
	return service.Control(svc, action)
}

// Apply is called by the running (old) agent process once a newer release
// has been downloaded to downloadedPath and its checksum verified.
//
// Windows won't let a running process overwrite or delete its own exe
// file, but it will let you rename it - the trick established Go
// self-update libraries rely on. The part that genuinely can't happen from
// inside this process is the service *restart*: a process can't reliably
// keep running code after telling the SCM to stop it. So instead of doing
// the file swap here, this spawns the newly-downloaded binary itself as a
// detached helper (it's already the new code - no separate helper binary
// needed) with a hidden flag identifying the old exe path/PID, then stops
// the service through the normal SCM path (the same one the manual
// "-config config.yaml stop" CLI action already uses). The helper (see
// RunHelper) waits for this process to actually exit, does the rename
// dance, and restarts the service.
func Apply(ctx context.Context, downloadedPath, ownExePath string) error {
	absDownloaded, err := filepath.Abs(downloadedPath)
	if err != nil {
		return fmt.Errorf("resolve downloaded path: %w", err)
	}
	absOwn, err := filepath.Abs(ownExePath)
	if err != nil {
		return fmt.Errorf("resolve own exe path: %w", err)
	}

	cmd := exec.Command(absDownloaded, "-apply-update", absOwn, strconv.Itoa(os.Getpid()))
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn update helper: %w", err)
	}

	// Give the helper a moment to actually get scheduled before this
	// process starts shutting down - avoids a race where the SCM stop
	// completes before the helper has begun waiting on our PID.
	time.Sleep(500 * time.Millisecond)

	if err := controlService("stop"); err != nil {
		return fmt.Errorf("stop service for update: %w", err)
	}
	return nil
}

// RunHelper is executed by the newly-downloaded binary itself, launched by
// Apply above via the hidden -apply-update flag (see cmd/agent/main.go). It
// waits for the old process to exit, swaps the files, and restarts the
// service - deliberately left running the old version if any step fails,
// rather than leaving the install in a half-updated state.
func RunHelper(oldExePath string, oldPID int) error {
	if !waitForProcessExit(oldPID, 30*time.Second) {
		return fmt.Errorf("old process (pid %d) did not exit within timeout, aborting update", oldPID)
	}

	selfPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve own path: %w", err)
	}

	oldBackup := oldExePath + ".old"
	_ = os.Remove(oldBackup) // leftover from a previous update cycle, best-effort

	// oldExePath is no longer running by this point (waited above), so this
	// rename alone doesn't depend on the "rename your own running file"
	// trick - the next one does.
	if err := os.Rename(oldExePath, oldBackup); err != nil {
		return fmt.Errorf("rename old exe out of the way: %w", err)
	}
	// selfPath IS this helper process's own running backing file - renaming
	// it is the permitted operation Windows blocks only for overwrite/delete.
	if err := os.Rename(selfPath, oldExePath); err != nil {
		_ = os.Rename(oldBackup, oldExePath) // restore so the service can still start on the old version
		return fmt.Errorf("move new exe into place: %w", err)
	}
	_ = os.Remove(oldBackup) // best-effort; a lingering .old is harmless and cleaned up next update

	if err := controlService("start"); err != nil {
		return fmt.Errorf("restart service after update: %w", err)
	}
	return nil
}

// waitForProcessExit polls via OpenProcess/GetExitCodeProcess rather than
// os.Process.Signal - Windows only supports os.Kill/SIGTERM through that
// API, not a "still alive?" probe like Unix's kill(pid, 0).
func waitForProcessExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
		if err != nil {
			return true // most likely: no such process anymore
		}
		var code uint32
		getErr := windows.GetExitCodeProcess(h, &code)
		windows.CloseHandle(h)
		if getErr != nil || code != stillActive {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}
