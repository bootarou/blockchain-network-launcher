@echo off
setlocal
chcp 65001 >nul

echo ============================================================
echo  BNL Stop
echo ============================================================
echo.
echo This stops ONLY the BNL manager.
echo Symbol node containers, Docker, Ubuntu and WSL keepalive are not stopped.
echo.

wsl.exe -d Ubuntu -u root -- bash -lc "if [ ! -d /opt/bnl ]; then echo '[ERROR] /opt/bnl not found.' >&2; exit 10; fi; cd /opt/bnl; docker compose stop symbol-manager"

if errorlevel 1 (
  echo.
  echo BNL could not be stopped.
  pause
  exit /b 1
)

echo.
echo [OK] BNL manager stopped.
echo Symbol nodes were not changed.
exit /b 0
