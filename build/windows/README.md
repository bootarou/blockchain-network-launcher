# Symbol Network Manager — Windows インストーラ ビルドガイド

## 概要

Inno Setup + PowerShell スクリプトで、ワンクリック Windows インストーラ EXE を生成します。

```
SymbolNetworkManager-Setup-1.2.0.exe
│
├── ① 前提条件チェック (Windows版, 仮想化, ディスク, メモリ, ネット)
├── ② WSL2 インストール (必要なら再起動→自動続行)
├── ③ Docker Desktop インストール (winget or 直接ダウンロード)
├── ④ Git インストール
├── ⑤ リポジトリ clone + docker compose build + up
└── ⑥ ブラウザで http://localhost:5173 を開く
```

## ファイル構成

```
build/windows/
├── setup.iss                     # Inno Setup メイン定義ファイル
├── scripts/
│   ├── check-prereqs.ps1         # 前提条件チェック
│   ├── setup-wsl2.ps1            # WSL2 セットアップ
│   ├── setup-docker.ps1          # Docker Desktop セットアップ
│   └── setup-project.ps1         # プロジェクトクローン＆起動
├── output/                       # ビルド成果物 (EXE) ※ gitignore
└── README.md                     # このファイル
```

## 前提条件（ビルド環境）

| ソフトウェア | バージョン | 入手先 |
|-------------|-----------|--------|
| **Inno Setup 6** | 6.2+ | https://jrsoftware.org/isinfo.php |

> 💡 Inno Setup は無料で、約 3MB の軽量インストーラコンパイラです。

## EXE のビルド手順

### GUI でビルド

1. [Inno Setup 6](https://jrsoftware.org/isinfo.php) をインストール
2. `build/windows/setup.iss` を Inno Setup Compiler で開く
3. **Build → Compile** (Ctrl+F9)
4. `build/windows/output/SymbolNetworkManager-Setup-1.2.0.exe` が生成される

### コマンドラインでビルド

```powershell
cd build\windows
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
```

生成先: `build/windows/output/SymbolNetworkManager-Setup-1.2.0.exe`

## インストーラの動作

### ユーザーが見る画面

1. **ようこそ画面** — セットアップ内容の説明
2. **インストール先選択** — デフォルト: `%APPDATA%\SymbolNetworkManager`
3. **インストール進行** — 各ステップの進捗表示
4. **完了画面** — 「Symbol Network Manager を開く」チェックボックス

### 内部処理フロー

```
[管理者権限で実行]
     │
     ▼
check-prereqs.ps1
├── Windows Build 19041+ ?
├── VT-x / AMD-V 有効?
├── ディスク 20GB+ 空き?
├── メモリ 8GB+ ?
└── インターネット接続?
     │ すべて OK
     ▼
setup-wsl2.ps1
├── wsl --install --no-distribution
├── 再起動が必要 → RunOnce レジストリ登録 → 再起動
│                   → 再起動後に自動続行
├── wsl --set-default-version 2
└── wsl --install -d Ubuntu --no-launch
     │
     ▼
setup-docker.ps1
├── winget install Docker.DockerDesktop
│   (失敗時 → 直接ダウンロード & サイレントインストール)
├── Docker Desktop 起動
└── docker compose version 確認
     │
     ▼
setup-project.ps1
├── winget install Git.Git (未インストール時)
├── git clone <repo>
├── COMPOSE_BAKE=false docker compose build
├── docker compose up -d
├── ヘルスチェック待ち (最大60秒)
├── デスクトップショートカット作成
└── ブラウザで http://localhost:5173 を開く
```

## 個別スクリプトのテスト

各 PowerShell スクリプトは単独で管理者権限 PowerShell から実行できます：

```powershell
# 前提条件チェックのみ
powershell -ExecutionPolicy Bypass -File scripts\check-prereqs.ps1

# WSL2 のみ
powershell -ExecutionPolicy Bypass -File scripts\setup-wsl2.ps1

# Docker のみ
powershell -ExecutionPolicy Bypass -File scripts\setup-docker.ps1

# プロジェクトセットアップのみ
powershell -ExecutionPolicy Bypass -File scripts\setup-project.ps1 -InstallDir "C:\test\symbol"
```

## カスタマイズ

### バージョン更新

[setup.iss](setup.iss) の先頭を編集：

```pascal
#define MyAppVersion "1.3.0"
```

### リポジトリ URL の変更

[scripts/setup-project.ps1](scripts/setup-project.ps1) のデフォルト値を変更：

```powershell
param(
    [string]$RepoUrl = "https://github.com/your-org/your-repo.git"
)
```

### アイコンの追加

1. `.ico` ファイルを `build/windows/assets/icon.ico` に配置
2. `setup.iss` の `SetupIconFile` 行をアンコメント

## 注意事項

- **WSL2 有効化後の再起動**: WSL2 がまだ有効でない場合、Windows の再起動が必要です。インストーラは RunOnce レジストリを使用して再起動後に自動続行します。
- **Docker Desktop ライセンス**: Docker Desktop は小規模企業（250人未満＆年間収益 $10M 未満）では無料です。それ以外は有料サブスクリプションが必要です。
- **COMPOSE_BAKE 回避**: Docker Compose v2.34+ の Bake 機能による問題を自動回避します。
- **Windows Defender**: Inno Setup で生成した EXE は広く認知されていますが、コード署名がない場合 SmartScreen 警告が表示される場合があります。
