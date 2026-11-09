//go:build !windows

package usbprint

import (
	"context"

	"github.com/omniprint/agent/internal/collector"
)

// USB printers are read through the Windows print spooler; agents on other
// systems only monitor network printers.
func Poll(context.Context, string) []collector.Metric { return nil }
