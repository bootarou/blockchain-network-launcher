# BNL Windows インストーラー（WSL2）

Windows + WSL2 上に Blockchain Network Launcher（BNL）を導入・更新するインストーラーです。
Docker Desktop は使用しません。WSL2 の Ubuntu 内へ Docker Engine / Docker Compose Plugin / Git を直接導入します。

## 動作要件

| 項目 | 要件 |
|---|---|
| OS | Windows 10（ビルド 19041 以降）/ Windows 11 |
| 権限 | WSL2 の初回導入時のみ管理者権限（UAC で自動的に昇格を求めます） |
| ネットワーク | GitHub・Ubuntu / Docker のパッケージ配布元・Windows Update に接続できること |

## 実行方法

`BNL-Setup.bat` をダブルクリックします。タスクトレイアプリ BNL Tray の配布物（`tray/build/`）に同梱しているほか、リポジトリのルートにもあります。

`BNL-Setup.bat` は、実行するたびに `main` ブランチの最新の `install.ps1` を一時フォルダへダウンロードし、`powershell.exe -File` で実行します。

PowerShell から直接実行する場合は次のとおりです。

```powershell
$p = Join-Path $env:TEMP 'bnl-install.ps1'
Invoke-WebRequest 'https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1' -OutFile $p
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p
```

## 途中で入力する項目

| 項目 | 内容 |
|---|---|
| BNL の種類 | 1) BNL client（既定）/ 2) Symbol official client / 3) BNL Custom（開発者向け）。違いは README の「ブランチ構成」を参照 |
| `BIND_ADDRESS` | Web UI と API を公開するアドレス。通常は `127.0.0.1`（この PC からのみアクセス可） |
| 管理者パスワード | Web UI のログイン用。8〜64 文字（`A-Z a-z 0-9 ! @ # % _ . -`）。画面にもログにも表示しません |

PQC の 2 ブランチ（`feat-PQC-custom-catapult` / `feat-empty-block-policy`）は選択肢に表示しませんが、ブランチ名を入力すれば選べます。

## 自動で行うこと

1. 管理者権限を確認し、WSL2 の初回導入が必要なら UAC で昇格する
2. Windows のビルド（19041 以降）を確認する
3. WSL の機能が無効なら、先に **Windows Update の状態を確認**する
   - 更新のインストール中、または再起動待ちの場合は、Windows Update を先に完了するよう案内して止まる（「無視して続行」も選べる）
4. 「Linux 用 Windows サブシステム」と「仮想マシン プラットフォーム」を有効化する
5. 必要なら Windows を再起動し、サインイン後にインストーラーを自動で再開する
6. WSL を更新し、Ubuntu を WSL2 として導入する（未導入の場合）
7. Ubuntu を root で初期化し、対話式の Linux ユーザー作成を回避する。systemd を有効にする
8. Ubuntu 内に Docker Engine / Docker Compose Plugin / Git を導入する
9. 選んだブランチで BNL を `/opt/bnl` に clone する（導入済みなら、そのブランチに切り替えて更新）
10. `.env` を作成し（既存の `.env` は維持）、`BIND_ADDRESS` と管理者パスワードを設定する
11. `docker compose up -d --build` で BNL を起動し、Web UI が応答したらブラウザで開く

## 再実行・更新

`BNL-Setup.bat` は何度実行しても構いません。再実行すると更新になります。

- BNL の種類の既定値は、現在インストールされているブランチです
- 既存の `.env` は上書きしません。管理者パスワードは「そのまま / 変更」を選べます
- `/opt/bnl` にローカルの変更がある場合は、自動更新（fast-forward）をスキップします。ブランチを切り替える場合は、変更を退避するまで止まります
- Docker が導入済みなら再インストールしません

## BNL の操作

起動 / 停止は、タスクトレイアプリ **BNL Tray** から行えます（[tray/build/dist-README.ja.md](tray/build/dist-README.ja.md)）。

PowerShell から直接操作する場合:

```powershell
# 起動
wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose up -d"
# 停止
wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose stop"
# 状態確認
wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose ps"
# ログ
wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs -f"
```

## ログと状態ファイル

`%LOCALAPPDATA%\BNL\` に保存します。

| ファイル | 内容 |
|---|---|
| `install.log` | インストーラーの実行ログ |
| `install.ps1` | 再起動後の自動再開と UAC 昇格に使うインストーラーのコピー |

## アンインストール

BNL Tray の配布物に同梱している `BNL-Uninstall.bat` を実行します。削除するのは BNL manager アプリ（`/opt/bnl`）だけです。Symbol ノードのデータ（`/opt/symbol-target`）、Docker、Ubuntu / WSL は残ります。

## 注意事項

- BNL は `Ubuntu` という名前の WSL ディストリビューションを利用します。既に `Ubuntu` を使っている PC では、その環境に Docker Engine と BNL が追加されます。
- 破壊的な復旧処理（`wsl --unregister` など）は行いません。既存の Ubuntu ディストリビューションを削除することはありません。
