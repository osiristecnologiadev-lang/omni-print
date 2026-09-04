//go:build !windows

package updater

import (
	"context"
	"fmt"
	"os"

	"github.com/kardianos/service"
)

type noopProgram struct{}

func (noopProgram) Start(s service.Service) error { return nil }
func (noopProgram) Stop(s service.Service) error  { return nil }

// Apply on POSIX systems is far simpler than Windows: the kernel lets a
// running executable's file be replaced directly (the process keeps its
// old inode open until it exits), so no detached helper/self-relaunch
// dance is needed here - just swap the file in place and restart the
// service. The caller (internal/svc) is responsible for downloading to a
// path on the same filesystem as ownExePath, so the rename below is atomic.
func Apply(ctx context.Context, downloadedPath, ownExePath string) error {
	if err := os.Chmod(downloadedPath, 0755); err != nil {
		return fmt.Errorf("chmod downloaded binary: %w", err)
	}
	if err := os.Rename(downloadedPath, ownExePath); err != nil {
		return fmt.Errorf("move new binary into place: %w", err)
	}

	svc, err := service.New(noopProgram{}, &service.Config{Name: ServiceName})
	if err != nil {
		return fmt.Errorf("build service handle: %w", err)
	}
	if err := service.Control(svc, "restart"); err != nil {
		return fmt.Errorf("restart service after update: %w", err)
	}
	return nil
}

// RunHelper is Windows-only machinery (see apply_windows.go's detached-
// helper dance) - Apply above already does the whole swap+restart inline,
// so -apply-update should never be invoked on this platform.
func RunHelper(oldExePath string, oldPID int) error {
	return fmt.Errorf("apply-update helper mode is not used on this platform")
}
