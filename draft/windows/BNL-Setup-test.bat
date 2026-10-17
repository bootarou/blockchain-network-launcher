@echo off
setlocal EnableExtensions

echo ============================================================
echo  BNL Setup / Update  [TEST: feat-installer-wu-check]
echo ============================================================
echo.
echo This test launcher uses install.ps1 from branch feat-installer-wu-check.
echo Use BNL-Setup.bat for normal installs.
echo.
echo Downloading the test installer...
echo.

set "INSTALLER=%TEMP%\bnl-install-%RANDOM%-%RANDOM%.ps1"
set "URL=https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/feat-installer-wu-check/install.ps1?cache=%RANDOM%%RANDOM%"

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
    echo [ERROR] BNL Setup [test] failed.
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
