package svc

import (
	"bytes"
	"io"
	"os"
)

// maxLogFileBytes is a defense-in-depth ceiling, not the normal case - now
// that logs rotate daily (see config.DatedLogPath), one day's file is
// expected to stay far under this. Only kicks in for a genuinely
// pathological day (a crash loop logging far more than usual); when it
// does, keeps the most recent bytes rather than the oldest, same
// reasoning this file's old tail-only design always had. Comfortably
// under UploadLogDto's 2_000_000-char server-side cap
// (api/src/agent-log/dto/upload-log.dto.ts).
const maxLogFileBytes = 2_000_000

// readLogFile returns the log file's full content - the whole day's log,
// not just a tail. A tail-only read used to be the norm here (the file had
// no rotation, so the tail was the only sane thing to ship), but that made
// real troubleshooting harder once daily rotation shipped: a human
// analyzing "Buscar log agora"/the daily-upload snapshot wants everything
// that happened that day, not an arbitrarily-cut recent slice. Falls back
// to the last maxLogFileBytes (trimmed to a clean line boundary) only if
// the file exceeds that ceiling - expected to be rare now. A
// missing/unreadable file returns an error - the caller decides whether
// that's worth surfacing.
func readLogFile(path string) (string, error) {
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
	if size > maxLogFileBytes {
		start = size - maxLogFileBytes
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
		// the first newline so a trimmed result still starts cleanly.
		if idx := bytes.IndexByte(buf, '\n'); idx >= 0 {
			buf = buf[idx+1:]
		}
	}
	return string(buf), nil
}
