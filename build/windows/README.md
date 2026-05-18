# Symbol Network Manager — Windows インストーラ ビルドガイド

## 概要

Inno Setup + PowerShell スクリプトで、ワンクリック Windows インストーラ EXE を生成します。

```
SymbolNetworkManager-Setup-1.2.2.exe
│
├── ① 同梱済みプロジェクトで docker compose build + up
└── ② ブラウザで http://localhost:5173 を開く
```

## ファイル構成

```
build/windows/
├── setup.iss                     # Inno Setup メイン定義ファイル
├── scripts/
│   ├── check-prereqs.ps1         # (旧) 前提条件チェック
│   ├── setup-wsl2.ps1            # (旧) WSL2 セットアップ
│   ├── setup-docker.ps1          # (旧) Docker Desktop セットアップ
│   └── setup-project.ps1         # 同梱プロジェクト起動
├── output/                       # ビルド成果物 (EXE) ※ gitignore
└── README.md                     # このファイル
```

## ユーザー側の前提条件

- Docker Desktop は事前にインストール済み・起動済みであること
- docker compose が実行可能であること

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
4. `build/windows/output/SymbolNetworkManager-Setup-1.2.2.exe` が生成される

### コマンドラインでビルド

```powershell
cd build\windows
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
```

生成先: `build/windows/output/SymbolNetworkManager-Setup-1.2.2.exe`

## インストーラの動作

### ユーザーが見る画面

1. **ようこそ画面** — セットアップ内容の説明
2. **インストール先選択** — デフォルト: `%LOCALAPPDATA%\Programs\SymbolNetworkManager`
3. **インストール進行** — プロジェクトセットアップの進捗表示
4. **完了画面** — セットアップ完了メッセージ

### 内部処理フロー

```
setup-project.ps1
├── 同梱プロジェクト検証 (docker-compose.yml 存在確認)
├── docker compose / docker engine 実行可否確認
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

### アイコンの追加

1. `.ico` ファイルを `build/windows/assets/icon.ico` に配置
2. `setup.iss` の `SetupIconFile` 行をアンコメント

## 注意事項

- **Docker Desktop の事前準備**: このインストーラは Docker Desktop を自動インストールしません。事前にユーザー側でインストール・起動してください。
- **トラブルシュートログ**: プロジェクトセットアップ中のログは `%LOCALAPPDATA%\SymbolNetworkManager\setup-project.log` に出力されます。
- **インストーラログ**: Inno Setup の実行ログは `%TEMP%\Setup Log*.txt` に出力されます。
- **Docker Desktop ライセンス**: Docker Desktop は小規模企業（250人未満＆年間収益 $10M 未満）では無料です。それ以外は有料サブスクリプションが必要です。
- **COMPOSE_BAKE 回避**: Docker Compose v2.34+ の Bake 機能による問題を自動回避します。
- **Windows Defender**: Inno Setup で生成した EXE は広く認知されていますが、コード署名がない場合 SmartScreen 警告が表示される場合があります。
