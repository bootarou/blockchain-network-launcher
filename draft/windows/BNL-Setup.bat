@echo off
setlocal EnableExtensions

echo ============================================================
echo  BNL Setup / Update
echo ============================================================
echo.
echo Downloading the latest installer...
echo.

set "INSTALLER=%TEMP%\bnl-install-%RANDOM%-%RANDOM%.ps1"
set "URL=https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1?cache=%RANDOM%%RANDOM%"

where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -fL --retry 2 --connect-timeout 15 -o "%INSTALLER%" "%URL%"
) else (
    powershell.exe -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%INSTALLER%'"
)

if errorlevel 1 goto :download_error
if not exist "%INSTALLER%" goto :download_error

echo Starting installer...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"
set "RESULT=%ERRORLEVEL%"

del /q "%INSTALLER%" >nul 2>&1

if not "%RESULT%"=="0" (
    echo.
    echo [ERROR] BNL Setup failed.
    echo Log: %LOCALAPPDATA%\BNL\install.log
    pause
    exit /b %RESULT%
)

exit /b 0

:download_error
echo.
echo [ERROR] Could not download the BNL installer.
if exist "%INSTALLER%" del /q "%INSTALLER%" >nul 2>&1
pause
exit /b 1
