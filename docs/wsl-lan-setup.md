# WSL2 ホストの LAN 公開手順書

Windows + WSL2 環境で Symbol Network Manager を動かしているマシンを**ネットワークのホスト**とし、LAN 内の他端末から Web UI へのアクセスやネットワーク参加（JOIN）をできるようにするための手順書です。

> 💡 ネイティブ Linux ホストの場合、本書の手順は不要です。`.env` の `BIND_ADDRESS=0.0.0.0` とファイアウォール開放（`ufw allow` 等）だけで公開できます。

## 目次

1. [背景 — なぜ WSL2 では追加設定が必要か](#1-背景--なぜ-wsl2-では追加設定が必要か)
2. [公開するポート](#2-公開するポート)
3. [手順 1: BIND_ADDRESS の設定](#3-手順-1-bind_address-の設定)
4. [手順 2: 現状の確認（切り分け）](#4-手順-2-現状の確認切り分け)
5. [手順 3: mirrored モードへの切り替え（推奨）](#5-手順-3-mirrored-モードへの切り替え推奨)
6. [手順 4: ファイアウォールの開放](#6-手順-4-ファイアウォールの開放)
7. [手順 5: コンテナの起動と疎通確認](#7-手順-5-コンテナの起動と疎通確認)
8. [代替手段: portproxy 方式（Windows 10 等）](#8-代替手段-portproxy-方式windows-10-等)
9. [トラブルシューティング](#9-トラブルシューティング)

---

## 1. 背景 — なぜ WSL2 では追加設定が必要か

WSL2 はデフォルトで **NAT（ネットワークアドレス変換）** 配下の仮想ネットワークで動作します。WSL2 内の Docker がポートを `0.0.0.0` にバインドしても、それは **WSL2 仮想マシンの中だけ**の話で、LAN 上の他端末からは Windows ホストの IP 経由で届きません。

### 本書の手順が必要かどうかの早見表

| 構成 | 必要な作業 |
|------|-----------|
| **JOIN する側（参加者）** | 何も不要（外向き接続のみのため） |
| ホスト: **Docker Desktop**（WSL2 バックエンド） | **ファイアウォール開放のみ**（[手順 4](#6-手順-4-ファイアウォールの開放)。GUI でも可） |
| ホスト: **WSL2 内の Docker Engine** | 本書のすべての手順（mirrored または portproxy が必要） |
| ホスト: **ネイティブ Linux** | 本書は不要（`ufw allow` 等の開放のみ） |

> 💡 **Docker Desktop を使っている場合、mirrored / portproxy は不要です。** Docker Desktop は公開ポートを Windows 側で自動的に待ち受けるため、NAT の問題が発生しません。どちらの構成か分からない場合は、[手順 2 の切り分け](#4-手順-2-現状の確認切り分け)で判定できます（`0.0.0.0:5173` が LISTENING なら Docker Desktop 構成の挙動です）。

WSL2 内の Docker Engine 構成で NAT を越える方法は 2 つあります：

| 方式 | 対応環境 | 特徴 |
|------|----------|------|
| **mirrored モード**（推奨） | Windows 11 22H2 以降 + WSL 2.0.0 以降 | WSL が Windows とネットワークインターフェースを共有。設定は一度きりで、IP 変動の影響も受けない |
| **portproxy 方式** | Windows 10 でも可 | Windows 側でポート転送を設定。**WSL の IP が再起動ごとに変わるため、再起動のたびに再設定が必要** |

---

## 2. 公開するポート

| ポート | 用途 | 公開が必要な場面 |
|--------|------|------------------|
| `5173` | Web UI | 他端末から管理画面を開く場合 |
| `4000` | API / WebSocket | 同上（UI とセット） |
| `3000` | Symbol REST Gateway | 他端末が JOIN・同期する場合（**必須**） |
| `7900` | Symbol P2P | 同上（**必須**） |

> ⚠️ Web UI（5173 / 4000）を LAN に公開する場合は、`.env` の `ADMIN_PASSWORD` を必ず設定してください。管理画面からはノードの停止・初期化などすべての操作が可能です。

---

## 3. 手順 1: BIND_ADDRESS の設定

WSL 内のプロジェクトディレクトリで `.env` を編集します（なければ `cp .env.example .env` で作成）：

```bash
# .env
BIND_ADDRESS=0.0.0.0
ADMIN_PASSWORD=your-strong-password
```

コンテナを**再作成**します（`restart` ではポート設定が反映されません。`up -d` が必須）：

```bash
docker compose up -d
```

反映確認：

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep symbol-manager
# 0.0.0.0:5173->5173/tcp と表示されれば OK（127.0.0.1:5173 のままなら .env を再確認）
```

> 💡 再作成されるのは管理 UI（`symbol-manager`）だけです。Symbol ノード本体（api-node 等）は停止しません。

---

## 4. 手順 2: 現状の確認（切り分け）

Windows 側の **PowerShell** で、ポートが Windows まで届いているか確認します：

```powershell
netstat -ano | findstr "5173"
```

- **`0.0.0.0:5173` が LISTENING** → ポートは Windows 側に到達済み。[手順 4（ファイアウォール）](#6-手順-4-ファイアウォールの開放)だけで OK
- **表示されない / `127.0.0.1` のみ** → WSL2 の NAT 内に閉じています。[手順 3（mirrored）](#5-手順-3-mirrored-モードへの切り替え推奨)へ

---

## 5. 手順 3: mirrored モードへの切り替え（推奨）

### 5-1. 要件確認

```powershell
wsl --version
# 「WSL バージョン: 2.0.0」以上であること。古い場合は: wsl --update

[System.Environment]::OSVersion.Version
# ビルド 22621（Windows 11 22H2）以上であること
```

Windows 10 の場合は mirrored は使えません。[portproxy 方式](#8-代替手段-portproxy-方式windows-10-等)へ進んでください。

また、過去に portproxy を設定していた場合は競合を避けるため削除しておきます：

```powershell
netsh interface portproxy reset
```

### 5-2. `.wslconfig` の作成

**Windows のユーザープロファイル直下**（`C:\Users\<ユーザー名>\.wslconfig`）に作成します。エンコーディング事故を防ぐため、PowerShell での作成を推奨します：

```powershell
Set-Content -Path $env:USERPROFILE\.wslconfig -Value "[wsl2]`nnetworkingMode=mirrored" -Encoding ascii
```

> ⚠️ **よくある失敗:**
> - メモ帳で保存すると `.wslconfig.txt` になっていることがある（`Get-ChildItem -Force $env:USERPROFILE | Where-Object Name -like "*wslconfig*"` で確認）
> - UTF-16 で保存されていると読み込まれない
> - 管理者 PowerShell を**別アカウント**で開いていると、別ユーザーのプロファイルに保存される（WSL を起動するユーザーと同じであること）

### 5-3. WSL の完全再起動

**順序が重要**です。Docker Desktop が動いていると `wsl --shutdown` 直後に WSL を自動再起動してしまい、設定が読まれないことがあります：

```powershell
# 1. Docker Desktop を完全終了（タスクトレイ → Quit Docker Desktop）
# 2. WSL を停止
wsl --shutdown
# 3. 停止し切ったことを確認（何も表示されないこと）
wsl --list --running
# 4. 10 秒ほど待ってから WSL を起動
wsl
```

> ⚠️ `wsl --shutdown` で **WSL 内の Docker ごと止まるため、稼働中の Symbol ノードも一旦停止します**。作業タイミングに注意してください。

### 5-4. 反映確認

WSL 内で：

```bash
wslinfo --networking-mode
# → mirrored と出れば成功
```

`nat` のままの場合は、`wsl` 起動直後に表示される警告メッセージを確認してください（フォールバック時は理由が 1 行表示されます。VPN やネットワークアダプタの競合が典型）。解消できない場合は [portproxy 方式](#8-代替手段-portproxy-方式windows-10-等)に切り替えるのが早道です。

---

## 6. 手順 4: ファイアウォールの開放

**管理者権限の PowerShell** で 2 種類のファイアウォールを設定します。

### 6-1. Hyper-V ファイアウォール（mirrored モードでは必須）

mirrored モードでは通常の Windows ファイアウォールとは**別に** Hyper-V ファイアウォールが LAN からの受信を遮断します：

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

> 💡 この GUID は WSL 用仮想マシンの固定 ID です（環境によらず共通）。
>
> 💡 **Windows Home エディションでも実行できます。** 「Hyper-V ファイアウォール」は名前に反して Pro 以上限定の Hyper-V 機能の一部ではなく、Windows Defender ファイアウォールの一部（Windows 11 22H2 で追加）です。WSL2 が動く環境であればエディションを問わず利用できます。

### 6-2. Windows ファイアウォール

```powershell
New-NetFirewallRule -DisplayName "Symbol Network Manager" `
  -Direction Inbound -Protocol TCP -LocalPort 5173,4000,3000,7900 -Action Allow
```

**GUI で設定する場合**（コマンドを使いたくない場合はこちらでも同じことができます）：

1. `Win + R` → `wf.msc` を実行（「セキュリティが強化された Windows Defender ファイアウォール」）
2. 左ペインの **受信の規則** → 右ペインの **新しい規則**
3. **ポート** → **TCP** → 特定のローカルポートに `5173,4000,3000,7900` を入力
4. **接続を許可する** を選択
5. プロファイルは **プライベート** のみにチェック（自宅 / 社内 LAN 向け。パブリックは外す方が安全）
6. 名前（例: `Symbol Network Manager`）を付けて完了

> 💡 プロファイルを「プライベート」のみにした場合、Windows の設定で現在のネットワークが「プライベート ネットワーク」になっているか確認してください（設定 → ネットワークとインターネット → プロパティ）。「パブリック」になっていると規則が適用されません。
>
> ⚠️ 6-1 の Hyper-V ファイアウォール（mirrored モード利用時のみ必要）には GUI がなく、PowerShell コマンドが唯一の設定手段です。

---

## 7. 手順 5: コンテナの起動と疎通確認

### 7-1. コンテナの起動

`wsl --shutdown` でコンテナが止まっているので、WSL 内で起動し直します：

```bash
cd <プロジェクトディレクトリ>
docker compose up -d
docker ps --format '{{.Names}}\t{{.Ports}}'
```

Symbol ノード本体（api-node 等）が停止していた場合は、Web UI の**操作ページ**から **Start** で再起動します。

### 7-2. 疎通確認

詰まった場所を特定できるよう、内側から順に確認します：

```powershell
# ① ホスト機の Windows 上で
curl.exe http://localhost:5173

# ② ホスト機の Windows 上で LAN 側 IP を指定
curl.exe http://<ホストのLAN IP>:5173
```

```bash
# ③ LAN 内の他端末から
curl -s -o /dev/null -w "%{http_code}\n" http://<ホストのLAN IP>:5173
# → 200 が返れば完了
```

他端末のブラウザで `http://<ホストのLAN IP>:5173` を開き、ログイン画面（`ADMIN_PASSWORD` 設定時）が表示されれば公開成功です。JOIN テストでは同様に `:3000`（REST）への到達も確認してください：

```bash
curl http://<ホストのLAN IP>:3000/node/info
```

---

## 8. 代替手段: portproxy 方式（Windows 10 等）

mirrored モードが使えない・動かない場合は、Windows 側でポート転送を設定します。**管理者権限の PowerShell** で：

```powershell
# WSL2 の IP を取得
$wslIp = (wsl hostname -I).Trim().Split()[0]

# 4 ポート分を転送
5173,4000,3000,7900 | ForEach-Object {
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$_ connectaddress=$wslIp connectport=$_
}

# 確認
netsh interface portproxy show all
```

ファイアウォール開放（[手順 4](#6-手順-4-ファイアウォールの開放) の 6-2）も必要です。Hyper-V ファイアウォール（6-1）は portproxy 方式では不要です。

> ⚠️ **WSL2 の IP は Windows 再起動のたびに変わります。** 再起動後は以下で再設定してください：
>
> ```powershell
> netsh interface portproxy reset
> # その後、上の転送設定を再実行
> ```

---

## 9. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `docker ps` で `127.0.0.1:5173->5173` のまま | `.env` の `BIND_ADDRESS` 未設定、または `restart` しか実行していない | `.env` を確認し `docker compose up -d` で**再作成** |
| `wslinfo --networking-mode` が `nat` のまま | `.wslconfig` が読まれていない | ファイル名（`.txt` になっていないか）・エンコーディング・ユーザープロファイルの一致を確認（[5-2](#5-2-wslconfig-の作成)） |
| `.wslconfig` は正しいのに `nat` のまま | Docker Desktop が `wsl --shutdown` 直後に WSL を自動再起動している | Docker Desktop を**先に**完全終了してから `wsl --shutdown`（[5-3](#5-3-wsl-の完全再起動)） |
| mirrored なのに他端末からつながらない | Hyper-V ファイアウォールが受信を遮断 | `Set-NetFirewallHyperVVMSetting` を実行（[6-1](#6-1-hyper-v-ファイアウォールmirrored-モードでは必須)） |
| Windows の `localhost` では開けるが LAN IP では開けない | NAT モードの localhostForwarding は LAN には効かない | mirrored 化（手順 3）または portproxy（手順 8） |
| portproxy 設定後、Windows 再起動でつながらなくなった | WSL2 の IP が変わった | `netsh interface portproxy reset` → 再設定（[手順 8](#8-代替手段-portproxy-方式windows-10-等)） |
| `hostname -I` に `172.x` が混ざる | Docker ブリッジ等のアドレス | 異常ではない。mirrored の判定は `wslinfo --networking-mode` で行う |

---

## 関連ドキュメント

- [MANUAL.md](../MANUAL.md) — セキュリティ（管理画面の認証）、Docker Host Mode、nodeEqualityStrategy
- [backup-restore.md](backup-restore.md) — バックアップ / リストア手順書
