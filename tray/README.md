# BNL Tray — 開発者向け

Windows のタスクトレイに常駐し、WSL2 Ubuntu 内の BNL manager を
**起動 / 停止**するアプリケーション。

設計の根拠は [../draft/windows/BNL_Tray_App_Plan_v1.md](../draft/windows/BNL_Tray_App_Plan_v1.md)、
ライフサイクルの仕様は [../draft/windows/BNL_Windows_WSL_Lifecycle_Spec_v1.md](../draft/windows/BNL_Windows_WSL_Lifecycle_Spec_v1.md) を参照。

## スコープ

**やること**: Start / Stop / 状態監視 / Web UI を開く
**やらないこと**: インストール・アンインストール
（配布物に同梱する `BNL-Setup.bat` / `BNL-Uninstall.bat` をユーザーが手動実行する）

この分離により、アプリは**管理者権限を一切必要としない**。

## ビルド

```powershell
# 開発ビルド（コンソールウィンドウが出る = ログが見える）
go build -o bnl-tray.exe ./cmd/bnl-tray

# 配布ビルド + ZIP 作成
powershell -ExecutionPolicy Bypass -File build\package.ps1 -Version 0.1.0
```

> `-ldflags "-H windowsgui"` を付けないと、常駐アプリなのにコンソールウィンドウが
> 出たままになる。配布ビルドは必ず `build\package.ps1` を使うこと。

```powershell
go test ./...
go vet ./...
```

## パッケージ構成

| パッケージ | 責務 |
|---|---|
| `cmd/bnl-tray` | エントリポイント。単一起動チェックと依存の組み立て |
| `internal/tray` | systray のメニュー構築・状態バインド・アイコン生成 |
| `internal/bnl` | 状態モデル、3層プローブ、Start / Stop の実行 |
| `internal/wsl` | `wsl.exe` 実行ラッパと `wsl -l -v` のパース |
| `internal/probe` | Web UI 到達確認 |
| `internal/config` | 設定と状態キャッシュ（`%LOCALAPPDATA%\BNL`） |
| `internal/logging` | ローテーション付きログ（`tray.log`） |
| `internal/autostart` | `HKCU\...\Run` への登録 |
| `internal/singleton` | 名前付き Mutex による多重起動防止 |
| `internal/winproc` | 子プロセスのコンソール非表示 |
| `internal/winshell` | URL / ファイル / フォルダを既定アプリで開く |
| `internal/notify` | トースト通知 |

## 実装上の要注意点

以下は踏むと**静かに壊れる**ので、変更時は必ず維持すること。

1. **`wsl -l -v` の出力は UTF-16LE。**
   UTF-8 として読むと何もマッチせず、状態が永久に `Unknown` になる。
   → `internal/wsl/list.go` の `decodeConsole`（テストあり）
2. **`wsl.exe` の呼び出しは必ず非表示にする。**
   常駐アプリは 5秒ごとにポーリングするため、抜けると黒い窓が明滅し続ける。
   → `internal/winproc.Hide` を全ての `exec.Cmd` に適用
3. **常時ポーリングで WSL VM を起こさない。**
   Tier 0（`wsl -l -v` + HTTP プローブ）は VM を起こさない。
   `wsl -d Ubuntu -- ...` は**実行するだけで VM が起動する**ため、
   Tier 1 は VM が Running のときのみ、Tier 2 は明示操作時のみ。
   → `internal/bnl/monitor.go`
4. **WSL 内で実行するスクリプトにダブルクォートを使わない。**
   Windows のコマンドライン経由で `wsl.exe` に渡るため、
   シングルクォートのみを使うとエスケープを考えずに済む。
   → `internal/bnl/control.go` の各 `*Script` 定数
5. **メニューの活性制御は `binder.go` の `apply()` に集約する。**
   個別の場当たり的な `Enable()` / `Disable()` を追加しないこと。
   計画書 §5.2 のマトリクスと 1対1 で対応させる。
6. **`Snapshot.State` と `Snapshot.Observed` を混同しない。**
   `State` は表示用（`Starting` / `Error` を含む）、
   `Observed` は環境の観測結果。**メニューの活性は `Observed` に従う**ので、
   エラー表示中でも Start / Stop の可否は実態を反映する。

## 状態の保存先

```text
%LOCALAPPDATA%\BNL\
├─ tray.log             本アプリのログ（.1 .2 .3 にローテーション）
├─ tray-settings.json   設定
├─ tray-state.json      最終確認済みの状態キャッシュ
└─ install.log          BNL-Setup.bat（install.ps1）が出力
```
