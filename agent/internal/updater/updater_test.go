package updater

import "testing"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		in                  string
		major, minor, patch int
		ok                  bool
	}{
		{"0.1.0", 0, 1, 0, true},
		{"1.20.3", 1, 20, 3, true},
		{"0.9.0", 0, 9, 0, true},
		{"0.10.0", 0, 10, 0, true},
		{"dev", 0, 0, 0, false},
		{"1.2", 0, 0, 0, false},
		{"1.2.3.4", 0, 0, 0, false},
		{"1.2.x", 0, 0, 0, false},
		{"", 0, 0, 0, false},
	}
	for _, tt := range tests {
		major, minor, patch, ok := ParseVersion(tt.in)
		if ok != tt.ok {
			t.Errorf("ParseVersion(%q) ok = %v, want %v", tt.in, ok, tt.ok)
			continue
		}
		if !ok {
			continue
		}
		if major != tt.major || minor != tt.minor || patch != tt.patch {
			t.Errorf("ParseVersion(%q) = (%d,%d,%d), want (%d,%d,%d)",
				tt.in, major, minor, patch, tt.major, tt.minor, tt.patch)
		}
	}
}

func TestIsNewer(t *testing.T) {
	tests := []struct {
		current, candidate string
		want               bool
	}{
		{"0.1.0", "0.2.0", true},
		{"0.2.0", "0.1.0", false},
		{"0.1.0", "0.1.0", false}, // equal is not "newer"
		// The classic string-sort trap: "0.10.0" must beat "0.9.0" when
		// compared as real integers, even though "0.10.0" < "0.9.0" as a
		// plain string.
		{"0.9.0", "0.10.0", true},
		{"0.10.0", "0.9.0", false},
		{"1.0.0", "0.99.99", false},
		{"0.99.99", "1.0.0", true},
		{"1.2.3", "1.2.4", true},
		{"1.2.4", "1.2.3", false},
		// Malformed/unknown versions never trigger an update - safer to
		// skip than to guess.
		{"dev", "0.1.0", false},
		{"0.1.0", "dev", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got := IsNewer(tt.current, tt.candidate)
		if got != tt.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", tt.current, tt.candidate, got, tt.want)
		}
	}
}
