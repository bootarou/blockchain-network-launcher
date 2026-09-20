// Package winproc centralises the Windows process attributes every child
// process in this application needs.
package winproc

import (
	"os/exec"
	"syscall"
)

// createNoWindow is CREATE_NO_WINDOW.
const createNoWindow = 0x08000000

// Hide suppresses the console window of a child process.
//
// A resident tray application must never flash a black window, and it polls
// wsl.exe continuously, so this is applied to every command without exception.
func Hide(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
