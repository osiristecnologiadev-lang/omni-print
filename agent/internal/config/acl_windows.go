//go:build windows

package config

import (
	"fmt"
	"os/exec"
	"os/user"
)

// RestrictFileAcl locks a file down to Administrators, SYSTEM, and
// whoever is currently running this process. Program Files' default NTFS
// ACL grants the built-in Users group Read&Execute, so without this any
// other local, unprivileged account could read whatever this file holds -
// discovered.yaml's SNMP community strings, or the agent's own log
// content.
//
// Real incident this got wrong once already: an earlier version of this
// function granted ONLY the current runtime identity (reasoning: the
// installed service runs as LocalSystem, so a hardcoded Administrators/
// SYSTEM pair would lock the running process itself out on a non-admin
// dev's manual foreground run). That's still true and still handled here
// (the *u.Uid grant below) - but it missed a THIRD reader this file
// genuinely needs: a human troubleshooting the agent by opening
// omniprint-agent.log directly, on a machine where the agent runs as the
// SYSTEM-owned service. A real support session hit exactly this - the log
// existed, the service could write it, but no human account, including a
// full local Administrator's normal (non-elevated) desktop session, could
// open it, because SYSTEM-only doesn't cover "Administrators" at all.
// Administrators/SYSTEM here (well-known SIDs, language-independent) lets
// an admin read it after elevating ("Run as Administrator"), which any IT
// staff troubleshooting a Windows service already knows to do.
//
// Best-effort: the caller logs a failure rather than treating it as fatal,
// since the agent works correctly either way.
func RestrictFileAcl(path string) error {
	u, err := user.Current()
	if err != nil {
		return fmt.Errorf("resolve current user: %w", err)
	}
	return exec.Command("icacls.exe", path, "/inheritance:r", "/grant:r",
		"*S-1-5-32-544:F", "*S-1-5-18:F", "*"+u.Uid+":F").Run()
}
