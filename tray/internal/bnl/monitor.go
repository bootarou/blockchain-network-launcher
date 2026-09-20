package bnl

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/bootarou/bnl-tray/internal/config"
	"github.com/bootarou/bnl-tray/internal/logging"
	"github.com/bootarou/bnl-tray/internal/probe"
	"github.com/bootarou/bnl-tray/internal/wsl"
)

const (
	tier0Interval = 5 * time.Second
	tier1Interval = 10 * time.Second

	webProbeTimeout   = 1500 * time.Millisecond
	tier0Timeout      = 10 * time.Second
	tier1Timeout      = 15 * time.Second
	deepProbeTimeout  = 90 * time.Second // a deep probe may have to boot the VM
	installStatusPath = "/opt/bnl"
)

// tier1Script collects everything we need from inside WSL in a single wsl.exe
// invocation. It deliberately contains no double quotes so that Windows
// command-line escaping stays predictable.
const tier1Script = "[ -d " + installStatusPath + " ] && echo bnl=1 || echo bnl=0; " +
	"docker info >/dev/null 2>&1 && echo docker=1 || echo docker=0; " +
	"echo manager=$(docker ps --filter name=symbol-manager --format '{{.State}}' 2>/dev/null | head -1); " +
	"echo bind=$(grep -E '^[[:space:]]*BIND_ADDRESS=' " + installStatusPath + "/.env 2>/dev/null | tail -n1 | cut -d= -f2-)"

// Monitor owns the observed state and publishes it to listeners.
//
// It implements the three-tier probe: tier 0 never starts the WSL VM, tier 1
// runs only while the VM is already up, and tier 2 (a deep probe) is reserved
// for explicit user actions.
type Monitor struct {
	runner *wsl.Runner
	log    *logging.Logger
	cache  *config.StateCache

	mu           sync.Mutex
	observed     Snapshot
	transition   State
	inTransition bool
	failure      *Failure
	listeners    []func(Snapshot)

	refreshCh chan bool
	lastTier1 time.Time
	lastKey   string
}

// NewMonitor creates a monitor for the given distribution runner.
func NewMonitor(runner *wsl.Runner, log *logging.Logger, cache *config.StateCache) *Monitor {
	return &Monitor{
		runner:    runner,
		log:       log,
		cache:     cache,
		observed:  Snapshot{State: StateUnknown, BindAddress: cache.Bind()},
		refreshCh: make(chan bool, 4),
	}
}

// OnChange registers a listener. Listeners are called from the monitor
// goroutine, so they must not block.
func (m *Monitor) OnChange(fn func(Snapshot)) {
	m.mu.Lock()
	m.listeners = append(m.listeners, fn)
	m.mu.Unlock()
}

// Snapshot returns the current effective state.
func (m *Monitor) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.effectiveLocked()
}

// Refresh requests a probe. A deep refresh is allowed to start the WSL VM.
func (m *Monitor) Refresh(deep bool) {
	select {
	case m.refreshCh <- deep:
	default: // a probe is already queued
	}
}

// BeginTransition marks an operation as in flight (Starting or Stopping).
func (m *Monitor) BeginTransition(state State) {
	m.mu.Lock()
	m.inTransition = true
	m.transition = state
	m.failure = nil
	snap := m.effectiveLocked()
	m.mu.Unlock()
	m.publish(snap, true)
}

// EndTransition clears the in-flight marker, recording a failure if one
// occurred, and triggers a deep probe to establish the resulting state.
func (m *Monitor) EndTransition(failure *Failure) {
	m.mu.Lock()
	m.inTransition = false
	m.failure = failure
	snap := m.effectiveLocked()
	m.mu.Unlock()
	m.publish(snap, true)
	m.Refresh(true)
}

// Run drives the polling loop until ctx is cancelled.
func (m *Monitor) Run(ctx context.Context, wakeOnStartup bool) {
	m.probe(ctx, wakeOnStartup)

	ticker := time.NewTicker(tier0Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case deep := <-m.refreshCh:
			m.probe(ctx, deep)
		case <-ticker.C:
			m.probe(ctx, false)
		}
	}
}

func (m *Monitor) probe(ctx context.Context, deep bool) {
	observed := m.observe(ctx, deep)

	m.mu.Lock()
	m.observed = observed
	if deep {
		// A user-requested probe supersedes a stale failure banner.
		m.failure = nil
	}
	snap := m.effectiveLocked()
	m.mu.Unlock()

	m.publish(snap, false)
}

// observe performs the tiered probe and returns the environment state.
func (m *Monitor) observe(ctx context.Context, deep bool) Snapshot {
	snap := Snapshot{
		BindAddress:  m.cache.Bind(),
		LastVerified: m.cache.LastCheck(),
	}

	// --- Tier 0: never starts the VM ------------------------------------
	listCtx, cancel := context.WithTimeout(ctx, tier0Timeout)
	distros, err := m.runner.List(listCtx)
	cancel()
	if err != nil {
		if errors.Is(err, wsl.ErrNoDistros) {
			snap.State = StateWslMissing
		} else {
			m.log.Warnf("wsl -l -v failed: %v", err)
			snap.State = StateUnknown
		}
		return snap
	}
	distro, found := wsl.Find(distros, m.runner.Distro)
	if !found || distro.Version != 2 {
		snap.State = StateWslMissing
		return snap
	}

	if probe.Reachable(ctx, snap.WebURL(), webProbeTimeout) {
		// The Web UI answering proves BNL is both installed and running.
		m.cache.Verified(true, snap.BindAddress)
		snap.LastVerified = m.cache.LastCheck()
		snap.State = StateRunning
		return snap
	}

	// --- Tier 1 / Tier 2 -------------------------------------------------
	if !deep && !distro.Running() {
		// The VM is stopped. Inspecting /opt/bnl would start it, so fall back
		// to the cache. Only a cached "installed" is trusted; anything else
		// stays Unknown so that Start remains available.
		if installed, known := m.cache.Installed(); known && installed {
			snap.State = StateStopped
		} else {
			snap.State = StateUnknown
		}
		return snap
	}
	if !deep && time.Since(m.lastTier1) < tier1Interval {
		snap.State = m.lastObservedState()
		return snap
	}

	timeout := tier1Timeout
	if deep {
		timeout = deepProbeTimeout
	}
	probeCtx, cancelProbe := context.WithTimeout(ctx, timeout)
	out, err := m.runner.Bash(probeCtx, tier1Script)
	cancelProbe()
	m.lastTier1 = time.Now()
	if err != nil {
		m.log.Warnf("state probe failed: %v", err)
		snap.State = StateUnknown
		return snap
	}

	fields := parseFields(out)
	installed := fields["bnl"] == "1"
	if bind := fields["bind"]; bind != "" {
		snap.BindAddress = bind
	}
	m.cache.Verified(installed, snap.BindAddress)
	snap.LastVerified = m.cache.LastCheck()

	switch {
	case !installed:
		snap.State = StateNotInstalled
	case strings.EqualFold(fields["manager"], "running"):
		snap.State = StateRunning
	default:
		snap.State = StateStopped
	}
	return snap
}

func (m *Monitor) lastObservedState() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.observed.State
}

// effectiveLocked overlays the application-owned states on the observation.
// Observed is kept intact because menu enablement follows the environment even
// while an error banner is displayed.
func (m *Monitor) effectiveLocked() Snapshot {
	snap := m.observed
	snap.Observed = m.observed.State
	switch {
	case m.inTransition:
		snap.State = m.transition
	case m.failure != nil:
		snap.State = StateError
		snap.Detail = m.failure.Message
	}
	return snap
}

// publish notifies listeners, skipping updates that would not change anything
// visible unless force is set.
func (m *Monitor) publish(snap Snapshot, force bool) {
	key := snap.Header() + "|" + snap.Tooltip() + "|" + snap.State.String() + "|" + snap.Observed.String()

	m.mu.Lock()
	changed := force || key != m.lastKey
	m.lastKey = key
	listeners := make([]func(Snapshot), len(m.listeners))
	copy(listeners, m.listeners)
	m.mu.Unlock()

	if !changed {
		return
	}
	for _, fn := range listeners {
		fn(snap)
	}
}

// parseFields reads the key=value lines emitted by tier1Script.
func parseFields(out string) map[string]string {
	fields := make(map[string]string, 4)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		fields[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return fields
}
