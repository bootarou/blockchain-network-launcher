@echo off
setlocal
chcp 65001 >nul

echo ============================================================
echo  BNL Uninstall - BNL ONLY
echo ============================================================
echo.
echo This removes ONLY the BNL manager application.
echo.
echo The following are NOT removed or stopped:
echo   - Symbol node containers
echo   - /opt/symbol-target blockchain data
echo   - Docker Engine
echo   - Ubuntu / WSL
echo   - WSL keepalive process
echo.
echo If Symbol nodes are running, they will be left untouched.
echo.
set /p "CONFIRM=Type UNINSTALL to continue: "
if /I not "%CONFIRM%"=="UNINSTALL" (
  echo Cancelled.
  exit /b 0
)

echo.
echo Removing BNL manager...
wsl.exe -d Ubuntu -u root -- bash -lc "set -e; if [ -d /opt/bnl ]; then cd /opt/bnl; docker compose stop symbol-manager >/dev/null 2>&1 || true; docker compose rm -f symbol-manager >/dev/null 2>&1 || true; fi; docker image rm bnl-symbol-manager:latest >/dev/null 2>&1 || true; rm -rf /opt/bnl"

if errorlevel 1 (
  echo.
  echo BNL uninstall failed.
  pause
  exit /b 1
)

echo.
echo [OK] BNL manager removed.
echo Symbol nodes and blockchain data were not changed.
echo.
echo WSL keepalive remains active so running Symbol nodes are not affected.
echo If all nodes are already stopped and you want to stop WSL too, run:
echo   wsl --shutdown
exit /b 0
