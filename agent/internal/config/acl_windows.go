//go:build windows

package config

import (
	"fmt"
	"os/exec"
	"os/user"
)

// RestrictFileAcl locks a file down to only the account currently running
// this process. Program Files' default NTFS ACL grants the built-in Users
// group Read&Execute, so without this any other local, unprivileged
// account could read whatever this file holds - discovered.yaml's SNMP
// community strings, or the agent's own log content.
//
// Unlike config.yaml (written once by the elevated installer, then only
// ever read back by the service running as LocalSystem - see the
// installer's own icacls call), discovered.yaml and the log file are
// written AND read back by whichever identity is CURRENTLY running the
// agent: LocalSystem for the installed service, but potentially a regular,
// non-admin developer account for a manual foreground run (see README's
// dev flow). Granting a hardcoded Administrators/SYSTEM pair would lock the
// running process itself out whenever that's not who it is - os/user.Current
// resolves to whichever of those is actually true right now, so this works
// correctly for both. Uid on Windows is the account's SID string.
//
// Best-effort: the caller logs a failure rather than treating it as fatal,
// since the agent works correctly either way.
func RestrictFileAcl(path string) error {
	u, err := user.Current()
	if err != nil {
		return fmt.Errorf("resolve current user: %w", err)
	}
	return exec.Command("icacls.exe", path, "/inheritance:r", "/grant:r", "*"+u.Uid+":F").Run()
}
