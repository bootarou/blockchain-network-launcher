// Package notify shows Windows toast notifications.
//
// Notifications are the only way the tray reports the outcome of an operation
// while the menu is closed, but a failure to display one must never affect the
// operation itself, so every error is logged and swallowed.
package notify

import "github.com/gen2brain/beeep"

// Logger is the subset of the application logger this package needs.
type Logger interface {
	Warnf(format string, args ...any)
}

// Notifier shows toasts.
type Notifier struct {
	log Logger
}

// New returns a Notifier.
func New(log Logger) *Notifier { return &Notifier{log: log} }

// Show displays a notification.
func (n *Notifier) Show(title, message string) {
	if err := beeep.Notify(title, message, ""); err != nil && n.log != nil {
		n.log.Warnf("notification failed: %v", err)
	}
}
