// Package winshell opens URLs, files and folders with the user's default
// handlers, without flashing a console window.
package winshell

import (
	"os/exec"

	"github.com/bootarou/bnl-tray/internal/winproc"
)

// OpenURL opens a URL in the default browser.
//
// rundll32 is used instead of `cmd /c start` because it takes the target as a
// single argument and needs no shell, so nothing has to be quoted or escaped.
func OpenURL(url string) error {
	return run("rundll32.exe", "url.dll,FileProtocolHandler", url)
}

// OpenFile opens a file with its default application (used for tray.log).
func OpenFile(path string) error {
	return run("rundll32.exe", "url.dll,FileProtocolHandler", path)
}

// OpenFolder opens a folder in Explorer.
func OpenFolder(path string) error {
	// explorer.exe returns a non-zero exit code even on success, so its result
	// is deliberately ignored.
	cmd := exec.Command("explorer.exe", path)
	winproc.Hide(cmd)
	_ = cmd.Start()
	return nil
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	winproc.Hide(cmd)
	return cmd.Start()
}
