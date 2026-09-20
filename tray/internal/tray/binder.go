package tray

import (
	"fyne.io/systray"

	"github.com/bootarou/bnl-tray/internal/bnl"
)

// tooltipLimit is the length Windows truncates tray tooltips at.
const tooltipLimit = 63

// apply is the single place that decides which menu items are available.
//
// Everything is re-evaluated from the snapshot on every change, so the state
// matrix in section 5.2 of the plan has exactly one implementation and items can
// never be left enabled by a missed edge case.
func (m *menu) apply(snap bnl.Snapshot) {
	m.header.SetTitle(snap.Header())
	systray.SetTooltip(truncate(snap.Tooltip(), tooltipLimit))

	// While an operation is in flight, every action that could start a second
	// one is disabled.
	if snap.State.Transitional() {
		m.open.Disable()
		m.start.Disable()
		m.stop.Disable()
		m.refresh.Disable()
		return
	}
	m.refresh.Enable()

	// Enablement follows the observed environment, not the display state: after
	// a failure the header shows an error while the buttons still reflect
	// whether BNL is actually running.
	switch snap.Observed {
	case bnl.StateRunning:
		m.open.Enable()
		m.start.Disable()
		m.stop.Enable()
	case bnl.StateStopped:
		m.open.Disable()
		m.start.Enable()
		m.stop.Disable()
	case bnl.StateNotInstalled, bnl.StateWslMissing:
		// Setup is not performed by this application; the user is pointed at
		// BNL-Setup.bat instead.
		m.open.Disable()
		m.start.Disable()
		m.stop.Disable()
	default: // StateUnknown: the installation has never been verified.
		// Start stays available on purpose - pressing it runs the deep probe
		// that resolves the state, so an unknown state is never a dead end.
		m.open.Disable()
		m.start.Enable()
		m.stop.Disable()
	}
}

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit]
}
