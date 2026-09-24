//go:build !windows

package discovery

// printServerPorts is Windows-only - see printports_windows.go. A Linux host
// running CUPS could be read the same way someday; no customer needs it yet.
func printServerPorts() []printPort { return nil }
