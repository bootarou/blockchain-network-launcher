@echo off
setlocal EnableExtensions
chcp 65001 >nul

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
wsl.exe -d Ubuntu -u root -- bash -lc "docker info >/dev/null 2>&1 || systemctl start docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1"
if errorlevel 1 goto :docker_error

wsl.exe -d Ubuntu -u root -- bash -lc "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"
if errorlevel 1 goto :docker_error

echo [5/5] Starting BNL manager...
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose up -d symbol-manager"
if errorlevel 1 goto :bnl_start_error

echo Waiting for BNL Web UI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 100 -and $r.StatusCode -lt 500){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){exit 1}; Start-Process 'http://127.0.0.1:5173'"
if errorlevel 1 goto :ui_error

echo.
echo [OK] BNL is running: http://127.0.0.1:5173
exit /b 0

:wsl_error
echo.
echo [ERROR] Ubuntu could not be started.
pause
exit /b 1

:bnl_missing
echo.
echo [ERROR] /opt/bnl was not found. Run BNL-Setup first.
pause
exit /b 10

:keepalive_error
echo.
echo [ERROR] WSL keepalive could not be started.
pause
exit /b 12

:docker_error
echo.
echo [ERROR] Docker did not start.
echo Check with: wsl -d Ubuntu -u root -- docker info
pause
exit /b 11

:bnl_start_error
echo.
echo [ERROR] BNL manager could not be started.
echo.
echo Last BNL logs:
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs --tail=80 symbol-manager"
pause
exit /b 13

:ui_error
echo.
echo [ERROR] BNL manager started, but Web UI did not become reachable.
echo.
echo Container status:
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose ps symbol-manager"
echo.
echo Last BNL logs:
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs --tail=80 symbol-manager"
pause
exit /b 14
