//go:build !windows

package config

import "os"

// RestrictFileAcl is the POSIX equivalent of the Windows icacls lockdown -
// owner-only read/write. The agent normally runs as root on this platform,
// so this still leaves the file unreadable to any other local account.
func RestrictFileAcl(path string) error {
	return os.Chmod(path, 0o600)
}
