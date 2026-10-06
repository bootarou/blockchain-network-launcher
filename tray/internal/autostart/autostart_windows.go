// Package autostart registers the tray application to launch at sign-in.
//
// HKCU is used rather than HKLM so that no elevation is ever required - the
// application deliberately never asks for administrator rights.
package autostart

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

const (
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName  = "BNL Tray"
)

// Enabled reports whether the current executable is registered to auto-start.
func Enabled() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()

	value, _, err := key.GetStringValue(valueName)
	return err == nil && value != ""
}

// Set adds or removes the auto-start entry.
func Set(enabled bool) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	if !enabled {
		err := key.DeleteValue(valueName)
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Quoted so that a path containing spaces is launched as one argument.
	return key.SetStringValue(valueName, `"`+exe+`"`)
}
