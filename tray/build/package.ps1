# Builds bnl-tray.exe and assembles the distribution ZIP.
#
# The package contains the tray application plus the two batch files it does NOT
# run itself: BNL-Setup.bat and BNL-Uninstall.bat are executed by the user.
#
#   powershell -ExecutionPolicy Bypass -File build\package.ps1

param(
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$trayRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $trayRoot
$scriptSource = Join-Path $repoRoot "draft\windows"
$distRoot = Join-Path $trayRoot "dist"
$stageDir = Join-Path $distRoot "BNL-Tray-$Version"

Write-Host "=== BNL Tray $Version ===" -ForegroundColor Cyan

# --- Build ------------------------------------------------------------------
# -H windowsgui is mandatory: without it the resident application keeps a
# console window open for its whole lifetime.
$exePath = Join-Path $stageDir "bnl-tray.exe"

if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

Write-Host "Building bnl-tray.exe..."
Push-Location $trayRoot
try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    & go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=$Version" -o $exePath ./cmd/bnl-tray
    if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$sizeMB = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host "  bnl-tray.exe ($sizeMB MB)" -ForegroundColor Green

# --- Collect the lifecycle scripts the tray app does not run ----------------
foreach ($name in @("BNL-Setup.bat", "BNL-Uninstall.bat")) {
    $source = Join-Path $scriptSource $name
    if (-not (Test-Path $source)) { throw "Missing $source" }
    Copy-Item $source (Join-Path $stageDir $name) -Force
    Write-Host "  $name"
}

# The manual ships in English (matching the UI) and Japanese.
$manuals = @{
    "dist-README.md"    = "README.md"
    "dist-README.ja.md" = "README.ja.md"
}
foreach ($source in $manuals.Keys) {
    $path = Join-Path $trayRoot "build\$source"
    if (-not (Test-Path $path)) { throw "Missing $path" }
    Copy-Item $path (Join-Path $stageDir $manuals[$source]) -Force
    Write-Host "  $($manuals[$source])"
}

# --- ZIP --------------------------------------------------------------------
$zipPath = Join-Path $distRoot "BNL-Tray-$Version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $stageDir -DestinationPath $zipPath -CompressionLevel Optimal

$zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "`nCreated: $zipPath ($zipMB MB)" -ForegroundColor Green
