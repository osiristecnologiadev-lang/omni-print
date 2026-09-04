// Package updater checks the OmniPrint API for a newer agent build,
// downloads and verifies it, and applies it to the already-installed
// agent. The actual file-swap/service-restart mechanics are platform
// specific - see apply_windows.go and apply_unix.go.
package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ServiceName is the fixed Windows Service / systemd unit name registered
// by internal/svc - constant across every binary version, so the update
// helper can control it without needing an in-memory *service.Service from
// the (about to exit) old process.
const ServiceName = "OmniPrintAgent"

// Release is what GET /v1/agent/releases/latest returns.
type Release struct {
	ID           string `json:"id"`
	Version      string `json:"version"`
	Mandatory    bool   `json:"mandatory"`
	ReleaseNotes string `json:"releaseNotes"`
	SHA256       string `json:"sha256"`
	DownloadURL  string `json:"downloadUrl"` // relative to baseURL
}

// PlatformParam is what the API's AgentRelease.platform enum expects -
// derived from runtime.GOOS, not hardcoded, so cross-compiling for a new
// GOOS doesn't silently query the wrong platform's releases.
func PlatformParam() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return "WINDOWS", nil
	case "linux":
		return "LINUX", nil
	default:
		return "", fmt.Errorf("no agent release platform mapped for GOOS %q", runtime.GOOS)
	}
}

// CheckLatest asks the API for the latest release for this platform. A nil
// Release (with nil error) means no release has been published yet for
// this platform - not an error condition.
func CheckLatest(ctx context.Context, baseURL, token, currentVersion string) (*Release, error) {
	platform, err := PlatformParam()
	if err != nil {
		return nil, err
	}

	q := url.Values{}
	q.Set("platform", platform)
	if currentVersion != "" {
		q.Set("currentVersion", currentVersion)
	}
	reqURL := strings.TrimRight(baseURL, "/") + "/v1/agent/releases/latest?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("check latest release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status checking latest release: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}
	if strings.TrimSpace(string(body)) == "null" || len(body) == 0 {
		return nil, nil
	}

	var release Release
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}
	return &release, nil
}

// Download streams the release binary to destPath, hashing as it writes,
// and returns the digest actually computed from the bytes on disk - the
// caller compares this against Release.SHA256 itself rather than trusting
// it blindly, which catches transport corruption/truncated downloads. This
// is not a substitute for code-signing verification (see agent/README.md's
// code-signing section) - that needs a certificate this project doesn't
// have yet; the checksum-over-HTTPS check here is the baseline defense
// available without one.
func Download(ctx context.Context, baseURL, downloadURL, token, destPath string) (sha256Hex string, err error) {
	reqURL := downloadURL
	if !strings.HasPrefix(downloadURL, "http://") && !strings.HasPrefix(downloadURL, "https://") {
		reqURL = strings.TrimRight(baseURL, "/") + downloadURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status downloading release: %s", resp.Status)
	}

	f, err := os.OpenFile(destPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		return "", fmt.Errorf("create %s: %w", destPath, err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(f, h), resp.Body); err != nil {
		return "", fmt.Errorf("writing downloaded release: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// ParseVersion splits a "major.minor.patch" string into its integer parts.
// ok is false for anything else (pre-release suffixes, malformed strings,
// "dev" builds) - callers should treat that as "can't compare, don't
// update" rather than guessing.
func ParseVersion(v string) (major, minor, patch int, ok bool) {
	parts := strings.SplitN(v, ".", 3)
	if len(parts) != 3 {
		return 0, 0, 0, false
	}
	nums := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0, 0, 0, false
		}
		nums[i] = n
	}
	return nums[0], nums[1], nums[2], true
}

// IsNewer reports whether candidate is a strictly newer version than
// current. Compares the parsed (major,minor,patch) tuple - never a string
// comparison, which would wrongly rank "0.10.0" below "0.9.0". Returns
// false (not an error) if either string doesn't parse, so a malformed or
// unknown current version never triggers an update - safer to skip than to
// guess.
func IsNewer(current, candidate string) bool {
	cMajor, cMinor, cPatch, ok1 := ParseVersion(current)
	nMajor, nMinor, nPatch, ok2 := ParseVersion(candidate)
	if !ok1 || !ok2 {
		return false
	}
	if nMajor != cMajor {
		return nMajor > cMajor
	}
	if nMinor != cMinor {
		return nMinor > cMinor
	}
	return nPatch > cPatch
}
