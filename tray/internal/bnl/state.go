package bnl

import (
	"fmt"
	"time"
)

// State is the lifecycle state shown in the tray.
//
// WslMissing/NotInstalled/Stopped/Running are observed from the environment;
// Starting/Stopping/Error are owned by the application while it drives or has
// just finished an operation.
type State int

const (
	// StateUnknown means the installation has never been verified. Start stays
	// enabled here: pressing it performs the deep probe that resolves the state.
	StateUnknown State = iota
	StateWslMissing
	StateNotInstalled
	StateStopped
	StateStarting
	StateRunning
	StateStopping
	StateError
)

// Transitional reports whether an operation is in flight.
func (s State) Transitional() bool {
	return s == StateStarting || s == StateStopping
}

func (s State) String() string {
	switch s {
	case StateWslMissing:
		return "WSL not found"
	case StateNotInstalled:
		return "Not installed"
	case StateStopped:
		return "Stopped"
	case StateStarting:
		return "Starting..."
	case StateRunning:
		return "Running"
	case StateStopping:
		return "Stopping..."
	case StateError:
		return "Error"
	default:
		return "Checking..."
	}
}

// Snapshot is the state as last observed, plus the details the menu needs.
type Snapshot struct {
	// State is what is displayed: the observation, or Starting/Stopping/Error
	// when the application owns the state.
	State State
	// Observed is the last environment observation and never holds an
	// application-owned state. Menu enablement follows this field, so an error
	// banner does not change which actions are available.
	Observed     State
	BindAddress  string
	LastVerified time.Time
	// Detail carries the failure message after a failed operation.
	Detail string
}

// WebURL is the address of the BNL Web UI.
func (s Snapshot) WebURL() string {
	bind := s.BindAddress
	if bind == "" || bind == "0.0.0.0" {
		// 0.0.0.0 is a listen address, not something a browser can open.
		bind = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:5173", bind)
}

// Header is the first, disabled menu entry: the one-line status line.
func (s Snapshot) Header() string {
	switch s.State {
	case StateRunning:
		return "BNL — Running"
	case StateStopped:
		if age, ok := s.checkedAgo(); ok {
			return "BNL — Stopped (checked " + age + " ago)"
		}
		return "BNL — Stopped"
	case StateNotInstalled:
		return "BNL — Not installed (run BNL-Setup.bat)"
	case StateWslMissing:
		return "BNL — WSL2 Ubuntu not found"
	case StateError:
		return "BNL — Error (see log)"
	default:
		return "BNL — " + s.State.String()
	}
}

// Tooltip is the hover text. Windows truncates tray tooltips at 64 characters,
// so this stays short.
func (s Snapshot) Tooltip() string {
	if s.State == StateRunning {
		return "BNL — Running / " + s.BindAddress + ":5173"
	}
	return "BNL — " + s.State.String()
}

func (s Snapshot) checkedAgo() (string, bool) {
	if s.LastVerified.IsZero() {
		return "", false
	}
	d := time.Since(s.LastVerified)
	switch {
	case d < time.Minute:
		return "<1m", true
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes())), true
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours())), true
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24)), true
	}
}
