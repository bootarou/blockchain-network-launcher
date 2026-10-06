// Command bnl-tray is a Windows tray application that starts and stops the BNL
// manager running inside WSL2 Ubuntu.
//
// It deliberately does not install or uninstall BNL: BNL-Setup.bat and
// BNL-Uninstall.bat ship alongside the executable and are run by the user.
// Because of that the application never needs administrator rights.
package main

import (
	"fyne.io/systray"

	"github.com/bootarou/bnl-tray/internal/bnl"
	"github.com/bootarou/bnl-tray/internal/config"
	"github.com/bootarou/bnl-tray/internal/logging"
	"github.com/bootarou/bnl-tray/internal/notify"
	"github.com/bootarou/bnl-tray/internal/singleton"
	"github.com/bootarou/bnl-tray/internal/tray"
	"github.com/bootarou/bnl-tray/internal/wsl"
)

// mutexName is session-local: one tray icon per signed-in user.
const mutexName = `Local\BnlTray`

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	release, ok := singleton.Acquire(mutexName)
	if !ok {
		return // another instance is already resident
	}
	defer release()

	log, err := logging.New()
	if err != nil {
		// Without a log there is nowhere to report anything, so there is
		// nothing useful left to do.
		return
	}
	defer log.Close()
	log.Infof("BNL Tray %s", version)

	settings := config.LoadSettings()
	cache := config.LoadStateCache()

	runner := wsl.NewRunner(wsl.DefaultDistro)
	runner.Log = log.Warnf

	monitor := bnl.NewMonitor(runner, log, cache)
	controller := bnl.NewController(runner, monitor, log)
	notifier := notify.New(log)

	app := tray.New(log, settings, monitor, controller, notifier)
	systray.Run(app.OnReady, app.OnExit)
}
