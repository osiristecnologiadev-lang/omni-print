package svc

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func writeTempLog(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.log")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writing temp log: %v", err)
	}
	return path
}

func TestReadLogFileReturnsWholeFileWhenSmall(t *testing.T) {
	content := "line one\nline two\nline three\n"
	path := writeTempLog(t, content)

	got, err := readLogFile(path)
	if err != nil {
		t.Fatalf("readLogFile: %v", err)
	}
	if got != content {
		t.Errorf("got %q, want the whole file %q", got, content)
	}
}

// A realistic day's worth of rotated log content (well past the OLD
// 200KB tail-only cap this project used to have) should still come back
// in full now - the whole point of this change.
func TestReadLogFileReturnsWholeFileWellPastTheOldTailCap(t *testing.T) {
	const line = "2026/09/18 12:00:00 discovery: scan complete - 0 printer(s) found, 0 answered, 254 timed out, 0 errored\n"
	const oldTailCap = 200_000
	lineCount := (oldTailCap/len(line))*2 + 10
	var b strings.Builder
	for i := 0; i < lineCount; i++ {
		b.WriteString(strconv.Itoa(i))
		b.WriteString(": ")
		b.WriteString(line)
	}
	full := b.String()
	path := writeTempLog(t, full)

	got, err := readLogFile(path)
	if err != nil {
		t.Fatalf("readLogFile: %v", err)
	}
	if got != full {
		t.Errorf("got a %d-byte result, want the whole %d-byte file back", len(got), len(full))
	}
}

func TestReadLogFileTrimsToACleanLineBoundaryWhenPastTheSafetyCeiling(t *testing.T) {
	// Fixed-width lines so it's easy to reason about exactly how many bytes
	// the file has and where a naive byte-offset cut would land mid-line.
	const line = "2026/09/17 12:00:00 discovery: scanning 10.0.0.0/24 (254 hosts)\n"
	lineCount := (maxLogFileBytes/len(line))*2 + 10 // well past the safety ceiling
	var b strings.Builder
	for i := 0; i < lineCount; i++ {
		b.WriteString(strconv.Itoa(i))
		b.WriteString(": ")
		b.WriteString(line)
	}
	full := b.String()
	path := writeTempLog(t, full)

	got, err := readLogFile(path)
	if err != nil {
		t.Fatalf("readLogFile: %v", err)
	}

	if len(got) >= len(full) {
		t.Fatalf("expected a tail shorter than the full %d-byte file, got %d bytes", len(full), len(got))
	}
	if len(got) > maxLogFileBytes {
		t.Errorf("result is %d bytes, want <= maxLogFileBytes (%d)", len(got), maxLogFileBytes)
	}
	if !strings.HasSuffix(full, got) {
		t.Errorf("result is not a suffix of the original file")
	}
	// Every real line here contains ": " right after its leading index -
	// if the tail started mid-line, the very first "\n" it contains would
	// be sooner than the length of one full line.
	if firstNewline := strings.IndexByte(got, '\n'); firstNewline >= 0 && firstNewline < len(line)-10 {
		t.Errorf("tail looks like it starts mid-line: first line is %q", got[:firstNewline+1])
	}
}

func TestReadLogFileMissingFile(t *testing.T) {
	if _, err := readLogFile(filepath.Join(t.TempDir(), "does-not-exist.log")); err == nil {
		t.Error("expected an error for a missing file, got nil")
	}
}
