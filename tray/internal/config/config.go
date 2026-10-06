// Package config persists the tray settings and the last observed BNL state.
//
// Two files are kept in %LOCALAPPDATA%\BNL:
//
//	tray-settings.json  user preferences
//	tray-state.json     cache of the last verified state
//
// The state cache exists because `/opt/bnl` cannot be inspected while the WSL VM
// is stopped without starting it. Remembering the last verified answer lets the
// tray show "Stopped" instead of "Unknown" without waking WSL on every poll.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/bootarou/bnl-tray/internal/logging"
)

const (
	settingsFile = "tray-settings.json"
	stateFile    = "tray-state.json"

	// DefaultBindAddress matches install.ps1's default.
	DefaultBindAddress = "127.0.0.1"
)

// Settings holds the user-visible preferences from the Settings submenu.
type Settings struct {
	StartWithWindows      bool `json:"startWithWindows"`
	WakeWSLOnStartup      bool `json:"wakeWslOnStartup"`
	OpenBrowserAfterStart bool `json:"openBrowserAfterStart"`

	mu   sync.Mutex
	path string
}

// LoadSettings reads the settings file, returning defaults when it is absent.
func LoadSettings() *Settings {
	s := &Settings{OpenBrowserAfterStart: true}
	dir, err := logging.Dir()
	if err != nil {
		return s
	}
	s.path = filepath.Join(dir, settingsFile)

	data, err := os.ReadFile(s.path)
	if err != nil {
		return s
	}
	_ = json.Unmarshal(data, s)
	return s
}

// Save writes the settings file. Failures are ignored: a preference that cannot
// be persisted must not stop the application.
func (s *Settings) Save() {
	if s == nil || s.path == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o644)
}

// StateCache remembers what was last verified about the BNL installation.
type StateCache struct {
	// InstalledKnown is nil until the installation has actually been verified
	// inside WSL. nil means "unknown", not "not installed" — the difference
	// decides whether Start is offered (see the state matrix in the plan).
	InstalledKnown *bool     `json:"installedKnown,omitempty"`
	LastVerified   time.Time `json:"lastVerifiedUtc,omitempty"`
	BindAddress    string    `json:"bindAddress,omitempty"`

	mu   sync.Mutex
	path string
}

// LoadStateCache reads the cached state, returning an empty cache when absent.
func LoadStateCache() *StateCache {
	c := &StateCache{}
	dir, err := logging.Dir()
	if err != nil {
		return c
	}
	c.path = filepath.Join(dir, stateFile)

	data, err := os.ReadFile(c.path)
	if err != nil {
		return c
	}
	_ = json.Unmarshal(data, c)
	return c
}

// Bind returns the cached BIND_ADDRESS, or the installer default.
func (c *StateCache) Bind() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.BindAddress == "" {
		return DefaultBindAddress
	}
	return c.BindAddress
}

// Installed reports the cached installation state and whether it is known.
func (c *StateCache) Installed() (installed, known bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.InstalledKnown == nil {
		return false, false
	}
	return *c.InstalledKnown, true
}

// Verified records a confirmed observation from inside WSL.
func (c *StateCache) Verified(installed bool, bind string) {
	c.mu.Lock()
	c.InstalledKnown = &installed
	c.LastVerified = time.Now().UTC()
	if bind != "" {
		c.BindAddress = bind
	}
	c.mu.Unlock()
	c.save()
}

// LastCheck returns when the installation state was last verified.
func (c *StateCache) LastCheck() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.LastVerified
}

func (c *StateCache) save() {
	if c.path == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(c.path, data, 0o644)
}
