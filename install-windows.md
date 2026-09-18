BNL One-Line Windows Installer

Windows + WSL2 上で Blockchain Network Launcher (BNL) を 1 行から導入するためのインストーラです。
Docker Desktop は使用しません。WSL2 の Ubuntu 内へ Docker Engine / Docker Compose Plugin / Git を直接導入します。

ユーザーが実行するコマンド

install.ps1 と install-wsl.sh を BNL リポジトリの main ブランチ直下へ追加した後、PowerShell で次の 1 行だけを実行します。

irm https://raw.githubusercontent.com/bootarou/blockchain-network-launcher/main/install.ps1 | iex

管理者権限でない場合は UAC を表示して自動的に昇格します。

自動で行うこと

Windows / 管理者権限を確認

WSL と Virtual Machine Platform を有効化

初回だけ必要なら Windows を再起動

再起動後にインストーラを自動再開

Ubuntu を WSL2 として導入（未導入の場合）

Ubuntu を root で初期化し、対話式の Linux ユーザー作成を回避

Docker Engine / Docker Compose Plugin / Git を導入

bootarou/blockchain-network-launcher を /opt/bnl へ clone

.env.example から .env を作成（既存 .env は維持）

COMPOSE_BAKE=false docker compose build

docker compose up -d

BNL API の起動を確認

Windows の既定ブラウザで http://localhost:5173 を開く

再実行

同じ 1 行を再度実行して構いません。

既存 .env は上書きしません。

BNL リポジトリにローカル変更がなければ git pull --ff-only します。

ローカル変更がある場合は自動更新をスキップします。

Docker が既に導入済みなら再インストールしません。

BNL の操作

Windows PowerShell から直接操作できます。

起動:

wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose up -d"

停止:

wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose down"

状態確認:

wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose ps"

ログ:

wsl -d Ubuntu -u root -- bash -lc "cd /opt/bnl && docker compose logs -f"

現時点の設計上の注意

この v1 は Ubuntu という WSL ディストリビューションを利用します。既に Ubuntu を使っている PC では、その Ubuntu に Docker Engine と BNL が導入されます。

一般ユーザー向け正式配布では、既存 WSL 環境と完全に分離するために BNL という専用 WSL ディストリビューション（.wsl / import 用 rootfs）を配布する v2 を推奨します。そうすればアンインストールも wsl --unregister BNL で完結し、ユーザーの Ubuntu を一切変更しません。

配布時のセキュリティ推奨

irm ... | iex は導入体験として非常に短い一方、URL 先のスクリプトをそのまま実行します。正式版では次を推奨します。

main ではなくバージョン固定 URL を用意する

install.ps1 をコード署名する

HTTPS の自社ドメイン (https://bnl.nftdrive.net/install.ps1) から配布する

SHA-256 をリリースページへ掲載する

インストールログを %ProgramData%\BNL\ に残す

最終的な表向きコマンドは次の形にできます。

irm https://bnl.nftdrive.net/install.ps1 | iex
