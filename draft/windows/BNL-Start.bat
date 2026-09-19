@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo ============================================================
echo  BNL Start
echo ============================================================
echo.

echo [1/5] Starting Ubuntu...
wsl.exe -d Ubuntu -u root -- true
if errorlevel 1 goto :wsl_error

echo [2/5] Checking BNL installation...
wsl.exe -d Ubuntu -u root -- test -d /opt/bnl
if errorlevel 1 goto :bnl_missing

echo [3/5] Starting WSL keepalive...
wsl.exe -d Ubuntu -u root -- bash -lc "pgrep -f '^bnl-wsl-keepalive ' >/dev/null 2>&1 || nohup bash -c 'exec -a bnl-wsl-keepalive sleep 2147483647' >/var/log/bnl-wsl-keepalive.log 2>&1 </dev/null &"
if errorlevel 1 goto :keepalive_error

echo [4/5] Starting Docker...
wsl.exe -d Ubuntu -u root -- systemctl start docker >nul 2>&1
if errorlevel 1 (
    wsl.exe -d Ubuntu -u root -- service docker start >nul 2>&1
)

set "DOCKER_READY="
for /L %%I in (1,1,30) do (
    wsl.exe -d Ubuntu -u root -- docker info >nul 2>&1
    if not errorlevel 1 (
        set "DOCKER_READY=1"
        goto :docker_ready
    )
    timeout /t 1 /nobreak >nul
)

:docker_ready
if not defined DOCKER_READY goto :docker_error
echo [OK] Docker is ready.

echo [5/5] Starting BNL manager...
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose up -d symbol-manager"
if errorlevel 1 goto :bnl_start_error

echo.
echo Waiting for BNL Web UI...
set "BNL_READY="
for /L %%I in (1,1,60) do (
    powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 100 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "BNL_READY=1"
        goto :bnl_ready
    )
    timeout /t 1 /nobreak >nul
)

:bnl_ready
if not defined BNL_READY goto :web_error

echo [OK] BNL is running.
start "" "http://127.0.0.1:5173"
exit /b 0

:wsl_error
echo.
echo [ERROR] Ubuntu could not be started.
pause
exit /b 1

:bnl_missing
echo.
echo [ERROR] /opt/bnl not found. Run BNL-Setup first.
pause
exit /b 10

:keepalive_error
echo.
echo [ERROR] WSL keepalive could not be started.
pause
exit /b 12

:docker_error
echo.
echo [ERROR] Docker did not start within 30 seconds.
echo Check with: wsl -d Ubuntu -u root -- docker info
pause
exit /b 11

:bnl_start_error
echo.
echo [ERROR] BNL manager could not be started.
echo.
echo Last BNL logs:
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs --tail 80 symbol-manager"
pause
exit /b 13

:web_error
echo.
echo [ERROR] BNL manager started, but Web UI did not become reachable.
echo Check: http://127.0.0.1:5173
echo.
echo Last BNL logs:
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs --tail 80 symbol-manager"
pause
exit /b 14
