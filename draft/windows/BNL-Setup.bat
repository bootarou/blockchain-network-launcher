@echo off
setlocal
chcp 65001 >nul

echo ============================================================
echo  BNL Setup / Update
echo ============================================================
echo.
echo This runs the current BNL installer from GitHub.
echo Existing Branch / BIND_ADDRESS / ADMIN_PASSWORD can be reviewed.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$u='https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1?cache='+[guid]::NewGuid(); Invoke-Expression (Invoke-RestMethod $u)"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo BNL Setup failed. Exit code: %RC%
  pause
  exit /b %RC%
)

exit /b 0
