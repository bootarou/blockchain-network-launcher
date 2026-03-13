#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Symbol Network Manager — プロジェクトセットアップ
.DESCRIPTION
    リポジトリのクローン、Docker イメージのビルド、コンテナ起動、
    ブラウザ起動、デスクトップショートカット作成を行います。
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$RepoUrl = "https://github.com/bootarou/blockchain-network-launcher.git"
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:USERPROFILE "symbol-network-manager"
}

$ProjectDir = Join-Path $InstallDir "blockchain-network-launcher"
$AppUrl = "http://localhost:5173"

function Write-Step {
    param([string]$Msg)
    Write-Host ""
    Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Test-GitInstalled {
    try {
        git --version 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# ── Step 1: Git の確認・インストール ─────────────────────────────
Write-Step "Git を確認しています..."

if (Test-GitInstalled) {
    $gitVer = git --version 2>&1
    Write-Host "  $gitVer" -ForegroundColor Green
} else {
    Write-Host "  Git がインストールされていません。インストールします..." -ForegroundColor Yellow

    $useWinget = $false
    try {
        winget --version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $useWinget = $true }
    } catch {}

    if ($useWinget) {
        winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements 2>&1
        # PATH 更新
        $gitPath = "$env:ProgramFiles\Git\cmd"
        if (Test-Path $gitPath) { $env:PATH = "$gitPath;$env:PATH" }
    } else {
        Write-Host "  ✗ winget が利用できません。Git を手動でインストールしてください:" -ForegroundColor Red
        Write-Host "    https://git-scm.com/download/win" -ForegroundColor Yellow
        exit 1
    }

    if (-not (Test-GitInstalled)) {
        Write-Host "  ✗ Git のインストールに失敗しました。" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Git をインストールしました。" -ForegroundColor Green
}

# ── Step 2: リポジトリのクローン ─────────────────────────────────
Write-Step "リポジトリをクローンしています..."

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

if (Test-Path (Join-Path $ProjectDir ".git")) {
    Write-Host "  既存のリポジトリが見つかりました。最新版に更新します..." -ForegroundColor Yellow
    Push-Location $ProjectDir
    git pull origin main 2>&1
    Pop-Location
} else {
    if (Test-Path $ProjectDir) {
        Write-Host "  ⚠ $ProjectDir が存在しますが Git リポジトリではありません。" -ForegroundColor Yellow
        Write-Host "  バックアップして再クローンします..." -ForegroundColor Yellow
        $backupPath = "$ProjectDir.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Rename-Item $ProjectDir $backupPath
    }
    git clone $RepoUrl $ProjectDir 2>&1
}

if (-not (Test-Path (Join-Path $ProjectDir "docker-compose.yml"))) {
    Write-Host "  ✗ クローンに失敗しました。docker-compose.yml が見つかりません。" -ForegroundColor Red
    exit 1
}

Write-Host "  クローン先: $ProjectDir" -ForegroundColor Green

# ── Step 3: Docker イメージのビルド ──────────────────────────────
Write-Step "Docker イメージをビルドしています（数分かかります）..."
Push-Location $ProjectDir

# Docker Compose v2.34+ の Bake 問題を回避
$env:COMPOSE_BAKE = "false"

# ビルド実行
$buildOutput = docker compose build 2>&1 | Out-String
$buildSuccess = $buildOutput -match "symbol-manager\s+(Built|Successfully built)"

# exit code 1 は Docker Desktop の stderr 出力による false positive の場合がある
if (-not $buildSuccess) {
    # イメージが作成されたか直接確認
    $images = docker images --filter "reference=*symbol-manager*" --format "{{.Repository}}:{{.Tag}}" 2>&1
    $buildSuccess = ($images -match "symbol-manager")
}

if ($buildSuccess) {
    Write-Host "  ✓ ビルド成功" -ForegroundColor Green
} else {
    Write-Host "  ✗ ビルドに失敗しました。出力:" -ForegroundColor Red
    Write-Host $buildOutput -ForegroundColor DarkGray
    Pop-Location
    exit 1
}

# ── Step 4: コンテナの起動 ───────────────────────────────────────
Write-Step "コンテナを起動しています..."

docker compose up -d 2>&1

# ヘルスチェック待ち
Write-Host "  コンテナの起動を待っています..." -ForegroundColor Yellow
$maxWait = 60
$elapsed = 0
$ready = $false
while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-WebRequest -Uri "$AppUrl" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
    $elapsed += 3
    Write-Host "    ... $elapsed 秒経過" -ForegroundColor DarkGray
}

Pop-Location

if ($ready) {
    Write-Host "  ✓ アプリケーションが起動しました" -ForegroundColor Green
} else {
    Write-Host "  ⚠ アプリケーションの起動確認がタイムアウトしました。" -ForegroundColor Yellow
    Write-Host "  docker compose logs で状態を確認してください。" -ForegroundColor Yellow
}

# ── Step 5: デスクトップショートカット作成 ────────────────────────
Write-Step "デスクトップショートカットを作成しています..."

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Symbol Network Manager.lnk"

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-ExecutionPolicy Bypass -Command `"Start-Process '$AppUrl'; Push-Location '$ProjectDir'; docker compose up -d`""
    $shortcut.WorkingDirectory = $ProjectDir
    $shortcut.Description = "Symbol Network Manager を起動します"
    $shortcut.IconLocation = "shell32.dll,13"
    $shortcut.Save()
    Write-Host "  ✓ ショートカットを作成しました: $shortcutPath" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ ショートカットの作成に失敗しました: $_" -ForegroundColor Yellow
}

# ── Step 6: ブラウザを開く ───────────────────────────────────────
Write-Step "ブラウザで Symbol Network Manager を開いています..."
Start-Process $AppUrl

# ── 完了 ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✓ セットアップ完了！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  アプリケーション URL: $AppUrl" -ForegroundColor White
Write-Host "  インストール先:      $ProjectDir" -ForegroundColor White
Write-Host "  デスクトップショートカット: Symbol Network Manager" -ForegroundColor White
Write-Host ""
Write-Host "  次回起動時は、デスクトップの「Symbol Network Manager」をクリックするか、" -ForegroundColor DarkGray
Write-Host "  以下のコマンドを実行してください:" -ForegroundColor DarkGray
Write-Host "    cd $ProjectDir" -ForegroundColor DarkGray
Write-Host "    docker compose up -d" -ForegroundColor DarkGray
Write-Host ""
exit 0
