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

// UploadLog sends the requested log tail (see internal/svc/logtail.go for
// how it's trimmed before this is called - never the whole file).
func (c *Client) UploadLog(ctx context.Context, content string) error {
	body, err := json.Marshal(struct {
		Content string `json:"content"`
	}{Content: content})
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
