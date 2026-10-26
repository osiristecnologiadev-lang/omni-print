package svc

import (
	"testing"
	"time"
)

func TestDailySweepDue(t *testing.T) {
	at := func(hh, mm int) time.Time { return time.Date(2026, 10, 26, hh, mm, 0, 0, time.Local) }
	cases := []struct {
		name     string
		now      time.Time
		sweptDay string
		polled   pollResult
		want     bool
	}{
		// the real Cartório morning: PC on at 07:51, printers waking up
		{"boot, printers still off", at(7, 52), "", pollResult{0, 18}, false},
		{"before 09:00 even if all answer", at(8, 29), "", pollResult{18, 18}, false},
		{"09:28, 17 of 18 answered (94%)", at(9, 28), "", pollResult{17, 18}, true},
		{"10:00, only 15 of 18 (83%)", at(10, 0), "", pollResult{15, 18}, false},
		{"14:00 fallback, printers or not", at(14, 0), "", pollResult{3, 18}, true},
		{"already swept today", at(15, 0), "2026-10-26", pollResult{18, 18}, false},
		{"swept yesterday", at(9, 30), "2026-10-25", pollResult{18, 18}, true},
		{"nothing known yet", at(9, 0), "", pollResult{0, 0}, true},
	}
	for _, c := range cases {
		if got := dailySweepDue(c.now, c.sweptDay, c.polled); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
