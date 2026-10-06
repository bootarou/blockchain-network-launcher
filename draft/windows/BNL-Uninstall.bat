@echo off
setlocal
echo ============================================================
echo  BNL Uninstall
echo ============================================================
echo.
echo This removes the BNL manager application only.
echo It DOES NOT remove:
echo   - /opt/symbol-target
echo   - Symbol node containers/data
echo   - Docker
echo   - Ubuntu / WSL
echo.
set /p CONFIRM=Type UNINSTALL to continue: 
if /I not "%CONFIRM%"=="UNINSTALL" (
  echo Cancelled.
  exit /b 0
)

wsl.exe -d Ubuntu -u root -- bash -lc "if [ -d /opt/bnl ]; then cd /opt/bnl && docker compose stop symbol-manager >/dev/null 2>&1 || true; docker compose rm -f symbol-manager >/dev/null 2>&1 || true; fi; rm -rf /opt/bnl"
if errorlevel 1 (
  echo.
  echo [ERROR] Uninstall failed.
  pause
  exit /b 1
)

echo.
echo [OK] BNL manager application removed.
echo Symbol node data was preserved.
exit /b 0
