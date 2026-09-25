// Package transport sends collected metrics to the OmniPrint cloud API.
package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/omniprint/agent/internal/collector"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

type ingestPayload struct {
	TenantID string             `json:"tenant_id"`
	Metrics  []collector.Metric `json:"metrics"`
}

// SendMetrics posts a batch of metrics to the cloud API, retrying with
// exponential backoff on transient failures (network blip, API briefly down).
func (c *Client) SendMetrics(ctx context.Context, tenantID string, metrics []collector.Metric) error {
	body, err := json.Marshal(ingestPayload{TenantID: tenantID, Metrics: metrics})
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	const maxAttempts = 5
	backoff := time.Second
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/ingest", bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()
		if resp.StatusCode < 300 {
			return nil
		}
		lastErr = fmt.Errorf("unexpected status: %s", resp.Status)
	}
	return fmt.Errorf("send metrics after %d attempts: %w", maxAttempts, lastErr)
}

// CheckLogRequest asks whether a "Buscar log agora" request is pending for
// this token (see api/src/agent-log/) - a single attempt, no retry: this
// runs every 2 minutes (see internal/svc's logCheckTicker), so a transient
// failure here just tries again on the next tick rather than needing its
// own backoff loop like SendMetrics.
func (c *Client) CheckLogRequest(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/agent/log-request", nil)
	if err != nil {
		return false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return false, fmt.Errorf("check log request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected status checking log request: %s", resp.Status)
	}

	var result struct {
		Pending bool `json:"pending"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("parsing response: %w", err)
	}
	return result.Pending, nil
}

// Command is a remote command requested from the tenant panel (see
// api/src/agent-command). RequestedAt identifies the request and must be
// echoed back verbatim in AckCommand.
type Command struct {
	Type        string `json:"command"` // "RESTART", "UPDATE" or "DISCOVER"
	RequestedAt string `json:"requestedAt"`
}

// CheckCommand returns the pending remote command, or nil if there's none.
// Single attempt, same reasoning as CheckLogRequest.
func (c *Client) CheckCommand(ctx context.Context) (*Command, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/agent/command", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("check command: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status checking command: %s", resp.Status)
	}

	var cmd Command
	if err := json.NewDecoder(resp.Body).Decode(&cmd); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}
	if cmd.Type == "" {
		return nil, nil
	}
	return &cmd, nil
}

// DiscoveryRanges fetches the extra ranges configured for this agent's
// customer in the tenant panel ("Redes adicionais") - swept in addition to
// whatever the agent finds on its own. An API that predates the endpoint
// answers 404, which just means "none".
func (c *Client) DiscoveryRanges(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/agent/discovery-config", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch discovery config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status fetching discovery config: %s", resp.Status)
	}

	var cfg struct {
		Ranges []string `json:"ranges"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}
	return cfg.Ranges, nil
}

// AckCommand reports a command's outcome, shown as-is in the tenant panel.
// Can be called more than once for the same request (e.g. "started", then
// the final result) - the latest result wins.
func (c *Client) AckCommand(ctx context.Context, requestedAt, result string) error {
	body, err := json.Marshal(struct {
		RequestedAt string `json:"requestedAt"`
		Result      string `json:"result"`
	}{RequestedAt: requestedAt, Result: result})
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/agent/command/ack", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ack command: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status acking command: %s", resp.Status)
	}
	return nil
}

// UploadLog sends the requested log tail (see internal/svc/logtail.go for
// how it's trimmed before this is called - never the whole file). date is
// the agent-local calendar day (YYYY-MM-DD) this content belongs to - see
// internal/svc's log rotation (config.DatedLogPath) - so the API can keep a
// separate history entry per day instead of overwriting a single blob.
func (c *Client) UploadLog(ctx context.Context, date, content string) error {
	body, err := json.Marshal(struct {
		Date    string `json:"date"`
		Content string `json:"content"`
	}{Date: date, Content: content})
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/agent/log", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("upload log: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status uploading log: %s", resp.Status)
	}
	return nil
}
