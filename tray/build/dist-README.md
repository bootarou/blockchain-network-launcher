# BNL Tray

A small Windows tray application that starts and stops the BNL manager running
inside WSL2 Ubuntu.

> 日本語版: [README.ja.md](README.ja.md)

## What is in this folder

| File | Purpose |
|------|---------|
| `bnl-tray.exe` | The tray application. Starts and stops BNL. |
| `BNL-Setup.bat` | Installs or updates BNL. **Run this first.** |
| `BNL-Uninstall.bat` | Removes the BNL manager application. |
| `README.ja.md` | 日本語版の説明書 |

`bnl-tray.exe` intentionally does not install or uninstall anything, so it never
needs administrator rights. Installation is done by running `BNL-Setup.bat`
yourself.

## First-time setup

1. Double-click **`BNL-Setup.bat`**.
   It downloads the latest installer and asks you for:
   - the branch to install,
   - the address BNL listens on (`BIND_ADDRESS`, normally `127.0.0.1`),
   - an admin password for the BNL Web UI.

   If WSL2 or Ubuntu is not installed yet, the installer asks for administrator
   rights and may require a restart. Let it finish before continuing.
2. Double-click **`bnl-tray.exe`**. A BNL icon appears in the notification area
   (you may need to expand the "hidden icons" arrow).
3. Right-click the icon and choose **Start**.

To have the tray application launch automatically, right-click the icon and
enable **Settings → Start with Windows**.

## Using the tray menu

| Menu item | What it does |
|-----------|--------------|
| **Open BNL** | Opens the Web UI in your browser. Available while BNL is running. |
| **Start** | Starts Ubuntu, Docker and the BNL manager, then waits for the Web UI. |
| **Stop** | Stops the BNL manager **only**. Symbol nodes, Docker and WSL keep running. |
| **Refresh status** | Checks the current state now. This starts the WSL VM if it is stopped. |
| **View log** | Opens `%LOCALAPPDATA%\BNL\tray.log`. |
| **Open install folder** | Opens this folder, where `BNL-Setup.bat` lives. |
| **Quit** | Closes the tray application. **BNL keeps running.** |

The icon shows the current state:

| Icon | Meaning |
|------|---------|
| Green | BNL is running |
| Grey | BNL is installed but stopped |
| Grey dashed | BNL is not installed, or WSL2 Ubuntu was not found |
| Blinking amber | Starting or stopping |
| Red | The last operation failed — open **View log** |

### Settings

- **Start with Windows** — launch the tray application at sign-in.
- **Wake WSL on startup** — off by default. While the WSL VM is stopped, the tray
  cannot tell whether BNL is installed without starting the VM, so it shows the
  last known state instead. Turn this on if you would rather have the exact state
  immediately, at the cost of starting WSL every time you sign in.
- **Open browser after start** — open the Web UI once BNL is running.

## Stopping, and what is not stopped

**Stop** only stops the BNL manager container. It deliberately leaves alone:

- your Symbol nodes and their chain data,
- Docker,
- Ubuntu / WSL,
- the WSL keepalive process.

Quitting the tray application does not stop BNL either.

## Uninstalling

Run **`BNL-Uninstall.bat`** and type `UNINSTALL` when prompted. It removes the BNL
manager application (`/opt/bnl`) and keeps `/opt/symbol-target`, your Symbol node
containers and chain data, Docker, and Ubuntu / WSL.

To remove the tray application itself, quit it and delete this folder. If you
enabled **Start with Windows**, turn it off before deleting.

## Troubleshooting

**"BNL — Not installed" and Start is greyed out**
Run `BNL-Setup.bat` (menu → **Open install folder**), then choose **Refresh status**.

**"BNL — WSL2 Ubuntu not found"**
WSL2 with an Ubuntu distribution is required. Check with:

```powershell
wsl -l -v
```

The list must contain `Ubuntu` with version `2`. If it does not, run
`BNL-Setup.bat`, which installs it.

**Start fails**
Choose **View log**. `tray.log` records every step and, when the manager fails to
come up, the last 80 lines of its container log.

**Windows SmartScreen warns when starting the application**
The executable is not code-signed. Choose *More info → Run anyway*, or unblock it
first: right-click `bnl-tray.exe` → *Properties* → *Unblock*.

**Two icons appear**
Only one instance can run at a time; a second one exits immediately. If you see
two icons, one of them is stale — hover over them and Windows will remove it.
