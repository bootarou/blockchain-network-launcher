#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Symbol Network Manager — Docker Desktop セットアップ
.DESCRIPTION
    Docker Desktop for Windows をインストールし、WSL2 バックエンドで起動します。
    既にインストール済みの場合はスキップします。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$DockerDesktopUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
$InstallerPath = Join-Path $env:TEMP "DockerDesktopInstaller.exe"

function Write-Step {
    param([string]$Msg)
    Write-Host ""
    Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Test-DockerInstalled {
    try {
        $ver = docker --version 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-DockerRunning {
    try {
        docker info 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Wait-ForDocker {
    param([int]$TimeoutSeconds = 120)

    Write-Host "  Docker Desktop の起動を待っています..." -ForegroundColor Yellow
    $elapsed = 0
    $interval = 5
    while ($elapsed -lt $TimeoutSeconds) {
        if (Test-DockerRunning) {
            return $true
        }
        Start-Sleep -Seconds $interval
        $elapsed += $interval
        Write-Host "    ... $elapsed 秒経過 (最大 $TimeoutSeconds 秒)" -ForegroundColor DarkGray
    }
    return $false
}

# ── Step 1: Docker Desktop の確認 ────────────────────────────────
Write-Step "Docker Desktop の状態を確認しています..."

if (Test-DockerInstalled) {
    $ver = docker --version 2>&1
    Write-Host "  Docker は既にインストールされています: $ver" -ForegroundColor Green
} else {
    # ── Step 2: winget で試す → フォールバックで直接ダウンロード ──
    Write-Step "Docker Desktop をインストールしています..."

    $useWinget = $false
    try {
        $wingetVer = winget --version 2>&1
        if ($LASTEXITCODE -eq 0) { $useWinget = $true }
    } catch {}

    if ($useWinget) {
        Write-Host "  winget を使用してインストールします..." -ForegroundColor Yellow
        winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Host "  winget でのインストールに失敗しました。直接ダウンロードにフォールバックします。" -ForegroundColor Yellow
            $useWinget = $false
        }
    }

    if (-not $useWinget) {
        Write-Host "  Docker Desktop インストーラをダウンロードしています..." -ForegroundColor Yellow
        Write-Host "  URL: $DockerDesktopUrl" -ForegroundColor DarkGray

        try {
            # TLS 1.2 を強制
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $DockerDesktopUrl -OutFile $InstallerPath -UseBasicParsing
        } catch {
            Write-Host "  ✗ ダウンロードに失敗しました: $_" -ForegroundColor Red
            Write-Host "  手動で Docker Desktop をインストールしてください:" -ForegroundColor Yellow
            Write-Host "    https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
            exit 1
        }

        Write-Host "  サイレントインストールを実行しています..." -ForegroundColor Yellow
        $proc = Start-Process -FilePath $InstallerPath `
            -ArgumentList "install", "--quiet", "--accept-license", "--backend=wsl-2" `
            -Wait -PassThru -NoNewWindow

        if ($proc.ExitCode -ne 0) {
            Write-Host "  ✗ Docker Desktop のインストールに失敗しました (exit code: $($proc.ExitCode))" -ForegroundColor Red
            exit 1
        }

        # インストーラの一時ファイルを削除
        Remove-Item $InstallerPath -Force -ErrorAction SilentlyContinue
    }

    # PATH を更新（新しいインストールを反映）
    $dockerPaths = @(
        "$env:ProgramFiles\Docker\Docker\resources\bin",
        "$env:LOCALAPPDATA\Docker\wsl\distro\bin"  # Newer Docker Desktop
    )
    foreach ($dp in $dockerPaths) {
        if ((Test-Path $dp) -and ($env:PATH -notlike "*$dp*")) {
            $env:PATH = "$dp;$env:PATH"
        }
    }

    Write-Host "  Docker Desktop をインストールしました。" -ForegroundColor Green
}

# ── Step 3: Docker Desktop を起動 ────────────────────────────────
Write-Step "Docker Desktop を起動しています..."

if (Test-DockerRunning) {
    Write-Host "  Docker Desktop は既に実行中です。" -ForegroundColor Green
} else {
    # Docker Desktop を起動
    $ddPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path $ddPath)) {
        # 別のパスを探す
        $ddPath = Get-ChildItem "$env:ProgramFiles\Docker" -Recurse -Filter "Docker Desktop.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    }

    if ($ddPath -and (Test-Path $ddPath)) {
        Start-Process -FilePath $ddPath -WindowStyle Minimized
    } else {
        Write-Host "  Docker Desktop の実行ファイルが見つかりません。手動で起動してください。" -ForegroundColor Yellow
    }

    # Docker が起動するまで待つ
    $dockerReady = Wait-ForDocker -TimeoutSeconds 180

    if (-not $dockerReady) {
        Write-Host "  ⚠ Docker Desktop の起動がタイムアウトしました。" -ForegroundColor Red
        Write-Host "  Docker Desktop を手動で起動してから再実行してください。" -ForegroundColor Yellow
        exit 1
    }
}

# ── Step 4: Docker Compose の確認 ────────────────────────────────
Write-Step "Docker Compose を確認しています..."

try {
    $composeVer = docker compose version 2>&1
    Write-Host "  $composeVer" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ docker compose コマンドが利用できません。" -ForegroundColor Red
    Write-Host "  Docker Desktop を最新版に更新してください。" -ForegroundColor Yellow
    exit 1
}

# ── 完了 ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "✓ Docker Desktop セットアップ完了" -ForegroundColor Green
exit 0
