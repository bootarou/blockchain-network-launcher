# BNL One-Line Installer for Windows + WSL2 (v12 beta)
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1 | iex

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$InstallerUrl       = 'https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1'
$LinuxInstallerUrl  = 'https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install-wsl.sh'
$DistroName         = 'Ubuntu'
$BnlWebUrl          = 'http://127.0.0.1:5173'
$BnlProbeUrl        = 'http://127.0.0.1:5173'
$StateDir            = Join-Path $env:LOCALAPPDATA 'BNL'
$LinuxInstallerPath = Join-Path $StateDir 'install-wsl.sh'
$RunOnceName         = 'BNLInstallerResume'
$LogPath             = Join-Path $StateDir 'install.log'
$TranscriptStarted   = $false

function Write-Step([string]$Message) {
    Write-Host "`n============================================================" -ForegroundColor DarkCyan
    Write-Host " BNL | $Message" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory=$true)][Security.SecureString]$SecureString)

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Read-BnlAdminPassword {
    Write-Step 'BNL administrator password'
    Write-Host 'Create the password used to access the BNL administration UI.' -ForegroundColor White
    Write-Host 'Allowed: A-Z a-z 0-9 ! @ # % _ . -   Length: 8-64 characters' -ForegroundColor DarkGray
    Write-Host 'The password will not be displayed or written to the Windows install log.' -ForegroundColor DarkGray
    Write-Host ''

    while ($true) {
        $secure1 = Read-Host 'Admin password' -AsSecureString
        $secure2 = Read-Host 'Confirm password' -AsSecureString
        $plain1 = $null
        $plain2 = $null
        try {
            $plain1 = ConvertFrom-SecureStringPlain $secure1
            $plain2 = ConvertFrom-SecureStringPlain $secure2

            if ($plain1 -ne $plain2) {
                Write-Warn 'Passwords do not match. Please try again.'
                continue
            }
            if ($plain1 -notmatch '^[A-Za-z0-9!@#%_.-]{8,64}$') {
                Write-Warn 'Password must be 8-64 characters and use only: A-Z a-z 0-9 ! @ # % _ . -'
                continue
            }
            return $plain1
        }
        finally {
            $plain2 = $null
            $secure1 = $null
            $secure2 = $null
        }
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

function Register-ResumeAfterReboot {
    New-Item -Path $StateDir -ItemType Directory -Force | Out-Null
    $resumeCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"irm '$InstallerUrl' | iex`""
    $runOncePath = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    New-ItemProperty -Path $runOncePath -Name $RunOnceName -Value $resumeCommand -PropertyType String -Force | Out-Null
}

function Remove-ResumeAfterReboot {
    $runOncePath = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    Remove-ItemProperty -Path $runOncePath -Name $RunOnceName -ErrorAction SilentlyContinue
}

function Get-WslDistros {
    $raw = & wsl.exe -l -q 2>$null
    if ($LASTEXITCODE -ne 0) { return @() }
    return @($raw | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
}

function Get-WslDistroVersion {
    param([Parameter(Mandatory=$true)][string]$Name)

    $raw = & wsl.exe -l -v 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }

    foreach ($line in $raw) {
        $clean = (($line -replace "`0", '').Trim() -replace '^\*\s*', '')
        if (-not $clean) { continue }

        # The target distro name is Ubuntu, so whitespace token parsing is safe here.
        $parts = @($clean -split '\s+' | Where-Object { $_ })
        if ($parts.Count -ge 2 -and $parts[0] -eq $Name -and $parts[-1] -match '^[12]$') {
            return [int]$parts[-1]
        }
    }

    return $null
}

function Start-BnlRuntime {
    Write-Step 'Starting Ubuntu and BNL runtime'

    # Merely invoking WSL is enough to wake a stopped distro. Do this explicitly
    # so BNL also works immediately after Windows/WSL has gone idle or restarted.
    Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'true')
    Write-Ok "$DistroName is running"

    # Start Docker and the existing BNL compose project inside Ubuntu. The script
    # is transferred as Base64 to avoid PowerShell/native quoting differences.
    $runtimeScript = @'
set -euo pipefail

if command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm= 2>/dev/null || true)" = "systemd" ]; then
  systemctl start docker
else
  if ! docker info >/dev/null 2>&1; then
    if command -v service >/dev/null 2>&1; then
      service docker start >/dev/null 2>&1 || true
    fi
  fi
fi

for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker info >/dev/null 2>&1

if [ -d /opt/bnl ]; then
  cd /opt/bnl
  docker compose up -d
fi
'@

    $runtimeEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtimeScript))
    $runtimeCommand = "printf '%s' '$runtimeEncoded' | base64 -d | bash"
    Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'bash', '-lc', $runtimeCommand)

    Write-Ok 'Docker and BNL runtime are running'
}

try {
    Write-Step 'Windows one-line installer'

    $isAdmin = Test-IsAdministrator
    $existingDistros = Get-WslDistros
    $existingUbuntuVersion = $null
    if ($existingDistros -contains $DistroName) {
        $existingUbuntuVersion = Get-WslDistroVersion -Name $DistroName
    }

    # Existing WSL2 + Ubuntu installations do not need Windows administrator
    # privileges for normal BNL install/update/repair operations. WSL can launch
    # the distro as Linux root without elevating the Windows process.
    $canContinueWithoutAdmin = (($existingDistros -contains $DistroName) -and ($existingUbuntuVersion -eq 2))

    if (-not $isAdmin -and -not $canContinueWithoutAdmin) {
        Write-Host 'Windows administrator privileges are required for the initial WSL2 setup.' -ForegroundColor Yellow
        Write-Host 'Requesting UAC elevation...' -ForegroundColor Yellow
        $elevatedCommand = "irm '$InstallerUrl' | iex"
        try {
            $argLine = "-NoProfile -ExecutionPolicy Bypass -Command `"$elevatedCommand`""
            Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList $argLine
            return
        }
        catch {
            Write-Warn 'Automatic UAC elevation was blocked by Windows.'
            Write-Host 'Open PowerShell with "Run as administrator" and run the same one-line installer.' -ForegroundColor Yellow
            throw
        }
    }

    New-Item -Path $StateDir -ItemType Directory -Force | Out-Null
    try {
        Start-Transcript -Path $LogPath -Append -Force | Out-Null
        $TranscriptStarted = $true
    } catch {
        # Logging must never prevent installation.
    }
    if ($isAdmin) {
        Write-Ok 'Administrator privileges confirmed'
    } else {
        Write-Ok 'Existing WSL2 Ubuntu detected; Windows administrator elevation is not required'
    }
    Write-Host "Log: $LogPath" -ForegroundColor DarkGray

    $build = [Environment]::OSVersion.Version.Build
    if ($build -lt 19041) {
        throw "Windows build $build is too old. Windows 10 version 2004 (build 19041) or later is required."
    }
    Write-Ok "Windows build $build"

    if ($isAdmin) {
        # ---------------------------------------------------------------------
        # Enable WSL2 prerequisites.
        # ---------------------------------------------------------------------
        Write-Step 'Checking WSL2 Windows features'

        $rebootRequired = $false
        foreach ($featureName in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
            $feature = Get-WindowsOptionalFeature -Online -FeatureName $featureName
            if ($feature.State -ne 'Enabled') {
                Write-Host "Enabling $featureName ..."
                Enable-WindowsOptionalFeature -Online -FeatureName $featureName -All -NoRestart | Out-Null
                $rebootRequired = $true
            } else {
                Write-Ok "$featureName enabled"
            }
        }

        if ($rebootRequired) {
            Register-ResumeAfterReboot
            Write-Host ''
            Write-Host 'WSL2 prerequisites were enabled.' -ForegroundColor Green
            Write-Host 'Windows must restart once. The BNL installer will resume after sign-in.' -ForegroundColor Yellow
            Write-Host 'Restarting in 15 seconds. Run "shutdown /a" to cancel.' -ForegroundColor Yellow
            shutdown.exe /r /t 15 /c "BNL setup will continue after restart."
            return
        }

        # ---------------------------------------------------------------------
        # Update/install WSL runtime.
        # ---------------------------------------------------------------------
        Write-Step 'Preparing WSL2'

        try {
            & wsl.exe --update --web-download | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'wsl --update failed' }
        } catch {
            Write-Warn 'WSL update could not be completed; continuing with the installed WSL runtime.'
        }

        try {
            Invoke-Native -FilePath 'wsl.exe' -Arguments @('--set-default-version', '2')
        } catch {
            Write-Warn 'Could not set the global default WSL version to 2. Continuing.'
        }

        # ---------------------------------------------------------------------
        # Install Ubuntu when necessary.
        # ---------------------------------------------------------------------
        Write-Step "Checking WSL distribution: $DistroName"

        $distros = Get-WslDistros
        if ($distros -notcontains $DistroName) {
            Write-Host "Installing $DistroName without launching its interactive first-run wizard..."
            & wsl.exe --install -d $DistroName --no-launch --web-download
            if ($LASTEXITCODE -ne 0) {
                Write-Warn 'Web-download install failed; retrying with the standard source.'
                Invoke-Native -FilePath 'wsl.exe' -Arguments @('--install', '-d', $DistroName, '--no-launch')
            }
        } else {
            Write-Ok "$DistroName already installed"
        }

    } else {
        Write-Step 'Using existing WSL2 environment'
        Write-Ok "$DistroName is already installed as WSL2"
        Write-Host 'Skipping Windows feature changes and WSL installation/update steps.' -ForegroundColor DarkGray
        $distros = $existingDistros
    }

    # Initialize the distro as root. This avoids the Ubuntu username/password wizard.
    # IMPORTANT: pass native arguments as an explicit array. PowerShell functions can
    # otherwise reinterpret tokens such as -d / -u and shift WSL arguments.
    Write-Host 'Initializing Ubuntu as root...'
    Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'true')

    # Convert only when the distro is actually WSL1.
    # Calling --set-version on an already-WSL2 distro can return
    # WSL_E_VM_MODE_INVALID_STATE on some current WSL builds even though
    # the distro is already at the requested version.
    $distroVersion = Get-WslDistroVersion -Name $DistroName
    if ($distroVersion -eq 2) {
        Write-Ok "$DistroName is already WSL2; conversion skipped"
    } else {
        if ($distroVersion -eq 1) {
            Write-Host "Converting $DistroName from WSL1 to WSL2..."
        } else {
            Write-Warn "Could not determine $DistroName WSL version. Verifying/converting to WSL2..."
        }

        # Make sure no VM instance is in a transitional/running state before conversion.
        & wsl.exe --terminate $DistroName 2>$null | Out-Null
        Start-Sleep -Seconds 2

        & wsl.exe --set-version $DistroName 2 | Out-Host
        $setVersionExit = $LASTEXITCODE

        # Re-check instead of trusting the exit code alone. Some WSL builds may
        # report a non-zero code when the requested version is already active.
        $verifiedVersion = Get-WslDistroVersion -Name $DistroName
        if ($verifiedVersion -eq 2) {
            Write-Ok "$DistroName is running as WSL2"
        } elseif ($setVersionExit -ne 0) {
            throw "wsl.exe --set-version failed with code $setVersionExit and $DistroName is not confirmed as WSL2"
        } else {
            throw "$DistroName could not be confirmed as WSL2 after conversion"
        }

        # Start it again after a real conversion/verification cycle.
        Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'true')
    }

    # systemd is standard on current WSL Ubuntu images. If it is not active,
    # enable only the [boot] systemd option and preserve any existing settings.
    $systemdState = (& wsl.exe -d $DistroName -u root -- bash -lc 'ps -p 1 -o comm= 2>/dev/null || true' | Out-String).Trim()
    if ($systemdState -ne 'systemd') {
        Write-Host 'Enabling systemd inside WSL...'
        $systemdScript = @'
set -e
if [ -f /etc/wsl.conf ]; then
  cp /etc/wsl.conf /etc/wsl.conf.bnl-backup
fi
python3 - <<'PY' 2>/dev/null || true
from pathlib import Path
p=Path('/etc/wsl.conf')
s=p.read_text() if p.exists() else ''
lines=s.splitlines()
out=[]
in_boot=False
seen_boot=False
seen_systemd=False
for line in lines:
    stripped=line.strip()
    if stripped.startswith('[') and stripped.endswith(']'):
        if in_boot and not seen_systemd:
            out.append('systemd=true')
            seen_systemd=True
        in_boot=(stripped.lower()=='[boot]')
        if in_boot: seen_boot=True
        out.append(line)
        continue
    if in_boot and stripped.lower().startswith('systemd='):
        out.append('systemd=true')
        seen_systemd=True
    else:
        out.append(line)
if in_boot and not seen_systemd:
    out.append('systemd=true')
    seen_systemd=True
if not seen_boot:
    if out and out[-1].strip(): out.append('')
    out += ['[boot]', 'systemd=true']
p.write_text('\n'.join(out).rstrip()+'\n')
PY
if ! grep -qi '^systemd=true' /etc/wsl.conf 2>/dev/null; then
  printf '\n[boot]\nsystemd=true\n' >> /etc/wsl.conf
fi
'@
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($systemdScript))
        Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'bash', '-lc', "echo '$encoded' | base64 -d | bash")
        & wsl.exe --terminate $DistroName | Out-Null
        Start-Sleep -Seconds 2
        Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'true')
    }

    # ---------------------------------------------------------------------
    # Ensure BNL has an administrator password.
    # Existing active ADMIN_PASSWORD values are preserved. For a fresh install,
    # prompt securely and transfer the password to WSL via stdin (not argv/logs).
    # ---------------------------------------------------------------------
    $existingAdminPassword = $false
    $adminCheckCommand = "if [ -f /opt/bnl/.env ] && grep -Eq '^[[:space:]]*ADMIN_PASSWORD=.+$' /opt/bnl/.env; then printf SET; fi"
    $adminCheck = (& wsl.exe -d $DistroName -u root -- bash -lc $adminCheckCommand 2>$null | Out-String).Trim()
    if ($adminCheck -eq 'SET') {
        $existingAdminPassword = $true
        Write-Ok 'Existing BNL admin password detected; preserving it'
    }

    if (-not $existingAdminPassword) {
        $adminPassword = Read-BnlAdminPassword
        try {
            # Encode the password before crossing the Windows -> WSL stdin boundary.
            # Windows PowerShell writes CRLF to native-process stdin; sending raw text
            # can therefore leave a trailing CR in Linux. Base64 + CR/LF stripping
            # avoids that while keeping the password out of argv and the transcript.
            $adminPasswordBytes = [Text.Encoding]::UTF8.GetBytes($adminPassword)
            $adminPasswordBase64 = [Convert]::ToBase64String($adminPasswordBytes)
            $adminPasswordBase64 | & wsl.exe -d $DistroName -u root -- bash -lc 'umask 077; tr -d "\r\n" | base64 -d > /tmp/bnl-admin-password'
            if ($LASTEXITCODE -ne 0) {
                throw "Could not transfer the BNL admin password into WSL (exit code $LASTEXITCODE)"
            }
            Write-Ok 'BNL admin password accepted'
        }
        finally {
            $adminPassword = $null
            [GC]::Collect()
        }
    }

    # ---------------------------------------------------------------------
    # Download and execute Linux bootstrap.
    # ---------------------------------------------------------------------
    Write-Step 'Installing Docker Engine and BNL inside WSL'

    Invoke-WebRequest -UseBasicParsing -Uri $LinuxInstallerUrl -OutFile $LinuxInstallerPath

    # Do not translate a Windows path with wslpath.  PowerShell 5.1 / WSL
    # argument handling can make that fragile.  Instead, transfer the script
    # contents to WSL as Base64 and execute the decoded file there.
    $linuxBootstrapBytes = [System.IO.File]::ReadAllBytes($LinuxInstallerPath)
    $linuxBootstrapBase64 = [Convert]::ToBase64String($linuxBootstrapBytes)

    $bootstrapCommand = "set -euo pipefail; printf '%s' '$linuxBootstrapBase64' | base64 -d > /tmp/bnl-install-wsl.sh; chmod 700 /tmp/bnl-install-wsl.sh; bash /tmp/bnl-install-wsl.sh; rc=`$?; rm -f /tmp/bnl-install-wsl.sh; exit `$rc"

    Invoke-Native -FilePath 'wsl.exe' -Arguments @('-d', $DistroName, '-u', 'root', '--', 'bash', '-lc', $bootstrapCommand)

    # The bootstrap starts BNL itself, but explicitly wake Ubuntu and re-assert
    # Docker/Compose here before probing from Windows. This prevents the common
    # case where WSL has stopped or gone idle between setup and browser launch.
    Start-BnlRuntime

    # ---------------------------------------------------------------------
    # Wait for BNL Web UI and open browser.
    # ---------------------------------------------------------------------
    Write-Step 'Waiting for BNL Web UI'

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $BnlProbeUrl -TimeoutSec 1
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $ready) {
        Write-Warn "BNL was installed, but $BnlProbeUrl did not become reachable in time."
        Write-Host "Check logs with: wsl -d $DistroName -u root -- bash -lc 'cd /opt/bnl && docker compose logs --tail=200'"
    } else {
        Write-Ok 'BNL Web UI is ready'
        Start-Process $BnlWebUrl
    }

    Remove-ResumeAfterReboot

    Write-Step 'Installation complete'
    Write-Host "BNL: $BnlWebUrl" -ForegroundColor Green
    Write-Host ''
    Write-Host 'Useful commands:'
    Write-Host "  Start : wsl -d $DistroName -u root -- bash -lc 'cd /opt/bnl && docker compose up -d'"
    Write-Host "  Stop  : wsl -d $DistroName -u root -- bash -lc 'cd /opt/bnl && docker compose stop'"
    Write-Host "  Logs  : wsl -d $DistroName -u root -- bash -lc 'cd /opt/bnl && docker compose logs -f'"
    Write-Host ''
    Write-Host 'The installer is safe to run again. Existing .env is preserved.' -ForegroundColor DarkGray
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
        $TranscriptStarted = $false
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errorDetail = ($_ | Format-List * -Force | Out-String)

    Write-Host ''
    Write-Host 'BNL installation failed.' -ForegroundColor Red
    Write-Host $errorMessage -ForegroundColor Red
    Write-Host ''
    if ($_.ScriptStackTrace) {
        Write-Host 'Location:' -ForegroundColor DarkYellow
        Write-Host $_.ScriptStackTrace -ForegroundColor DarkYellow
        Write-Host ''
    }

    # Stop the transcript before appending the structured error. Otherwise
    # install.log is still locked by Start-Transcript.
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
        $TranscriptStarted = $false
    }

    try {
        New-Item -Path $StateDir -ItemType Directory -Force | Out-Null
        Add-Content -Path $LogPath -Value "`r`n===== BNL ERROR $(Get-Date -Format o) =====`r`n$errorDetail" -Encoding UTF8
    } catch {}

    Write-Host "Log: $LogPath" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Copy the red error above, or run:' -ForegroundColor Yellow
    Write-Host "  Get-Content '$LogPath' -Tail 100" -ForegroundColor White
    Write-Host ''

    # During beta testing, keep the window open so the actual error can be read.
    Write-Host 'Press Enter to close this window.' -ForegroundColor Yellow
    [void](Read-Host)
    return
}
