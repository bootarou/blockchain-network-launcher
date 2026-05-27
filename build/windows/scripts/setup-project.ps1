<#
.SYNOPSIS
    Symbol Network Manager — プロジェクトセットアップ
.DESCRIPTION
    同梱済みプロジェクトを使って Docker イメージのビルド、コンテナ起動、
    ブラウザ起動、デスクトップショートカット作成を行います。
#>
[CmdletBinding()]
param(
    [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:USERPROFILE "symbol-network-manager"
}

$ProjectDir = $InstallDir
$AppUrl = "http://localhost:5173"
$LogDir = Join-Path $env:LOCALAPPDATA "SymbolNetworkManager"
$LogFile = Join-Path $LogDir "setup-project.log"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Msg)
    Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
}

function Fail-And-Exit {
    param(
        [string]$Message,
        [string]$Detail = ""
    )

    Write-Host "  ✗ $Message" -ForegroundColor Red
    if ($Detail) {
        Write-Host $Detail -ForegroundColor DarkGray
        Write-Log "DETAIL: $Detail"
    }
    Write-Host "  ログ: $LogFile" -ForegroundColor Yellow
    Write-Log "FAILED: $Message"
    exit 1
}

# まず開始行を直接書き込んで、途中中断時も痕跡を残す
Write-Log "setup-project.ps1 started. InstallDir=$InstallDir"
Write-Log "PSVersion=$($PSVersionTable.PSVersion) ProcessArch=$([Environment]::Is64BitProcess) OSArch=$([Environment]::Is64BitOperatingSystem)"
Write-Log "PATH=$env:PATH"

function Write-Step {
    param([string]$Msg)
    Write-Log "STEP: $Msg"
    Write-Host ""
    Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Find-DockerExe {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $candidates = @()
    if ($env:ProgramW6432) {
        $candidates += (Join-Path $env:ProgramW6432 "Docker\Docker\resources\bin\docker.exe")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe")
    }
    if ($env:'ProgramFiles(x86)') {
        $candidates += (Join-Path $env:'ProgramFiles(x86)' "Docker\Docker\resources\bin\docker.exe")
    }
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Invoke-DockerCapture {
    param(
        [string]$DockerExe,
        [string[]]$Arguments
    )

    $output = & $DockerExe @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output   = $output
    }
}

# ── Step 1: 同梱プロジェクトの検証 ────────────────────────────────
Write-Step "同梱プロジェクトを確認しています..."

if (-not (Test-Path $ProjectDir)) {
    Fail-And-Exit -Message "インストール先が見つかりません: $ProjectDir"
}

if (-not (Test-Path (Join-Path $ProjectDir "docker-compose.yml"))) {
    Fail-And-Exit -Message "同梱プロジェクトが不完全です。docker-compose.yml が見つかりません。" -Detail "インストーラにプロジェクト本体が同梱されているか確認してください。"
}

Write-Host "  プロジェクトパス: $ProjectDir" -ForegroundColor Green

# ── Step 2: Docker Compose の確認 ────────────────────────────────
Write-Step "Docker Compose の実行可否を確認しています..."

$dockerExe = Find-DockerExe
if (-not $dockerExe) {
    Fail-And-Exit -Message "docker コマンドが見つかりません。Docker Desktop のインストールと起動を確認してください。"
}

Write-Host "  docker: $dockerExe" -ForegroundColor DarkGray
Write-Log "docker.exe: $dockerExe"

$composeVersion = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('compose', 'version')
if ($composeVersion.ExitCode -ne 0) {
    Fail-And-Exit -Message "'docker compose' が実行できません。Docker Desktop が起動しているか確認してください。" -Detail $composeVersion.Output
}

# Docker engine 接続可否チェック
$dockerInfo = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('info')
if ($dockerInfo.ExitCode -ne 0) {
    Fail-And-Exit -Message "Docker engine に接続できません。Docker Desktop を起動してから再実行してください。" -Detail $dockerInfo.Output
}

# ── Step 3: Docker イメージのビルド ──────────────────────────────
Write-Step "Docker イメージをビルドしています（数分かかります）..."
Push-Location $ProjectDir

# Docker Compose v2.34+ の Bake 問題を回避
$env:COMPOSE_BAKE = "false"

# ビルド実行
$build = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('compose', 'build')
$buildOutput = $build.Output
$buildExitCode = $build.ExitCode
$buildSuccess = $buildOutput -match "symbol-manager\s+(Built|Successfully built)"
Write-Log "docker compose build exit=$buildExitCode"

# exit code 1 は Docker Desktop の stderr 出力による false positive の場合がある
if (($buildExitCode -ne 0) -or (-not $buildSuccess)) {
    # イメージが作成されたか直接確認
    $imagesResult = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('images', '--filter', 'reference=*symbol-manager*', '--format', '{{.Repository}}:{{.Tag}}')
    $images = $imagesResult.Output
    $buildSuccess = ($images -match "symbol-manager")
}

if ($buildSuccess) {
    Write-Host "  ✓ ビルド成功" -ForegroundColor Green
} else {
    Pop-Location
    Fail-And-Exit -Message "ビルドに失敗しました。" -Detail $buildOutput
}

# ── Step 4: コンテナの起動 ───────────────────────────────────────
Write-Step "コンテナを起動しています..."

$up = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('compose', 'up', '-d')
$upOutput = $up.Output
if ($up.ExitCode -ne 0) {
    Pop-Location
    Fail-And-Exit -Message "コンテナ起動に失敗しました。" -Detail $upOutput
}

# ヘルスチェック待ち
Write-Host "  コンテナの起動を待っています..." -ForegroundColor Yellow
$maxWait = 120
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
    $logs = Invoke-DockerCapture -DockerExe $dockerExe -Arguments @('compose', 'logs', '--no-color', '--tail', '100')
    Fail-And-Exit -Message "アプリケーションの起動確認がタイムアウトしました。" -Detail $logs.Output
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
Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] setup-project.ps1 completed successfully."
exit 0
