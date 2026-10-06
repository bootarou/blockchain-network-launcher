package tray

import "fyne.io/systray"

// menu holds every tray menu item so that state can be applied to all of them
// in one place (see binder.go).
type menu struct {
	header *systray.MenuItem

	open  *systray.MenuItem
	start *systray.MenuItem
	stop  *systray.MenuItem

	refresh       *systray.MenuItem
	viewLog       *systray.MenuItem
	installFolder *systray.MenuItem

	settings    *systray.MenuItem
	autoStart   *systray.MenuItem
	wakeWSL     *systray.MenuItem
	openBrowser *systray.MenuItem

	quit *systray.MenuItem
}

// buildMenu creates the tray menu. The layout follows section 8.1 of the plan.
func buildMenu(autoStartOn, wakeWSLOn, openBrowserOn bool) *menu {
	m := &menu{}

	// The header is a permanently disabled item used as a status line.
	m.header = systray.AddMenuItem("BNL — Checking...", "Current BNL state")
	m.header.Disable()
	systray.AddSeparator()

	m.open = systray.AddMenuItem("Open BNL", "Open the BNL Web UI in your browser")
	systray.AddSeparator()

	m.start = systray.AddMenuItem("Start", "Start the BNL manager")
	m.stop = systray.AddMenuItem("Stop", "Stop the BNL manager (Symbol nodes keep running)")
	systray.AddSeparator()

	m.refresh = systray.AddMenuItem("Refresh status", "Check the BNL state now (starts WSL if it is stopped)")
	m.viewLog = systray.AddMenuItem("View log", "Open tray.log")
	m.installFolder = systray.AddMenuItem("Open install folder", "Open the folder containing BNL-Setup.bat and BNL-Uninstall.bat")

	m.settings = systray.AddMenuItem("Settings", "")
	m.autoStart = m.settings.AddSubMenuItemCheckbox(
		"Start with Windows", "Launch this tray application at sign-in", autoStartOn)
	m.wakeWSL = m.settings.AddSubMenuItemCheckbox(
		"Wake WSL on startup", "Start the WSL VM once at launch to resolve the state", wakeWSLOn)
	m.openBrowser = m.settings.AddSubMenuItemCheckbox(
		"Open browser after start", "Open the Web UI once BNL is running", openBrowserOn)

	systray.AddSeparator()
	m.quit = systray.AddMenuItem("Quit", "Exit the tray application (BNL keeps running)")

	return m
}
