//go:build !windows

package autostart

// Enabled reports the auto-start state. Always false outside Windows.
func Enabled() bool { return false }

// Set is a no-op outside Windows.
func Set(enabled bool) error { return nil }
