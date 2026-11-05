//go:build !windows

package power

import "context"

// Servers running the agent on Linux don't idle-sleep in practice.
func keepAwake(context.Context) error { return nil }
