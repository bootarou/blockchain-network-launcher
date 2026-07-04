# 障害レポート: JOIN ノードがエポック2到達後にクラッシュループする問題

- **発生日**: 2026-07-04
- **影響**: 共有インポートで参加した JOIN ノード(api-node-0)が起動不能(起動後数秒でクラッシュを繰り返す)
- **結論**: 操作手順のミスではなく、**インポート時に生成される `proof.index.dat` がエポック1固定**であることに起因する catapult のエッジケース。恒久修正済み(`buildProofIndexFromSource`)

---

## 1. 症状

Currency Mosaic と Harvest Mosaic を分離したカスタムネットワークをホスト機(192.168.0.20)で作成し、その共有データ(share zip)を本機にインポートして Start したところ:

- 参加直後は正常に動作(約11分間、ブロック 78 まで同期)
- 05:26(UTC)以降、起動するたびに **catapult.server が数秒で Segmentation fault**
- `catapult.recovery` も同様にセグフォ → 自動リカバリも機能せず
- ダッシュボードは「Node Offline」、コンテナは `api-node-0 Exited (1)` / `(253)`

## 2. タイムライン(UTC)

| 時刻 | 出来事 |
|---|---|
| 05:15 | share インポート → Start。正常起動、ホストから同期開始 |
| 05:15〜05:26 | 正常稼働(ブロック 1→78 同期) |
| 05:26:06 | **ホストがエポック2をファイナライズした直後**、稼働中に初回セグフォ |
| 05:26〜 | 以後、起動のたびに数秒でセグフォ(restart ポリシーの再試行もすべて失敗) |

## 3. 調査過程(切り分けの記録)

1. **statedb 破損を疑う** — gdb バックトレースで RocksDB のメモリテーブル読み込み中のセグフォを確認。しかし seed から完全リセットした「高さ1」のデータでも同一箇所でクラッシュ → **statedb 破損は二次被害であり原因ではない**
2. **保持ファイル(voting 等)を疑う** — 純粋な seed のみでもクラッシュ → 無関係
3. **enableVoting=false** → 変化なし
4. **公式イメージ(symbolplatform/symbol-server:gcc-1.0.3.6)で同一データを起動** → セグフォではなく、きれいな例外で停止:
   ```
   FileProofStorage.cpp(88): loadProof called with epoch 0
   ```
5. **CPU 1コア固定(`--cpuset-cpus=0`)でパッチ版を起動** → セグフォが消え、公式と同じ「loadProof called with epoch 0」で abort(3/3 再現)
   - → パッチ版のセグフォは「マルチコア環境で例外発生時に落ちる」二次症状と確定
6. **abort 時のバックトレース**で呼び出し元を特定:
   ```
   ChainSynchronizer(ブロック同期)
   → CompareChains
   → localFinalizedHeightSupplier (FinalizationBootstrapperService.cpp:184)
   → ProofStorage.loadProof(statistics.epoch - 1)   ← epoch 1 - 1 = 0 で即死
   ```

## 4. 根本原因

- 共有インポートで作られる `data/proof.index.dat`(ファイナライズ統計、48バイト)は **nemesis 時点=エポック1固定**だった(share zip 内の静的ファイル、または `buildProofIndexDat()` の固定値)
- このノードの設定は `unfinalizedBlocksDuration = 0m`。このとき catapult はブロック同期のたびに「1つ前のエポックの proof」を読む:
  `loadProof(statistics.epoch - 1)` = `loadProof(0)` → 例外
- **ネットワーク全体がまだエポック1の間はこのコードパスに入らない**ため、参加直後は正常動作する。ネットワークがエポック2をファイナライズした瞬間から、起動のたびに即死する
- パッチ版バイナリ(symbol-server-patched:gcc-1.0.3.9)ではこの例外がマルチコア環境で **Segmentation fault に化ける**ため、原因の特定が困難だった(RocksDB 内部のクラッシュに見える)

## 5. 修正内容

### 5-1. 恒久修正(backend/server.ts)

`buildProofIndexFromSource(sourceNodeUrl, nemesisEntityHash)` を新設:

- join / import 時に、参加元ノードの `/chain/info` から **現在の** `latestFinalizedBlock`(エポック・ポイント・高さ・ハッシュ)を取得して `proof.index.dat` を合成する
- エポック≥2 なら `loadProof(epoch - 1)` はローカルに存在する nemesis proof(00001.proof)に解決するため安全
- 参加元がまだエポック1、または到達不能の場合は従来値にフォールバックし警告ログを出す
- 適用箇所: `installImportedSeed`(Share の共有インポート / seed 単体アップロード)と `fetchAndBuildNemesisSeed`(Join Network)の全4書き込み経路

### 5-2. 実ノードの復旧手順(実施済み)

1. `nodes/api-node-0/seed/proof.index.dat` をホストの現ファイナライズ統計(エポック2)で書き換え
2. クラッシュ復旧機能(`crashRecovery` + `resetData`)でデータを seed にリセット(鍵・証明書・投票鍵は保持、破損データは `crash-backups/` に退避)
3. 起動 → 即座に全ブロック再同期、ファイナライズも正常進行を確認

## 6. 検証結果

- 高さ 446+ でホストとリアルタイム同期(3分以上、ブロックごとに一致)
- ファイナライズ高さ 428(エポック2)まで進行、proof 取り込み正常
- 21分以上の安定稼働を確認(従来は数秒で死亡)

## 7. 教訓・残課題

- **教訓1**: JOIN ノードの `proof.index.dat` は「参加時点のネットワークの現在値」で作る必要がある。nemesis 時点の値は、ネットワークがエポック2に達した瞬間に時限爆弾になる
- **教訓2**: 「参加直後は動いていたのに後から起動不能になる」パターンは、時刻・エポック・ネットワーク状態など**外部状態の進行**を疑う
- **教訓3**: セグフォが再現する場合、`--cpuset-cpus=0`(1コア固定)で実行すると競合系の症状が剥がれて本当のエラーが見えることがある
- **教訓4**: catapult のテスト起動はデータを汚染する(statedb に nemesis がコミットされる)ため、試行のたびに seed から作り直すこと
- **残課題**: パッチ版バイナリ(gcc-1.0.3.9)の「マルチコア環境で起動時例外がセグフォに化ける」問題。今回の修正で例外自体が出なくなったため実害は無いが、パッチのビルド環境で `FinalizationBootstrapperService` 経由の例外処理を確認する価値がある

## 関連

- 同日午前の別障害: Windows 不意シャットダウンによる 0 バイトファイル破損(こちらは crashDiagnose / crashRecovery 機能として対策済み)
- クラッシュ復旧機能: 操作ページ「クラッシュ診断・復旧」ボタン、および Start 時の自動診断フック
