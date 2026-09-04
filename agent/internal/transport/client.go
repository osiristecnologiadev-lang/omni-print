// Package transport sends collected metrics to the OmniPrint cloud API.
package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
