# ZIP作成スクリプト
# 各OS用のINSTALL.mdをソースコードと一緒にZIPに同梱する

param(
    [string]$ProjectRoot = "C:\Symbol-web-ui"
)

$ErrorActionPreference = "Stop"

# 配布に含めるファイル/フォルダ一覧
$includeItems = @(
    "backend",
    "frontend",
    "shared",
    "docker-compose.yml",
    "Dockerfile",
    "start.sh",
    ".env.example",
    ".dockerignore",
    ".gitignore"
)

# 除外パターン
$excludeDirs = @("node_modules", "dist", ".git", ".vscode", "draft")
$excludeFiles = @(
    "*.py", "debug_wrapper.sh", "body.json", "test-body.json",
    "MANUAL.md", "summary.md", "*.log"
)

# 一時ステージングディレクトリ
$stagingBase = Join-Path $env:TEMP "symbol-web-ui-dist"
if (Test-Path $stagingBase) { Remove-Item $stagingBase -Recurse -Force }

$platforms = @("windows", "mac", "linux")

foreach ($platform in $platforms) {
    Write-Host "`n=== Creating ZIP for $platform ===" -ForegroundColor Cyan

    $stagingDir = Join-Path $stagingBase $platform
    $targetDir = Join-Path $stagingDir "symbol-web-ui"
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

    # ソースファイルをコピー
    foreach ($item in $includeItems) {
        $src = Join-Path $ProjectRoot $item
        if (-not (Test-Path $src)) {
            Write-Host "  SKIP (not found): $item" -ForegroundColor Yellow
            continue
        }

        $dest = Join-Path $targetDir $item

        if ((Get-Item $src).PSIsContainer) {
            # ディレクトリ: robocopy で除外しながらコピー
            $excludeDirArgs = $excludeDirs | ForEach-Object { "/XD"; $_ }
            $excludeFileArgs = $excludeFiles | ForEach-Object { "/XF"; $_ }

            $robocopyArgs = @($src, $dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP") + $excludeDirArgs + $excludeFileArgs
            & robocopy @robocopyArgs | Out-Null
            # robocopy exit code 0-7 = success
        }
        else {
            # ファイル
            Copy-Item $src $dest -Force
        }
    }

    # shared/ を空ディレクトリとして作成（中のユーザーデータは含めない）
    $sharedDest = Join-Path $targetDir "shared"
    if (Test-Path $sharedDest) { Remove-Item $sharedDest -Recurse -Force }
    New-Item -ItemType Directory -Path $sharedDest -Force | Out-Null
    # .gitkeep を配置
    "" | Set-Content (Join-Path $sharedDest ".gitkeep")

    # OS固有のINSTALL.mdをコピー
    $installSrc = Join-Path $ProjectRoot "draft\$platform\INSTALL.md"
    if (Test-Path $installSrc) {
        Copy-Item $installSrc (Join-Path $targetDir "INSTALL.md") -Force
        Write-Host "  Added INSTALL.md for $platform"
    }

    # .env.example から .env を生成（Windows用は /var/lib、Linux用はそのまま）
    $envSrc = Join-Path $ProjectRoot ".env.example"
    if (Test-Path $envSrc) {
        $envContent = Get-Content $envSrc -Raw
        if ($platform -eq "windows") {
            $envContent = $envContent -replace "SYMBOL_TARGET_DIR=.*", "SYMBOL_TARGET_DIR=/var/lib/symbol-target"
        }
        elseif ($platform -eq "mac") {
            $envContent = $envContent -replace "SYMBOL_TARGET_DIR=.*", "SYMBOL_TARGET_DIR=/var/lib/symbol-target"
        }
        # linux: keep .env.example default
        $envContent | Set-Content (Join-Path $targetDir ".env.example") -NoNewline
    }

    # ZIP作成
    $outputDir = Join-Path $ProjectRoot "draft\$platform"
    if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
    $zipPath = Join-Path $outputDir "symbol-web-ui.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    Compress-Archive -Path $targetDir -DestinationPath $zipPath -CompressionLevel Optimal
    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  Created: $zipPath ($sizeMB MB)" -ForegroundColor Green
}

# クリーンアップ
Remove-Item $stagingBase -Recurse -Force

Write-Host "`n=== All ZIPs created ===" -ForegroundColor Green
Write-Host "  draft/windows/symbol-web-ui.zip"
Write-Host "  draft/mac/symbol-web-ui.zip"
Write-Host "  draft/linux/symbol-web-ui.zip"
