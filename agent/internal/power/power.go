// Package power keeps the host from idle-sleeping while the agent runs.
//
// Why: an agent can only read printers while its machine is awake. Found
// for real at Sabin (2026-10/11): the agent's Windows host went to sleep
// after ~15 idle minutes and woke up on its own only every ~17 hours, so
// the panel got one short burst of readings per wake instead of a reading
// every poll interval - and each billing period started/ended on whichever
// reading happened to exist. Nobody at the customer has to change a power
// plan: the agent asks Windows itself.
//
// Only IDLE sleep is blocked - the same request a video player makes. A
// user can still put the machine to sleep, close a laptop lid or shut it
// down, and the request ends with the service.
package power

import "context"

// KeepAwake blocks idle sleep until ctx is done. It returns once the
// request is in place (or failed); err is nil on platforms where there is
// nothing to do.
func KeepAwake(ctx context.Context) error {
	return keepAwake(ctx)
}
