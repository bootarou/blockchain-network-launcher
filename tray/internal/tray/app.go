// Package tray implements the resident tray application: the menu, the icon and
// the wiring between user actions and the BNL controller.
package tray

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fyne.io/systray"

	"github.com/bootarou/bnl-tray/internal/autostart"
	"github.com/bootarou/bnl-tray/internal/bnl"
	"github.com/bootarou/bnl-tray/internal/config"
	"github.com/bootarou/bnl-tray/internal/logging"
	"github.com/bootarou/bnl-tray/internal/notify"
	"github.com/bootarou/bnl-tray/internal/winshell"
)

const blinkInterval = 500 * time.Millisecond

// App is the tray application.
type App struct {
	log        *logging.Logger
	settings   *config.Settings
	monitor    *bnl.Monitor
	controller *bnl.Controller
	notifier   *notify.Notifier

	menu *menu

	ctx    context.Context
	cancel context.CancelFunc

	blinkMu     sync.Mutex
	blinkCancel context.CancelFunc

	// lastLogged avoids repeating a state line every time the header's "checked
	// N ago" text advances.
	lastLogged string
}

// New creates the application.
func New(
	log *logging.Logger,
	settings *config.Settings,
	monitor *bnl.Monitor,
	controller *bnl.Controller,
	notifier *notify.Notifier,
) *App {
	ctx, cancel := context.WithCancel(context.Background())
	return &App{
		log:        log,
		settings:   settings,
		monitor:    monitor,
		controller: controller,
		notifier:   notifier,
		ctx:        ctx,
		cancel:     cancel,
	}
}

// OnReady is called by systray once the icon exists.
func (a *App) OnReady() {
	// The registry is the source of truth for auto-start: the user may have
	// removed the entry outside this application.
	a.settings.StartWithWindows = autostart.Enabled()

	systray.SetIcon(icon(iconUnknown))
	systray.SetTitle("BNL")
	systray.SetTooltip("BNL — Checking...")

	a.menu = buildMenu(a.settings.StartWithWindows, a.settings.WakeWSLOnStartup, a.settings.OpenBrowserAfterStart)
	a.menu.apply(a.monitor.Snapshot())

	a.monitor.OnChange(a.onState)
	go a.monitor.Run(a.ctx, a.settings.WakeWSLOnStartup)

	a.watch(a.menu.open, a.openWebUI)
	a.watch(a.menu.start, func() { go a.doStart() })
	a.watch(a.menu.stop, func() { go a.doStop() })
	a.watch(a.menu.refresh, func() { a.monitor.Refresh(true) })
	a.watch(a.menu.viewLog, a.openLog)
	a.watch(a.menu.installFolder, a.openInstallFolder)
	a.watch(a.menu.autoStart, a.toggleAutoStart)
	a.watch(a.menu.wakeWSL, a.toggleWakeWSL)
	a.watch(a.menu.openBrowser, a.toggleOpenBrowser)
	a.watch(a.menu.quit, func() { systray.Quit() })

	a.log.Infof("BNL Tray started.")
}

// OnExit is called by systray during shutdown.
func (a *App) OnExit() {
	a.log.Infof("BNL Tray exiting.")
	a.cancel()
}

// watch runs handler every time item is clicked, until the app shuts down.
func (a *App) watch(item *systray.MenuItem, handler func()) {
	go func() {
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-item.ClickedCh:
				// A disabled item can still deliver a click on some Windows
				// builds, so the guard is enforced here as well.
				if item.Disabled() {
					continue
				}
				handler()
			}
		}
	}()
}

// onState applies a new snapshot to the menu and the icon.
func (a *App) onState(snap bnl.Snapshot) {
	a.menu.apply(snap)
	a.logState(snap)
	if snap.State.Transitional() {
		a.setBlinking(true)
		return
	}
	a.setBlinking(false)
	systray.SetIcon(icon(iconForState(snap.State)))
}

// logState records state changes, which is what makes tray.log useful when a
// user reports "Start was greyed out".
func (a *App) logState(snap bnl.Snapshot) {
	line := snap.State.String() + " (observed: " + snap.Observed.String() + ")"
	if line == a.lastLogged {
		return
	}
	a.lastLogged = line
	a.log.Infof("state: %s", line)
}

// setBlinking alternates the busy icon while an operation runs.
func (a *App) setBlinking(on bool) {
	a.blinkMu.Lock()
	defer a.blinkMu.Unlock()

	if on == (a.blinkCancel != nil) {
		return
	}
	if !on {
		a.blinkCancel()
		a.blinkCancel = nil
		return
	}

	ctx, cancel := context.WithCancel(a.ctx)
	a.blinkCancel = cancel
	go func() {
		ticker := time.NewTicker(blinkInterval)
		defer ticker.Stop()
		alternate := false
		systray.SetIcon(icon(iconBusy))
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				alternate = !alternate
				if alternate {
					systray.SetIcon(icon(iconBusyAlt))
				} else {
					systray.SetIcon(icon(iconBusy))
				}
			}
		}
	}()
}

func (a *App) doStart() {
	failure := a.controller.Start(a.ctx, a.progress)
	if failure != nil {
		a.notifier.Show("BNL", failure.Message+" "+failure.Hint)
		return
	}
	a.notifier.Show("BNL", "BNL is running.")
	if a.settings.OpenBrowserAfterStart {
		a.openWebUI()
	}
}

func (a *App) doStop() {
	failure := a.controller.Stop(a.ctx, a.progress)
	if failure != nil {
		a.notifier.Show("BNL", failure.Message+" "+failure.Hint)
		return
	}
	a.notifier.Show("BNL", "BNL manager stopped. Symbol nodes, Docker and WSL are still running.")
}

// progress shows the current step in the header and tooltip.
func (a *App) progress(message string) {
	a.menu.header.SetTitle("BNL — " + message)
	systray.SetTooltip(truncate("BNL — "+message, tooltipLimit))
}

func (a *App) openWebUI() {
	url := a.monitor.Snapshot().WebURL()
	if err := winshell.OpenURL(url); err != nil {
		a.log.Warnf("could not open %s: %v", url, err)
	}
}

func (a *App) openLog() {
	if err := winshell.OpenFile(a.log.Path()); err != nil {
		a.log.Warnf("could not open the log: %v", err)
	}
}

// openInstallFolder opens the directory the executable lives in, which is where
// BNL-Setup.bat and BNL-Uninstall.bat are shipped.
func (a *App) openInstallFolder() {
	exe, err := os.Executable()
	if err != nil {
		a.log.Warnf("could not resolve the executable path: %v", err)
		return
	}
	_ = winshell.OpenFolder(filepath.Dir(exe))
}

func (a *App) toggleAutoStart() {
	enable := !a.menu.autoStart.Checked()
	if err := autostart.Set(enable); err != nil {
		a.log.Warnf("could not change the auto-start entry: %v", err)
		a.notifier.Show("BNL", "Could not change the Windows startup entry.")
		return
	}
	setChecked(a.menu.autoStart, enable)
	a.settings.StartWithWindows = enable
	a.settings.Save()
}

func (a *App) toggleWakeWSL() {
	enable := !a.menu.wakeWSL.Checked()
	setChecked(a.menu.wakeWSL, enable)
	a.settings.WakeWSLOnStartup = enable
	a.settings.Save()
}

func (a *App) toggleOpenBrowser() {
	enable := !a.menu.openBrowser.Checked()
	setChecked(a.menu.openBrowser, enable)
	a.settings.OpenBrowserAfterStart = enable
	a.settings.Save()
}

func setChecked(item *systray.MenuItem, checked bool) {
	if checked {
		item.Check()
		return
	}
	item.Uncheck()
}
