@echo off
setlocal
echo ============================================================
echo  BNL Stop
echo ============================================================
echo.
echo Stopping BNL manager only...
wsl.exe -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose stop symbol-manager"
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to stop BNL manager.
  pause
  exit /b 1
)
echo.
echo [OK] BNL manager stopped.
echo Symbol nodes, Docker, Ubuntu and keepalive were not changed.
exit /b 0
