#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Symbol Network Manager — 前提条件チェック
.DESCRIPTION
    Windows バージョン、仮想化 (VT-x/AMD-V)、ディスク空き容量を検証します。
    すべて OK なら exit 0、NG があれば exit 1。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:hasError = $false

function Write-Check {
    param([string]$Label, [bool]$Ok, [string]$Detail)
    if ($Ok) {
        Write-Host "  [OK]  $Label — $Detail" -ForegroundColor Green
    } else {
        Write-Host "  [NG]  $Label — $Detail" -ForegroundColor Red
        $script:hasError = $true
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  前提条件チェック" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Windows バージョン ──────────────────────────────────────────
$os = [System.Environment]::OSVersion
$build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber

# WSL2 requires Windows 10 build 19041+ or Windows 11
$minBuild = 19041
$osOk = $build -ge $minBuild
$friendlyVer = if ($build -ge 22000) { "Windows 11 (Build $build)" } else { "Windows 10 (Build $build)" }
Write-Check "Windows バージョン" $osOk "$friendlyVer (必要: Build $minBuild 以上)"

# ── 2. 仮想化サポート ─────────────────────────────────────────────
try {
    $cpu = Get-CimInstance -ClassName Win32_Processor -Property VMMonitorModeExtensions -ErrorAction Stop
    $vtEnabled = [bool]$cpu.VMMonitorModeExtensions
} catch {
    # Fallback: check Hyper-V capability
    $vtEnabled = $false
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -Property HypervisorPresent -ErrorAction Stop
        $vtEnabled = [bool]$cs.HypervisorPresent
    } catch {}
}

# Additional check: if WSL is already working, virtualization is fine
if (-not $vtEnabled) {
    try {
        $wslCheck = wsl --status 2>&1
        if ($LASTEXITCODE -eq 0) { $vtEnabled = $true }
    } catch {}
}

Write-Check "仮想化 (VT-x / AMD-V)" $vtEnabled $(if ($vtEnabled) { "有効" } else { "無効 — BIOS で有効にしてください" })

# ── 3. ディスク空き容量 ───────────────────────────────────────────
$sysDrive = $env:SystemDrive
if (-not $sysDrive) { $sysDrive = "C:" }
$disk = Get-PSDrive -Name $sysDrive.TrimEnd(':') -ErrorAction SilentlyContinue
$freeGB = [math]::Round($disk.Free / 1GB, 1)
$requiredGB = 20
$diskOk = $freeGB -ge $requiredGB
Write-Check "ディスク空き容量 ($sysDrive)" $diskOk "${freeGB} GB 空き (必要: ${requiredGB} GB 以上)"

# ── 4. メモリ ─────────────────────────────────────────────────────
$totalMemGB = [math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$memOk = $totalMemGB -ge 8
Write-Check "物理メモリ" $memOk "${totalMemGB} GB (推奨: 8 GB 以上)"

# ── 5. インターネット接続 ─────────────────────────────────────────
$netOk = $false
try {
    $resp = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $netOk = $resp.StatusCode -eq 200
} catch {
    $netOk = $false
}
Write-Check "インターネット接続" $netOk $(if ($netOk) { "github.com に到達可能" } else { "github.com に接続できません" })

# ── 結果 ──────────────────────────────────────────────────────────
Write-Host ""
if ($script:hasError) {
    Write-Host "✗ 前提条件を満たしていない項目があります。" -ForegroundColor Red
    Write-Host "  上記の [NG] 項目を解決してから再実行してください。" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "✓ すべての前提条件を満たしています。" -ForegroundColor Green
    exit 0
}
