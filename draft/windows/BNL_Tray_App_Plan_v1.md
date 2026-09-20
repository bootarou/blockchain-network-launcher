# BNL タスクトレイ常駐アプリ 実装計画書

**BNL Tray — Start / Stop 常駐アプリ**
Plan v1.2 / 対象: `BNL-Start.bat` / `BNL-Stop.bat` 相当の処理
関連: [BNL_Windows_WSL_Lifecycle_Spec_v1.md](BNL_Windows_WSL_Lifecycle_Spec_v1.md) §11「Windows EXE化」

## 改訂履歴

| ver | 内容 |
|---|---|
| v1.0 | 初版。Setup / Start / Stop / Uninstall の全ライフサイクルを内蔵する前提 |
| v1.1 | **スコープを Start / Stop のみに縮小。** Setup / Uninstall は配布物に BAT を同梱して手動実行 |
| v1.2 | **技術スタックを Go + systray に確定。** 実装方式は `wsl.exe` 直接呼び出し、UI 言語は英語のみ |

## 確定した方針（v1.2）

| 決定事項 | 選定 | 理由 |
|---|---|---|
| 技術スタック | **Go + `fyne.io/systray`** | 約 8MB の単一 EXE・ランタイム依存ゼロ。Start/Stop だけの UI には systray の `Enable()/Disable()` で十分 |
| 実装方式 | **`wsl.exe` 直接呼び出し** | BAT の `pause` による無限待機が消滅。ステップ単位の進捗を出せる。仕様書 §11 の最終形 |
| UI 言語 | **英語のみ** | 既存 BAT / `install.ps1` の出力と表記を統一。海外ユーザーにもそのまま配布可能 |
| Setup / Uninstall | **内蔵しない** | 配布物に `BNL-Setup.bat` / `BNL-Uninstall.bat` を同梱し、手順書で案内 |

---

## 1. 目的とスコープ

### 1.1 目的
Windows のタスクトレイに常駐し、右クリックメニューから BNL Manager の
**起動 / 停止**と **Web UI を開く**操作を行える単一 EXE を提供する。

### 1.2 スコープ内
- タスクトレイ常駐、右クリックコンテキストメニュー
- BNL の状態検出（未インストール / 停止中 / 起動中 / 稼働中 / 停止処理中）
- 状態に応じた **Start / Stop / Open BNL** の活性・非活性制御
- 実行進捗とログの記録、完了 / 失敗のトースト通知
- Web UI (`http://127.0.0.1:5173`) をブラウザで開く

### 1.3 スコープ外

| 項目 | 代替手段 |
|---|---|
| **インストール / 更新** | 配布物同梱の `BNL-Setup.bat` を手動実行（README で案内） |
| **アンインストール** | 配布物同梱の `BNL-Uninstall.bat` を手動実行 |
| Symbol ノードの起動・停止・削除 | BNL Web UI の責務（仕様書 §3） |
| Docker / Ubuntu / WSL 本体の管理 | 対象外 |
| macOS / Linux 版 | 対象外 |

### 1.4 スコープ縮小による効果

v1.0 で最大のリスクだった 3点が**丸ごと消滅**する。

| v1.0 の課題 | v1.2 での扱い |
|---|---|
| `install.ps1` が完全対話式（ブランチ / パスワード入力）でコンソールを隠せない | **消滅** — Setup を扱わない |
| `install.ps1` が UAC 自己昇格して子プロセスが即 return し、終了コードが信用できない | **消滅** — 昇格を扱わない。アプリは常に非昇格で動作 |
| Uninstall の「UNINSTALL」入力を GUI ダイアログに置換する必要 | **消滅** — BAT のまま手動実行 |
| WSL 停止中に「インストール済みか」が判定できず Uninstall の表示可否が決まらない | **軽減** — Start の可否ヒントに降格（§6.1） |

結果として、常駐アプリは**「状態を監視して 2つの操作を実行する」だけの小さな責務**になる。

---

## 2. 既存資産の分析（設計上の制約）

### 2.1 移植対象の処理

`BNL-Start.bat`（5ステップ）と `BNL-Stop.bat`（1コマンド）を Go に移植する。

**Start**: WSL 起動 → `/opt/bnl` 確認 → keepalive → Docker 起動 + 最大30秒待機
→ `docker compose up -d symbol-manager` → 5173 を最大60秒待機 → ブラウザ起動

**Stop**: `docker compose stop symbol-manager` のみ

`BNL-Start.bat` の**終了コード設計はそのままエラー分類として踏襲**する:

| code | 意味 | 移植後の内部エラー |
|---|---|---|
| 1 | Ubuntu を起動できない | `ErrWslStart` |
| 10 | `/opt/bnl` が無い（**未インストール**） | `ErrNotInstalled` |
| 11 | Docker が 30秒以内に起動しない | `ErrDockerTimeout` |
| 12 | keepalive を起動できない | `ErrKeepalive` |
| 13 | `symbol-manager` を起動できない | `ErrComposeUp` |
| 14 | 起動したが Web UI に到達できない | `ErrWebUnreachable` |

### 2.2 残る技術的制約

1. **`wsl.exe -d Ubuntu -- ...` は実行しただけで停止中の WSL VM を起こす。**
   常駐アプリが素朴に 5秒間隔でこれを叩くと、ユーザーが意図せず
   WSL を常時起動させてしまう → 3層プローブ（§6）で回避。
2. **`wsl.exe -l -v` の出力は UTF-16LE。** Go では
   `golang.org/x/text/encoding/unicode` でデコードする（UTF-8 で読むと必ず失敗する）。
3. **`wsl.exe` の実行でコンソール窓が一瞬開く。**
   `SysProcAttr{HideWindow: true, CreationFlags: CREATE_NO_WINDOW}` で必ず抑止する。
4. **`BIND_ADDRESS` は `127.0.0.1` 以外にもなり得る。**
   `/opt/bnl/.env` から読む（`install.ps1:550` と同じ方法）。

---

## 3. 技術スタック

### 3.1 構成

| 項目 | 選定 | 備考 |
|---|---|---|
| 言語 | **Go 1.22+** | 単一バイナリ・クロスコンパイル・ランタイム依存なし |
| トレイ | **`fyne.io/systray`** | `getlantern/systray` の保守されているフォーク。`Enable()` / `Disable()` / `Hide()` / `Show()` / `SetTitle()` / チェック項目を備える |
| 通知 | `github.com/gen2brain/beeep` | Windows トースト通知。`beeep.Notify(title, msg, icon)` |
| Windows API | `golang.org/x/sys/windows` | 名前付き Mutex（単一起動）、レジストリ（自動起動）、プロセス属性 |
| 文字コード | `golang.org/x/text/encoding/unicode` | `wsl -l -v` の UTF-16LE デコード |
| アイコン | 実行時に .ico を生成（`image/png` 不使用、BMP 形式の ICO を自前で構築） | アイコンは色違いのドット 6種のみ。リポジトリにバイナリを持ち込まずに済む |
| ログ表示 | ログファイル + 既定アプリで開く | GUI ウィンドウは作らない（§8.3） |
| ビルド | `go build -ldflags="-H windowsgui -s -w"` | コンソール窓なし・シンボル削除 |

### 3.2 選定理由

1. **配布サイズと依存ゼロ** — 約 8MB の単一 EXE。ユーザー側に .NET ランタイムや
   WebView2 のような前提条件が一切不要で、ZIP を展開すれば動く。
   Start / Stop だけのアプリに .NET self-contained の 70MB は釣り合わない。
2. **必要な UI が systray の API で過不足なく表現できる。**
   要件の「状況に合わせたボタンの非アクティブ化」は `Disable()` / `Enable()`、
   「状態表示」は `SetTitle()` / `SetTooltip()` / `SetIcon()` で足りる。
3. **外部プロセス制御が Go の得意分野。** `os/exec` + `SysProcAttr` で
   `wsl.exe` の非表示実行・出力ストリーム取得・タイムアウト（`context.WithTimeout`）が素直に書ける。
4. **ビルドが単純。** ソリューションファイルもプロジェクトファイルも不要で、
   `go build` 一発。CI 化も容易。

### 3.3 Go 採用に伴うトレードオフ

| 項目 | 影響 | 対処 |
|---|---|---|
| リッチな GUI が作れない | ログ用のウィンドウを自前で持てない | ログはファイルに出し、メニューから既定アプリで開く（§8.3） |
| モーダルダイアログが無い | 確認ダイアログが作れない | **Start / Stop に破壊的操作は無い**ため不要。Uninstall を扱わない構成だから成立する |
| Go 未導入 | 開発環境の準備が必要 | `winget install GoLang.Go` |

---

## 4. アーキテクチャ

### 4.1 パッケージ構成

```text
tray/
├─ go.mod                        module github.com/bootarou/bnl-tray
├─ cmd/bnl-tray/
│   └─ main.go                   単一起動チェック → systray.Run()
├─ internal/
│   ├─ tray/
│   │   ├─ app.go                App 本体・クリックハンドラ・アイコン明滅
│   │   ├─ menu.go               メニュー構築
│   │   ├─ binder.go             状態 → 各項目の Enable/Disable を適用
│   │   └─ icons.go              .ico の実行時生成
│   ├─ bnl/
│   │   ├─ state.go              State 列挙 + Snapshot 構造体
│   │   ├─ monitor.go            3層プローブ・ポーリングループ
│   │   ├─ control.go            Start / Stop の実行と進捗発行
│   │   └─ errors.go             ErrNotInstalled 等の分類
│   ├─ wsl/
│   │   ├─ runner.go             wsl.exe 実行ラッパ（非表示・タイムアウト）
│   │   └─ list.go               wsl -l -v の UTF-16LE パース
│   ├─ probe/http.go             5173 到達確認
│   ├─ config/config.go          tray-settings.json / tray-state.json
│   ├─ logging/logger.go         %LOCALAPPDATA%\BNL\tray.log（ローテーション）
│   ├─ autostart/               HKCU\...\Run
│   ├─ singleton/               名前付き Mutex による多重起動防止
│   ├─ winproc/                 子プロセスのコンソール非表示
│   ├─ winshell/                URL / ファイル / フォルダを既定アプリで開く
│   └─ notify/                  トースト通知
└─ build/
    ├─ package.ps1               EXE ビルド + 配布 ZIP の組み立て
    └─ dist-README.md            配布物に同梱するユーザー向け手順書
```

### 4.2 配布物の構成

```text
BNL-Tray-x.y.z.zip
├─ bnl-tray.exe           ← 常駐アプリ（Start / Stop）
├─ BNL-Setup.bat          ← インストール / 更新（手動実行）
├─ BNL-Uninstall.bat      ← アンインストール（手動実行）
└─ README.md              ← 導入手順。「初回は BNL-Setup.bat を実行」を明記
```

トレイアプリは Setup / Uninstall を**実行しない**が、
メニューの **Open install folder** でエクスプローラを開き、
ユーザーが BAT に辿り着けるようにする（実行はユーザーの明示操作）。

---

## 5. 状態モデル

### 5.1 状態列挙

| 状態 | 意味 | 判定条件 |
|---|---|---|
| `Unknown` | 起動直後・未プローブ | 初期値 |
| `WslMissing` | WSL2 / Ubuntu が無い | `wsl -l -v` に Ubuntu 無し、または VERSION≠2 |
| `NotInstalled` | Ubuntu はあるが `/opt/bnl` 無し | `test -d /opt/bnl` 失敗、または Start が `ErrNotInstalled` |
| `Stopped` | インストール済み・未稼働 | `/opt/bnl` あり & `symbol-manager` 非 running |
| `Starting` | Start 実行中 | アプリ内遷移フラグ |
| `Running` | 稼働中 | `symbol-manager` running かつ／または 5173 応答 |
| `Stopping` | Stop 実行中 | アプリ内遷移フラグ |
| `Error` | 直近操作が失敗 | エラー分類あり |

`Starting` / `Stopping` / `Error` は**アプリが持つ遷移状態**、
それ以外は**外部環境から観測する状態**。両者を明確に分ける。

### 5.2 メニュー活性マトリクス（要件の中核）

| 状態 | Open BNL | Start | Stop | Refresh | View log | Open install folder | Quit |
|---|---|---|---|---|---|---|---|
| `Unknown` | 無効 | **有効** | 無効 | 有効 | 有効 | 有効 | 有効 |
| `WslMissing` | 無効 | **無効** | 無効 | 有効 | 有効 | 有効 | 有効 |
| `NotInstalled` | 無効 | **無効** | 無効 | 有効 | 有効 | 有効 | 有効 |
| `Stopped` | 無効 | **有効** | 無効 | 有効 | 有効 | 有効 | 有効 |
| `Starting` | 無効 | 無効 | 無効 | 無効 | 有効 | 有効 | 有効 |
| `Running` | **有効** | 無効 | **有効** | 有効 | 有効 | 有効 | 有効 |
| `Stopping` | 無効 | 無効 | 無効 | 無効 | 有効 | 有効 | 有効 |
| `Error` | 状況依存 | 有効 | 状況依存 | 有効 | 有効 | 有効 | 有効 |

**設計ルール**

- `WslMissing` / `NotInstalled` では Start を**無効**にし、ヘッダを
  `BNL — Not installed` にして **Open install folder** へ誘導する
  （Setup を代行しないので、案内で完結させる）。
- `Unknown`（WSL 停止中で未確定）では Start を**有効**にする。
  押せば Tier 2 プローブが走って状態が確定するため、ここで塞ぐと詰む。
- 遷移中（`Starting` / `Stopping`）は Start / Stop / Refresh を全無効化し、
  二重実行を構造的に防ぐ。
- 状態が変わるたびに `binder.Apply(state)` で全項目を再評価する
  （個別の場当たり的な切り替えを禁止し、マトリクスを単一の真実にする）。

### 5.3 状態遷移

```text
Unknown ──probe──> WslMissing   （Start 無効・案内表示）
        ──probe──> NotInstalled （Start 無効・案内表示）
        ──probe──> Stopped ──Start──> Starting ──> Running
                                            └(失敗)> Error
                   Running ──Stop──> Stopping ──> Stopped

※ BNL-Setup.bat / BNL-Uninstall.bat をユーザーが手動実行した結果は、
   次回ポーリングで NotInstalled ⇄ Stopped として自動的に反映される。
```

---

## 6. 状態検出の実装（3層プローブ）

**設計目標**: 常駐中に WSL VM を勝手に起こさない。

### Tier 0 — 常時（5秒間隔、VM を起こさない）

1. `wsl.exe -l -v` → Ubuntu の有無 / VERSION / STATE
   ※ 出力は **UTF-16LE**。`unicode.UTF16(unicode.LittleEndian, unicode.UseBOM)` でデコード
2. `HTTP GET http://<bind>:5173`（タイムアウト 1.5秒）→ 到達すれば `Running` 確定

Ubuntu が `Stopped` なら、それ以上踏み込まない。

### Tier 1 — Ubuntu が Running のときのみ（10秒間隔）

`wsl.exe` の呼び出しを**1回にまとめて**取得する（プロセス起動コストの削減）:

```bash
wsl.exe -d Ubuntu -u root -- bash -lc '
  printf "bnl=%s\n"     "$([ -d /opt/bnl ] && echo 1 || echo 0)"
  printf "docker=%s\n"  "$(docker info >/dev/null 2>&1 && echo 1 || echo 0)"
  printf "manager=%s\n" "$(docker ps --filter name=symbol-manager --format "{{.State}}" 2>/dev/null | head -1)"
'
```

### Tier 2 — 明示操作時のみ（VM の起動を許容）

Start 実行時、およびメニューの **Refresh status** 選択時。

### 6.1 「WSL 停止中はインストール有無が分からない」問題

Ubuntu が `Stopped` の間、`/opt/bnl` の有無は VM を起こさないと判定できない。

v1.0 では Uninstall の**表示可否**を決める必須情報だったが、
v1.2 では **Start の可否ヒント**に降格したため、扱いが軽くなった。

**方針**

- `%LOCALAPPDATA%\BNL\tray-state.json` に最終確認済み状態をキャッシュし、
  ヘッダ表示（`BNL — Stopped (checked 12m ago)`）に使う。
- キャッシュが無い / 古い場合は `Unknown` とし、**Start は有効のまま**にする。
  押した時点で Tier 2 プローブ → 未インストールなら案内を出す。
- 設定に **Wake WSL on startup** を用意（既定 **オフ**）。

---

## 7. アクション実行設計

### 7.1 共通方針

| 項目 | 方針 |
|---|---|
| 二重実行防止 | 実行中は `Starting` / `Stopping` にして Start / Stop / Refresh を無効化 |
| コンソール抑止 | 全ての `wsl.exe` 呼び出しで `HideWindow: true` + `CREATE_NO_WINDOW` |
| 出力の取得 | `StdoutPipe` を `bufio.Scanner` で逐次読み、ログファイルへ追記 |
| タイムアウト | `context.WithTimeout`（Start 180秒 / Stop 60秒 / プローブ 10秒） |
| 結果通知 | 成功 / 失敗をトースト通知。失敗時は通知本文に次のアクションを書く |
| 並行制御 | 状態は 1本の goroutine が所有し、操作要求は channel 経由（データ競合を構造的に排除） |

### 7.2 Start（`wsl.exe` 直接呼び出し）

BAT の 5ステップをそのまま進捗として提示する。進捗はツールチップとログに出す。

```text
[1/5] Starting Ubuntu...
[2/5] Checking BNL installation...
[3/5] Starting WSL keepalive...
[4/5] Starting Docker...          (最大30秒ポーリング)
[5/5] Starting BNL manager...
      Waiting for Web UI...       (最大60秒ポーリング)
```

失敗時のメッセージと誘導:

| エラー | 通知メッセージ | 誘導 |
|---|---|---|
| 成功 | `BNL is running.` | ブラウザを開く（設定で切替） |
| `ErrNotInstalled` | `BNL is not installed. Run BNL-Setup.bat first.` | **Open install folder** を案内 |
| `ErrDockerTimeout` | `Docker did not start within 30 seconds.` | 再試行 / ログ表示 |
| `ErrKeepalive` | `WSL keepalive could not be started.` | ログ表示 |
| `ErrComposeUp` | `BNL manager could not be started.` | `docker compose logs --tail 80` を自動取得してログに記録 |
| `ErrWebUnreachable` | `BNL started, but the Web UI is not reachable.` | URL 手動確認 / ログ表示 |
| `ErrWslStart` | `Ubuntu could not be started.` | WSL の状態確認を案内 |

ブラウザの自動起動はアプリ側で制御し、設定 **Open browser after start** でオフにできる。

### 7.3 Stop

- 実行内容は `docker compose stop symbol-manager` のみ。
- 成功後は即 Tier 1 プローブで `Stopped` を確定。
- 仕様書 §4 のとおり **Symbol ノード・Docker・WSL・keepalive には触れない**ことを
  通知文に明記する（「全部止まった」という誤解を防ぐ）。
  例: `BNL manager stopped. Symbol nodes, Docker and WSL are still running.`

---

## 8. UI 仕様

### 8.1 トレイメニュー構成（英語）

```text
┌──────────────────────────────┐
│ BNL — Running                 │  ヘッダ: 状態テキスト (Disabled)
├──────────────────────────────┤
│ Open BNL                      │  Running のみ有効
├──────────────────────────────┤
│ Start                         │
│ Stop                          │
├──────────────────────────────┤
│ Refresh status                │
│ View log                      │
│ Open install folder           │  Setup / Uninstall の BAT へ誘導
│ Settings ▸                    │
│   ☑ Start with Windows        │
│   ☐ Wake WSL on startup       │
│   ☑ Open browser after start  │
├──────────────────────────────┤
│ Quit                          │
└──────────────────────────────┘
```

- ヘッダは systray の先頭項目を `Disable()` して状態表示に使う。
- ツールチップ（**64文字制限**に注意）: `BNL — Running / 127.0.0.1:5173`
- 状態別ヘッダ: `Running` / `Stopped` / `Starting...` / `Stopping...` /
  `Not installed` / `WSL not found` / `Error — see log`

### 8.2 アイコンによる状態表現

| 状態 | アイコン |
|---|---|
| `Running` | 緑（実線） |
| `Stopped` | グレー |
| `NotInstalled` / `WslMissing` | グレー + 破線 |
| `Starting` / `Stopping` | 明滅（2フレーム交互、500ms） |
| `Error` | 赤バッジ |

ライト / ダーク両方のタスクバーで視認できるよう、16 / 20 / 24 / 32 / 48px を 1つの `.ico` に格納し、
`//go:embed` でバイナリに埋め込む。

### 8.3 ログ

Go ではリッチなログウィンドウを持たないため、**ファイル + 既定アプリ**で代替する。

- 出力先: `%LOCALAPPDATA%\BNL\tray.log`（ローテーション: 1MB × 3世代）
- 形式: `2026-09-20 11:24:03 [INFO] [2/5] Checking BNL installation...`
- **View log** メニューで既定のテキストエディタで開く
- `install.log`（Setup が出力）と同じディレクトリに置き、調査時に揃って見られるようにする

---

## 9. 配布とビルド

| 項目 | 内容 |
|---|---|
| ビルド | `go build -ldflags="-H windowsgui -s -w" -o bnl-tray.exe ./cmd/bnl-tray` |
| `-H windowsgui` | **必須**。付けないと常駐アプリなのにコンソール窓が出続ける |
| サイズ見込み | 約 8MB（UPX 圧縮でさらに縮むが、AV 誤検知を招くため**非推奨**） |
| 配布形式 | ZIP（EXE + BAT 2本 + README）。インストーラは当面不要 |
| 権限 | 昇格不要（Setup を扱わないため） |
| 単一起動 | `CreateMutexW("Global\\BnlTray")` → `ERROR_ALREADY_EXISTS` なら終了 |
| 署名 | 未署名だと SmartScreen 警告が出る（既存 `build/windows/README.md` でも言及済み）。当面は README で回避方法を案内 |

---

## 10. 実装フェーズ

| Phase | 内容 | 成果物 | 目安 |
|---|---|---|---|
| **P0** | Go プロジェクト雛形・systray 常駐・固定メニュー・単一起動・ログ基盤 | 起動して常駐し、Quit できる EXE | 0.5日 |
| **P1** | `wsl` パッケージ（UTF-16 パース / 非表示実行）+ 3層プローブ + 状態モデル + 活性制御 | **要件の中核**（Start / Stop の非活性制御） | 1.5日 |
| **P2** | Start（5ステップ移植）/ Stop の実装、進捗表示、エラー分類、トースト通知 | 日常運用が可能な状態 | 1.5日 |
| **P3** | アイコン一式・設定永続化・自動起動・ZIP 配布物の組み立て・README | 配布可能なパッケージ | 1日 |

**合計 約 4.5日**

---

## 11. リスク

| # | リスク | 影響 | 対策 |
|---|---|---|---|
| R1 | 常駐ポーリングが WSL VM を常時起動させる | ユーザーのメモリを常時消費 | 3層プローブ（§6）。Tier 0 は VM を起こさない |
| R2 | `wsl -l -v` を UTF-8 で読んで文字化け | 状態が常に `Unknown` になる | UTF-16LE でデコード。**実装時の必須チェック項目** |
| R3 | `wsl.exe` 実行時にコンソール窓が明滅する | 常駐アプリとして品質が低く見える | 全呼び出しで `HideWindow` + `CREATE_NO_WINDOW` |
| R4 | `-H windowsgui` の付け忘れ | コンソール窓が出続ける | ビルドスクリプトに固定。手動 `go build` を禁止 |
| R5 | `BIND_ADDRESS` が `127.0.0.1` 以外だと URL が変わる | **Open BNL** が機能しない | `/opt/bnl/.env` から読んでキャッシュ（`install.ps1:550` と同じ方法） |
| R6 | 未署名 EXE の SmartScreen 警告 | 導入障壁 | README で回避方法を案内。コード署名は別途検討 |
| R7 | ユーザーが Setup を実行せずにトレイアプリを起動する | 「起動できない」と誤解される | `NotInstalled` 時にヘッダで明示 + **Open install folder** で誘導（§5.2） |
| R8 | ユーザーが手動で Uninstall.bat を実行しても気付けない | 状態表示がずれる | ポーリングで `NotInstalled` を検出して自動反映（§5.3） |
| R9 | systray がヘッダ項目のクリックを無効化できない環境差 | 誤操作 | `Disable()` 済み項目のクリックは無視する実装にする |

---

## 12. 次のアクション

1. Go ツールチェーンの導入（`winget install GoLang.Go`）
2. P0（雛形 + 常駐）と P1（状態検出 + メニュー活性制御）を実装し、
   §5.2 のマトリクスを実機で検証する
3. P2（Start / Stop の移植）を実装し、仕様書 §10 のライフサイクル
   `Start → Stop → Start → Stop` をトレイアプリから再現できることを確認する
4. 配布物（EXE + `BNL-Setup.bat` + `BNL-Uninstall.bat` + README）を組み立て、
   「初回は Setup を実行する」導線を README に明記する
