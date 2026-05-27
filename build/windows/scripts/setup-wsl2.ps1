#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Symbol Network Manager — WSL2 セットアップ
.DESCRIPTION
    WSL2 を有効化し、Ubuntu ディストリビューションをインストールします。
    再起動が必要な場合は RunOnce レジストリで再起動後の続行をスケジュールします。
#>
[CmdletBinding()]
param(
    [string]$ResumeFlag = ""
)

$ErrorActionPreference = 'Stop'

# ── 状態ファイル（再起動後の続行判定用）──────────────────────────
$StateFile = Join-Path $env:TEMP "symbol-setup-wsl-state.json"

function Write-Step {
    param([string]$Msg)
    Write-Host ""
    Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Test-WslInstalled {
    try {
        $result = wsl --status 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-WslDistroInstalled {
    try {
        $list = wsl --list --quiet 2>&1 | Where-Object { $_ -match '\S' }
        return ($null -ne $list -and $list.Count -gt 0)
    } catch {
        return $false
    }
}

# ── 再起動後の続行チェック ────────────────────────────────────────
if ($ResumeFlag -eq "after-reboot") {
    Write-Step "再起動後の WSL2 セットアップを続行します..."
    # 状態ファイルをクリーンアップ
    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
    # RunOnce レジストリをクリーンアップ
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
        -Name "SymbolSetupResume" -ErrorAction SilentlyContinue
}

# ── Step 1: WSL 機能の有効化 ──────────────────────────────────────
Write-Step "WSL2 の状態を確認しています..."

if (Test-WslInstalled) {
    Write-Host "  WSL2 は既にインストールされています。" -ForegroundColor Green
} else {
    Write-Step "WSL2 をインストールしています..."
    Write-Host "  (wsl --install --no-distribution)" -ForegroundColor DarkGray

    # wsl --install enables WSL + Virtual Machine Platform + downloads kernel
    $wslResult = Start-Process -FilePath "wsl" -ArgumentList "--install", "--no-distribution" `
        -Wait -PassThru -NoNewWindow

    if ($wslResult.ExitCode -ne 0) {
        # Fallback: manually enable features
        Write-Host "  フォールバック: Windows 機能を手動で有効化しています..." -ForegroundColor Yellow

        dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
        dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
    }

    # 再起動が必要かチェック
    $needsReboot = $false
    try {
        $pending = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending" -ErrorAction Stop
        $needsReboot = $true
    } catch {}
    try {
        $pending2 = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" -ErrorAction Stop
        $needsReboot = $true
    } catch {}

    if ($needsReboot) {
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
        Write-Host "║  WSL2 の有効化には再起動が必要です。                    ║" -ForegroundColor Yellow
        Write-Host "║  再起動後、セットアップは自動的に続行されます。         ║" -ForegroundColor Yellow
        Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Yellow

        # 再起動後に続行するため RunOnce レジストリに登録
        $scriptPath = $MyInvocation.MyCommand.Path
        $resumeCmd = "powershell.exe -ExecutionPolicy Bypass -File `"$scriptPath`" -ResumeFlag after-reboot"
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
            -Name "SymbolSetupResume" -Value $resumeCmd

        # 状態ファイル保存
        @{ step = "wsl-reboot"; timestamp = (Get-Date).ToString("o") } |
            ConvertTo-Json | Set-Content $StateFile

        Write-Host ""
        $answer = Read-Host "今すぐ再起動しますか? (Y/n)"
        if ($answer -eq "" -or $answer -match "^[yY]") {
            Restart-Computer -Force
        } else {
            Write-Host "  手動で再起動してください。再起動後にセットアップが自動続行されます。" -ForegroundColor Yellow
            exit 3  # Special exit code = reboot required
        }
        exit 3
    }
}

# ── Step 2: WSL2 をデフォルトバージョンに設定 ─────────────────────
Write-Step "WSL2 をデフォルトバージョンに設定しています..."
wsl --set-default-version 2 2>&1 | Out-Null
Write-Host "  完了" -ForegroundColor Green

# ── Step 3: Ubuntu ディストリビューションのインストール ───────────
Write-Step "Ubuntu ディストリビューションを確認しています..."

if (Test-WslDistroInstalled) {
    $distros = wsl --list --quiet 2>&1 | Where-Object { $_ -match '\S' }
    Write-Host "  既存のディストリビューション: $($distros -join ', ')" -ForegroundColor Green
} else {
    Write-Host "  Ubuntu をインストールしています..." -ForegroundColor Yellow
    Write-Host "  (wsl --install -d Ubuntu --no-launch)" -ForegroundColor DarkGray

    wsl --install -d Ubuntu --no-launch 2>&1 | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠ Ubuntu のインストールに失敗しました。" -ForegroundColor Red
        Write-Host "  Microsoft Store から手動でインストールしてください。" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  Ubuntu をインストールしました。" -ForegroundColor Green
}

# ── 完了 ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "✓ WSL2 セットアップ完了" -ForegroundColor Green
exit 0
