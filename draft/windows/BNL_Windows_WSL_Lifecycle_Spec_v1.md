# BNL Windows / WSL ライフサイクル仕様書

**Setup / Start / Stop / Uninstall・Keepalive・Symbolノード責務分離**  
Document v1.0 / Installer v19 / Lifecycle v4

## 1. 目的
本資料は、Windows上からWSL2 Ubuntu内のBNLを運用するためのライフサイクル仕様を整理したものです。

基本方針は、**BNL ManagerとSymbolノードを分離し、BNLのSetup / Start / Stop / Uninstallが既存のSymbolノードとチェーンデータへ不要な影響を与えないこと**です。

## 2. システム構成

```text
Windows
  └─ BNL操作層（Setup / Start / Stop / Uninstall）
       └─ wsl.exe
            └─ WSL2 Ubuntu
                 ├─ Keepalive process
                 ├─ Docker Engine
                 │    ├─ symbol-manager  ← BNL本体
                 │    └─ Symbolノード群  ← BNLから管理
                 ├─ /opt/bnl             ← BNLアプリケーション
                 └─ /opt/symbol-target   ← Symbolノード/チェーンデータ
```

通常のWeb UI: `http://127.0.0.1:5173`

## 3. 責務分離
- WindowsのLifecycle操作は原則 `symbol-manager` のみを管理する。
- Symbolノードの起動・停止・削除はBNL側へ委ねる。
- `/opt/symbol-target` はBNL本体とは別管理とし、Uninstallでは削除しない。

## 4. Lifecycle

### BNL-Setup
- WSL2 Ubuntu確認
- Branch選択
- BIND_ADDRESS設定
- ADMIN_PASSWORD新規設定または維持/変更
- Docker準備
- `/opt/bnl` fresh cloneまたは更新
- Keepalive確保
- `symbol-manager` 起動
- Web UI確認

### BNL-Start
- Ubuntu起動
- `/opt/bnl`確認
- Keepalive確認/起動
- Docker起動・待機
- `symbol-manager`のみ起動
- Web UI確認後ブラウザ起動
- Symbolノードには触れない

### BNL-Stop
- `symbol-manager`のみ停止
- Symbolノード: 変更なし
- Docker: 変更なし
- WSL: 変更なし
- Keepalive: 変更なし

### BNL-Uninstall
- `symbol-manager`停止・削除
- `/opt/bnl`削除
- `/opt/symbol-target`保持
- Symbolノード保持
- Docker保持
- Ubuntu / WSL保持

## 5. Keepalive
PowerShell/CMDを閉じてもWSL2 Ubuntuを維持するため、専用の通常プロセスを常駐させます。

```bash
exec -a bnl-wsl-keepalive sleep 2147483647
```

Setup / Startは既存Keepaliveを検出し、重複起動を避けます。

## 6. 設定
| 設定 | 仕様 | 再Setup |
|---|---|---|
| Branch | 5ブランチから選択 | 現在値を初期候補に変更可能 |
| BIND_ADDRESS | 標準 `127.0.0.1` | 変更可能 |
| ADMIN_PASSWORD | Web UI管理者パスワード | 維持 / 変更。既存値は表示しない |

## 7. 対応ブランチ
- `main`: 標準 / 公式Catapult
- `feat-custom-catapult`: カスタムCatapult（非PQC）
- `feat-empty-block-policy-cf`: 非PQC + empty-block policy
- `feat-PQC-custom-catapult`: PQC専用
- `feat-empty-block-policy`: PQC + empty-block suppression

## 8. アンインストール後の再構築
Uninstall後にStartを実行すると、`/opt/bnl`がないことを検出してSetupを案内します。Setupを実行するとBNL本体だけを再構築します。

fresh cloneは選択ブランチを明示して取得します。

## 9. Symbolノード非干渉
- StopはSymbolノードを停止しない。
- UninstallはSymbolノードコンテナを削除しない。
- `/opt/symbol-target`を削除しない。
- BNL再Setup後もチェーン状態を保持する。
- 実機では、BNLを停止・削除・再Setupしても既存チェーンからブロック生成が続きから再開した。

## 10. 実機確認済みライフサイクル

`Start → Stop → Start → Stop → Uninstall → Start（/opt/bnl未存在検出） → Setup`

上記シーケンスを実機で確認済み。PowerShellを閉じてもBNLが継続稼働し、BNL再構築後もSymbolノードおよびチェーンデータは維持されました。

## 11. Windows EXE化
BAT群はタスクトレイアプリ `BNL.exe` のバックエンド仕様として利用可能です。

- Open BNL
- Start
- Stop
- Setup / Update
- Status
- Logs
- Uninstall

最終的にはEXEから `wsl.exe` を直接呼び、BATをユーザーから隠蔽できます。

## 12. 設計原則
- BNL ManagerとSymbolノードを分離
- Windows側はBNL Managerのみ制御
- ノード操作はBNLに集約
- 再Setup可能な冪等性
- BNL削除とチェーンデータ削除を分離
- 既存データ保護をデフォルト
- 設定・パスワードは安全に変更可能
- PowerShell/CMDの終了とBNL稼働を分離

## 13. 現行版
- Installer: `install.ps1` / `install-wsl.sh` — v19
- Lifecycle: `BNL-Setup.bat` / `BNL-Start.bat` / `BNL-Stop.bat` / `BNL-Uninstall.bat` — v4
