//go:build windows

package power

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"golang.org/x/sys/windows"
)

const (
	esSystemRequired = 0x00000001
	esContinuous     = 0x80000000
)

var (
	kernel32                    = windows.NewLazySystemDLL("kernel32.dll")
	procSetThreadExecutionState = kernel32.NewProc("SetThreadExecutionState")
)

func setState(flags uint32) bool {
	r, _, _ := procSetThreadExecutionState.Call(uintptr(flags))
	return r != 0 // previous state; 0 = the call failed
}

// SetThreadExecutionState belongs to the calling OS THREAD (Windows drops
// it when that thread exits), and goroutines hop between threads - so the
// request lives on one locked thread for the whole run. Re-asserted every
// few minutes as well: cheap, and it also resets the idle timer in case
// anything ever cleared the continuous request.
func keepAwake(ctx context.Context) error {
	result := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		if !setState(esContinuous | esSystemRequired) {
			result <- fmt.Errorf("SetThreadExecutionState failed")
			return
		}
		result <- nil

		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				setState(esContinuous) // back to normal power management
				return
			case <-ticker.C:
				setState(esContinuous | esSystemRequired)
			}
		}
	}()
	return <-result
}
