@echo off
setlocal
chcp 65001 >nul

echo ============================================================
echo  BNL Start
echo ============================================================
echo.

REM Start Ubuntu, keep WSL alive, ensure Docker is running,
REM then start ONLY the BNL manager container.
wsl.exe -d Ubuntu -u root -- bash -lc "set -e; if [ ! -d /opt/bnl ]; then echo '[ERROR] /opt/bnl not found. Run BNL-Setup first.' >&2; exit 10; fi; PIDFILE=/run/bnl-wsl-keepalive.pid; if [ -f $PIDFILE ] && kill -0 $(cat $PIDFILE 2>/dev/null) 2>/dev/null; then :; else rm -f $PIDFILE; nohup tail -f /dev/null >/var/log/bnl-wsl-keepalive.log 2>&1 </dev/null & echo $! >$PIDFILE; fi; if ! docker info >/dev/null 2>&1; then systemctl start docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true; fi; for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; docker info >/dev/null 2>&1 || { echo '[ERROR] Docker did not start.' >&2; exit 11; }; cd /opt/bnl; docker compose up -d symbol-manager"

if errorlevel 1 (
  echo.
  echo BNL could not be started.
  echo Run this for logs:
  echo wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl ^&^& docker compose logs --tail=200 symbol-manager"
  pause
  exit /b 1
)

echo Waiting for BNL Web UI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 100 -and $r.StatusCode -lt 500){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){exit 1}; Start-Process 'http://127.0.0.1:5173'"

if errorlevel 1 (
  echo.
  echo BNL container started, but Web UI did not become reachable.
  echo Run this for logs:
  echo wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl ^&^& docker compose logs --tail=200 symbol-manager"
  pause
  exit /b 1
)

echo [OK] BNL is running: http://127.0.0.1:5173
exit /b 0
