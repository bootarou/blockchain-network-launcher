package bnl

import (
	"testing"
	"time"
)

func TestParseFields(t *testing.T) {
	out := "bnl=1\ndocker=1\nmanager=running\nbind=127.0.0.1\n"
	got := parseFields(out)

	want := map[string]string{"bnl": "1", "docker": "1", "manager": "running", "bind": "127.0.0.1"}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("field %q = %q, want %q", key, got[key], value)
		}
	}
}

func TestParseFieldsEmptyValues(t *testing.T) {
	// A stopped manager and a missing .env both yield empty values.
	got := parseFields("bnl=1\ndocker=0\nmanager=\nbind=\n")
	if got["bnl"] != "1" {
		t.Errorf("bnl = %q, want 1", got["bnl"])
	}
	if got["manager"] != "" {
		t.Errorf("manager = %q, want empty", got["manager"])
	}
}

func TestParseFieldsStripsQuotes(t *testing.T) {
	// BIND_ADDRESS may be quoted in .env.
	got := parseFields(`bind="0.0.0.0"`)
	if got["bind"] != "0.0.0.0" {
		t.Errorf("bind = %q, want 0.0.0.0", got["bind"])
	}
}

func TestWebURL(t *testing.T) {
	tests := []struct {
		bind string
		want string
	}{
		{"127.0.0.1", "http://127.0.0.1:5173"},
		{"192.168.1.10", "http://192.168.1.10:5173"},
		// 0.0.0.0 is a listen address, not something a browser can open.
		{"0.0.0.0", "http://127.0.0.1:5173"},
		{"", "http://127.0.0.1:5173"},
	}
	for _, tt := range tests {
		if got := (Snapshot{BindAddress: tt.bind}).WebURL(); got != tt.want {
			t.Errorf("WebURL(%q) = %q, want %q", tt.bind, got, tt.want)
		}
	}
}

func TestHeader(t *testing.T) {
	tests := []struct {
		name string
		snap Snapshot
		want string
	}{
		{"running", Snapshot{State: StateRunning}, "BNL — Running"},
		{"not installed", Snapshot{State: StateNotInstalled}, "BNL — Not installed (run BNL-Setup.bat)"},
		{"wsl missing", Snapshot{State: StateWslMissing}, "BNL — WSL2 Ubuntu not found"},
		{"unknown", Snapshot{State: StateUnknown}, "BNL — Checking..."},
		{"stopped, never verified", Snapshot{State: StateStopped}, "BNL — Stopped"},
		{
			"stopped with age",
			Snapshot{State: StateStopped, LastVerified: time.Now().Add(-12 * time.Minute)},
			"BNL — Stopped (checked 12m ago)",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.snap.Header(); got != tt.want {
				t.Errorf("Header() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTransitional(t *testing.T) {
	for _, state := range []State{StateStarting, StateStopping} {
		if !state.Transitional() {
			t.Errorf("%v should be transitional", state)
		}
	}
	for _, state := range []State{StateUnknown, StateRunning, StateStopped, StateNotInstalled, StateError} {
		if state.Transitional() {
			t.Errorf("%v should not be transitional", state)
		}
	}
}
