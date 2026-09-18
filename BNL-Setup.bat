@echo off
setlocal EnableExtensions

title BNL - Blockchain Network Launcher

echo ============================================
echo   BNL - Blockchain Network Launcher
echo ============================================
echo.
echo Checking BNL...
echo.

rem ------------------------------------------------------------
rem 1. If BNL Web UI is already reachable, just open it.
rem ------------------------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue'; try { $r=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Start-Process 'http://localhost:5173'; exit 0 } } catch {}; exit 10"

if %ERRORLEVEL% EQU 0 (
    echo [OK] BNL is already running.
    exit /b 0
)

rem ------------------------------------------------------------
rem 2. Check whether BNL is already installed inside Ubuntu.
rem ------------------------------------------------------------
wsl.exe -d Ubuntu -u root -- bash -lc "test -d /opt/bnl/.git" >nul 2>&1

if %ERRORLEVEL% EQU 0 goto START_BNL

goto INSTALL_BNL

:START_BNL
echo [INFO] BNL is installed but not currently reachable.
echo [INFO] Starting existing BNL without rebuilding...
echo.

wsl.exe -d Ubuntu -u root -- bash -lc "systemctl start docker >/dev/null 2>&1 || true; cd /opt/bnl && docker compose up -d"

if ERRORLEVEL 1 (
    echo.
    echo [WARN] Existing BNL could not be started normally.
    echo [INFO] Running the repair/setup installer...
    echo.
    goto INSTALL_BNL
)

echo.
echo Waiting for BNL Web UI...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(120); do { try { $r=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Start-Process 'http://localhost:5173'; exit 0 } } catch {}; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $deadline); exit 11"

if %ERRORLEVEL% EQU 0 (
    echo [OK] BNL started successfully.
    exit /b 0
)

echo.
echo [ERROR] BNL did not become reachable.
echo.
echo Last container status:
wsl.exe -d Ubuntu -u root -- docker ps

echo.
echo Check logs with:
echo   wsl -d Ubuntu -u root -- docker logs symbol-manager --tail 100
echo.
pause
exit /b 1

:INSTALL_BNL
echo [INFO] BNL is not installed yet, or repair is required.
echo [INFO] Starting one-line installer...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "irm 'https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1' ^| iex"

if ERRORLEVEL 1 (
    echo.
    echo [ERROR] BNL setup returned an error.
    echo Check C:\ProgramData\BNL\install.log for details.
    echo.
    pause
    exit /b 1
)

exit /b 0
