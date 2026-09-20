# BNL Tray — 取扱説明書

WSL2 Ubuntu 内で動く BNL manager を、Windows のタスクトレイから
**起動 / 停止**するための常駐アプリです。

> English version: [README.md](README.md)
> 画面表示はすべて英語です。本書では英語のメニュー名に日本語の説明を添えています。

---

## このフォルダの中身

| ファイル | 役割 |
|---|---|
| `bnl-tray.exe` | トレイ常駐アプリ。BNL の起動と停止を行います |
| `BNL-Setup.bat` | BNL のインストール / 更新。**最初にこれを実行します** |
| `BNL-Uninstall.bat` | BNL manager アプリの削除 |
| `README.md` | 英語版の説明書 |
| `README.ja.md` | 本書 |

`bnl-tray.exe` は**インストールもアンインストールも行いません**。
そのぶん管理者権限を一切必要としません。
インストールは `BNL-Setup.bat` をご自身で実行していただく形になります。

---

## 初回セットアップ

### 1. `BNL-Setup.bat` を実行する

ダブルクリックすると最新のインストーラーを取得して実行します。
途中で次の 3点を聞かれます。

| 入力項目 | 内容 |
|---|---|
| ブランチ | インストールするブランチ（5択・通常は `main`） |
| `BIND_ADDRESS` | BNL が待ち受けるアドレス（通常は `127.0.0.1`） |
| 管理者パスワード | BNL Web UI の管理者パスワード |

> **WSL2 / Ubuntu が未導入の場合**
> インストーラーが管理者権限を要求し、PC の再起動を求めることがあります。
> 再起動後にインストールが自動で再開されるので、完了まで待ってください。

### 2. `bnl-tray.exe` を起動する

ダブルクリックすると、通知領域（タスクトレイ）に BNL のアイコンが表示されます。
見当たらない場合は、タスクバーの **「∧」（隠れているインジケーター）** を開いてください。

### 3. アイコンを右クリックして **Start** を選ぶ

起動が完了するとブラウザで Web UI が開きます。

> **常に起動しておきたい場合**
> 右クリック →  **Settings → Start with Windows** をオンにすると、
> サインイン時に自動で常駐します。

---

## メニューの使い方

| メニュー | 動作 |
|---|---|
| **Open BNL** | Web UI をブラウザで開きます（稼働中のみ選択可） |
| **Start** | Ubuntu → Docker → BNL manager の順に起動し、Web UI の応答を待ちます |
| **Stop** | **BNL manager だけ**を停止します。Symbol ノード・Docker・WSL はそのままです |
| **Refresh status** | 今すぐ状態を確認します。WSL が停止中の場合は**WSL を起動します** |
| **View log** | `%LOCALAPPDATA%\BNL\tray.log` を開きます |
| **Open install folder** | このフォルダ（`BNL-Setup.bat` のある場所）を開きます |
| **Quit** | 常駐アプリを終了します。**BNL は動き続けます** |

### アイコンの色と状態

| アイコン | 状態 |
|---|---|
| 緑 | BNL が稼働中 |
| グレー | インストール済みだが停止中 |
| グレー（破線） | BNL が未インストール、または WSL2 Ubuntu が見つからない |
| オレンジの点滅 | 起動処理中 / 停止処理中 |
| 赤 | 直前の操作が失敗（**View log** で確認してください） |

### 状況によって選べない項目があります

メニューは現在の状態に応じて自動で有効・無効が切り替わります。

| 状態 | Open BNL | Start | Stop |
|---|---|---|---|
| 稼働中 | 選択可 | 選択不可 | 選択可 |
| 停止中 | 選択不可 | 選択可 | 選択不可 |
| 未インストール | 選択不可 | 選択不可 | 選択不可 |
| 起動・停止処理中 | 選択不可 | 選択不可 | 選択不可 |

「Start が灰色で押せない」場合は、未インストールか WSL が見つからない状態です。
メニュー先頭の状態表示を確認してください。

### Settings（設定）

| 設定 | 内容 |
|---|---|
| **Start with Windows** | サインイン時に常駐アプリを自動起動します |
| **Wake WSL on startup** | 既定はオフ。下記参照 |
| **Open browser after start** | 起動完了時に Web UI を自動で開きます |

> **Wake WSL on startup について**
> WSL が停止している間は、BNL がインストールされているかどうかを
> **WSL を起動せずに調べることができません**。
> そのため通常は「最後に確認した状態」を表示します
> （例: `BNL — Stopped (checked 12m ago)`）。
> この設定をオンにすると、常駐開始時に WSL を起動して状態を確定しますが、
> サインインのたびに WSL が起動することになります。
> 正確さより軽さを優先して、既定ではオフにしてあります。

---

## 「停止」で止まるもの・止まらないもの

**Stop** は BNL manager のコンテナだけを停止します。
次のものには**一切触れません**。

- Symbol ノードとチェーンデータ
- Docker
- Ubuntu / WSL
- WSL の keepalive プロセス

常駐アプリを **Quit** で終了しても、BNL は動き続けます。

---

## アンインストール

### BNL 本体

`BNL-Uninstall.bat` を実行し、確認プロンプトで `UNINSTALL` と入力します。

- **削除されるもの**: BNL manager アプリ（`/opt/bnl`）
- **残るもの**: `/opt/symbol-target`、Symbol ノードとチェーンデータ、Docker、Ubuntu / WSL

チェーンデータは保持されるため、再度 `BNL-Setup.bat` を実行すれば
ブロック生成は続きから再開されます。

### 常駐アプリ本体

**Quit** で終了してから、このフォルダを削除してください。
**Start with Windows** をオンにしていた場合は、削除する前にオフに戻してください。

---

## 困ったときは

### 「BNL — Not installed」と表示され、Start が押せない

BNL がインストールされていません。
**Open install folder** からフォルダを開いて `BNL-Setup.bat` を実行し、
完了後に **Refresh status** を選んでください。

### 「BNL — WSL2 Ubuntu not found」と表示される

WSL2 と Ubuntu が必要です。PowerShell で確認してください。

```powershell
wsl -l -v
```

`Ubuntu` がバージョン `2` で表示されていればOKです。
表示されない場合は `BNL-Setup.bat` を実行すると導入されます。

### Start に失敗する

**View log** を選んで `tray.log` を確認してください。
実行した手順が 1行ずつ記録されており、BNL manager の起動に失敗した場合は
**コンテナのログ末尾 80 行**も記録されます。

よくある失敗と意味：

| ログ / 通知のメッセージ | 意味 |
|---|---|
| `Ubuntu could not be started.` | WSL の Ubuntu を起動できませんでした |
| `BNL is not installed.` | `/opt/bnl` がありません。Setup が必要です |
| `Docker did not start within 30 seconds.` | Docker が時間内に起動しませんでした |
| `BNL manager could not be started.` | コンテナの起動に失敗（ログ末尾を参照） |
| `BNL started, but the Web UI is not reachable.` | 起動はしたが Web UI に到達できません |

### 起動時に Windows の警告（SmartScreen）が出る

実行ファイルにコード署名がないためです。
**「詳細情報」→「実行」** を選ぶか、事前に
`bnl-tray.exe` を右クリック →  **プロパティ** →  **ブロックの解除** を行ってください。

### アイコンが 2つ表示される

同時に起動できるのは 1つだけで、2つ目は自動的に終了します。
残っているのは古い表示なので、アイコンの上にマウスを乗せると消えます。

---

## ログと設定ファイルの場所

```text
%LOCALAPPDATA%\BNL\
├─ tray.log             本アプリのログ（tray.log.1 〜 .3 に自動ローテーション）
├─ tray-settings.json   Settings の内容
├─ tray-state.json      最後に確認した状態のキャッシュ
└─ install.log          BNL-Setup.bat の実行ログ
```

不具合を報告する際は `tray.log` を添付していただけると調査が早くなります。
