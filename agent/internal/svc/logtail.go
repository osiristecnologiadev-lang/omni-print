package svc

import (
	"bytes"
	"io"
	"os"
)

// maxLogTailBytes bounds how much of the log file readLogTail returns -
// the file has no rotation or size cap (O_APPEND-only since the agent was
// first opened, see cmd/agent/main.go), so it could be months old and much
// larger than anything worth uploading for a single troubleshooting
// snapshot. Comfortably under UploadLogDto's 300_000-char server-side cap
// (api/src/agent-log/dto/upload-log.dto.ts).
const maxLogTailBytes = 200_000

// readLogTail returns up to the last maxLogTailBytes of path, trimmed
// forward to the next newline so the result never starts mid-line (unless
// the whole file is smaller than the cap, in which case it's returned in
// full). A missing/unreadable file returns an error - the caller decides
// whether that's worth surfacing.
func readLogTail(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", err
	}

	size := info.Size()
	start := int64(0)
	if size > maxLogTailBytes {
		start = size - maxLogTailBytes
	}

	if _, err := f.Seek(start, 0); err != nil {
		return "", err
	}
	buf := make([]byte, size-start)
	if _, err := io.ReadFull(f, buf); err != nil {
		return "", err
	}

	if start > 0 {
		// Don't ship a truncated first line - skip up to (and including)
		// the first newline so the tail always starts cleanly.
		if idx := bytes.IndexByte(buf, '\n'); idx >= 0 {
			buf = buf[idx+1:]
		}
	}
	return string(buf), nil
}
