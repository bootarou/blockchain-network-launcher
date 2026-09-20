//go:build !windows

package winproc

import "os/exec"

// Hide is a no-op outside Windows. The application only ships for Windows; this
// stub keeps `go vet ./...` usable on any platform.
func Hide(cmd *exec.Cmd) {}
