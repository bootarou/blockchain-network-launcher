// Package probe checks whether the BNL Web UI is reachable.
//
// This probe is deliberately cheap and runs against 127.0.0.1 from Windows: it
// tells us BNL is running without starting the WSL VM.
package probe

import (
	"context"
	"net/http"
	"time"
)

// Reachable reports whether url answers with an HTTP status below 500.
//
// The same acceptance rule as BNL-Start.bat is used: any 1xx-4xx response means
// the dev server is up, even if the specific path returns 404.
func Reachable(ctx context.Context, url string, timeout time.Duration) bool {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	client := &http.Client{
		Timeout: timeout,
		// A redirect still proves the server answered.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 100 && resp.StatusCode < 500
}
