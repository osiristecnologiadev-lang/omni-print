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

func TestReadLogTailReturnsWholeFileWhenSmall(t *testing.T) {
	content := "line one\nline two\nline three\n"
	path := writeTempLog(t, content)

	got, err := readLogTail(path)
	if err != nil {
		t.Fatalf("readLogTail: %v", err)
	}
	if got != content {
		t.Errorf("got %q, want the whole file %q", got, content)
	}
}

func TestReadLogTailTrimsToACleanLineBoundaryWhenLarge(t *testing.T) {
	// Fixed-width lines so it's easy to reason about exactly how many bytes
	// the file has and where a naive byte-offset cut would land mid-line.
	const line = "2026/09/17 12:00:00 discovery: scanning 10.0.0.0/24 (254 hosts)\n"
	lineCount := (maxLogTailBytes/len(line))*3 + 10 // well past the cap
	var b strings.Builder
	for i := 0; i < lineCount; i++ {
		b.WriteString(strconv.Itoa(i))
		b.WriteString(": ")
		b.WriteString(line)
	}
	full := b.String()
	path := writeTempLog(t, full)

	got, err := readLogTail(path)
	if err != nil {
		t.Fatalf("readLogTail: %v", err)
	}

	if len(got) >= len(full) {
		t.Fatalf("expected a tail shorter than the full %d-byte file, got %d bytes", len(full), len(got))
	}
	if len(got) > maxLogTailBytes {
		t.Errorf("tail is %d bytes, want <= maxLogTailBytes (%d)", len(got), maxLogTailBytes)
	}
	if !strings.HasSuffix(full, got) {
		t.Errorf("tail is not a suffix of the original file")
	}
	// Every real line here contains ": " right after its leading index -
	// if the tail started mid-line, the very first "\n" it contains would
	// be sooner than the length of one full line.
	if firstNewline := strings.IndexByte(got, '\n'); firstNewline >= 0 && firstNewline < len(line)-10 {
		t.Errorf("tail looks like it starts mid-line: first line is %q", got[:firstNewline+1])
	}
}

func TestReadLogTailMissingFile(t *testing.T) {
	if _, err := readLogTail(filepath.Join(t.TempDir(), "does-not-exist.log")); err == nil {
		t.Error("expected an error for a missing file, got nil")
	}
}
