@echo off
setlocal EnableExtensions

echo ============================================================
echo  BNL Setup / Update
echo ============================================================
echo.
echo Loading the latest installer...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$u='https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1?cache='+[guid]::NewGuid(); Invoke-Expression (Invoke-RestMethod $u)"
if errorlevel 1 (
  echo.
  echo [ERROR] BNL Setup failed.
  echo Log: %LOCALAPPDATA%\BNL\install.log
  pause
  exit /b 1
)

exit /b 0
