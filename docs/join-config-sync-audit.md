# 棚卸し: Join 参加ノードに同期されない設定

- **調査日**: 2026-08-17
- **きっかけ**: Join で参加したノードが必ず高さ 5401 で同期停止し、`importance_block_mismatch` を出す不具合。原因は `config-inflation.properties` が参加元と食い違っていたこと（詳細は後述）
- **目的**: 「参加元と一致していないと同期が止まる設定」のうち、REST から取得できずツールもコピーしていないものを網羅的に洗い出す
- **結論**: 合意に影響し REST で取得できない設定は `config-inflation.properties` と `config-finalization.properties` の 2 つ。**いずれも対応済み**。他は REST でカバー済みか、ノードローカルで影響なし
- **更新**: 2026-08-18 に `config-finalization.properties` へ対応（当初は残存リスクとして記載していた）

---

## 1. 問題の構図

symbol-bootstrap はプリセット（`bootstrap` / `testnet` / `mainnet` + カスタムプリセット）から各種 config ファイルを生成します。参加ノードが**参加元と違うプリセットを使うと、生成される値が食い違います**。

チェーンパラメータの大半は REST の `/network/properties` で参加元から取得できるため、ツールはこれを Join 時にコピーしています。**問題は、このエンドポイントに出てこない設定です。** 食い違ったまま起動しても最初は正常に同期するため、差が実際に影響する高さに到達して初めて停止します。

今回の事例では、参加元が testnet プリセット既定のインフレーションカーブ（高さ 5760 から報酬発生）を使っていたのに対し、参加ノードはゼロインフレでした。5759 までは両者とも報酬 0 で一致するため正常に同期し、**報酬が初めて発生する 5760 の importance ブロックで残高計算が食い違って停止**しました。同期は 360 ブロック単位のバッチなので、5760 を含むバッチ（5402〜5761）ごと破棄され、直前のバッチ境界である 5401 に留まり続けた、という挙動です。

---

## 2. 調査方法

1. 稼働中ノードが生成する config ファイルを全列挙（`nodes/api-node-0/server-config/resources/`）
2. `config-network.properties` の全キーを、参加元の `/network/properties` の返却内容と機械的に突き合わせ
3. ツールが Join 時に実際に書き込む対象を `backend/server.ts` から特定
4. 各ファイルを「合意（ブロック検証）に影響するか」で分類

再現用のコマンドは末尾に記載しています。

---

## 3. サマリ

生成される 17 ファイル + peers 2 ファイルの分類です。

| ファイル | 合意影響 | REST 公開 | ツールがコピー | 判定 |
|---|---|---|---|---|
| `config-network.properties` | **あり** | ✅ 74/75 キー | ✅ | 安全 |
| `config-inflation.properties` | **あり** | ❌ | ✅ | 対応済み |
| `config-finalization.properties` | 一部あり | ❌ | ✅ | 対応済み |
| `peers-p2p.json` / `peers-api.json` | なし（接続性） | ✅ `/node/peers` | ✅ | 安全 |
| `config-harvesting.properties` | なし | — | — | 影響なし |
| `config-node.properties` | なし | — | — | 影響なし |
| `config-database.properties` | なし | — | — | 影響なし |
| `config-task.properties` | なし | — | — | 影響なし |
| `config-user.properties` | なし | — | — | 影響なし |
| `config-messaging.properties` | なし | — | — | 影響なし |
| `config-pt.properties` | なし | — | — | 影響なし |
| `config-timesync.properties` | なし | — | — | 影響なし |
| `config-extensions-*.properties` | なし | — | — | 影響なし |
| `config-logging-*.properties` | なし | — | — | 影響なし |

---

## 4. 詳細

### 4-1. `config-network.properties` — 安全

チェーンパラメータ・プラグイン設定・fork heights が入る、**合意上もっとも重要なファイル**です。

実測で **75 キー中 74 キーが `/network/properties` でカバー**されていました。残る 1 つは `uniqueAggregateTransactionHash` ですが、これは catapult 1.0.3.9 で追加されたキーで、比較に使った参加元が 1.0.3.7 だったため返ってこなかっただけです。**バージョンを揃えれば完全一致**します。

ツール側は `fetchAndWritePeerFiles()` が `network` / `chain` / `plugins` / `forkHeights` の全項目を参加元の値で書き込みます（`backend/server.ts` の `srcForkHeights` 周辺）。書き込み先はノードの `server-config` / `broker-config` と `gateways/*/api-node-config` です。

> **注意**: この関数は full モード起動でしか呼ばれず、かつ `sourceNodeUrl` が設定されている場合のみ実行されます。参加元の `/node/info` 取得に失敗すると early return し、ピアファイルと fork_heights が更新されません（`/node/peers` と `/network/properties` には `.catch()` があるため、早期リターンの引き金は `/node/info` だけです）。
>
> **2026-08-18 に以下を修正しました。**
> - 到達失敗時に何が反映されていないかを ❌ 付きで明示するようにした（従来は警告 1 行のみ）
> - **ピアが 1 件も設定されていない場合は Start を失敗させる**ようにした。catapult は knownPeers への発信接続でしかブロックを引かないため、ピア 0 のノードは起動しても永久に同期しない。この検証は try/catch の**外**に置いてある（内側だと「non-fatal」として握り潰される）
> - ただし自分でネットワークを作ったノードはピア 0 が正常なので、`sourceNodeUrl` か `peerNodeUrls` が設定されている場合に限って適用する
> - インフレーション適用をこの関数から切り出し、`patchInflationConfig()` として**無条件に実行**するようにした（下記参照）

### 4-2. `config-inflation.properties` — 対応済み（今回の不具合）

ブロック報酬のスケジュールです。**`/network/properties` には一切含まれません。**

対象がカスタムネットワークの場合、ツールは `.ui-meta.json` の `inflation` から生成し、未設定なら `starting-at-height-2 = 0`（ゼロインフレ）にフォールバックします。参加元が別のスケジュールを使っていると、報酬が発生する最初の高さで停止します。

2026-08-17 に以下を実装して対応済みです（コミット `552a9c5`）。

- `GET /api/inflation-presets` — 同梱 symbol-bootstrap の `presets/*/network.yml` を実行時に読み、「ゼロインフレ（bootstrap 既定, 2 件）」と「Symbol 標準カーブ（testnet / mainnet, 423 件）」を返す。testnet と mainnet はバイト単位で同一
- Configuration → Inflation にプリセット投入ボタンと `config-inflation.properties` のインポートを追加
- Join 時にチェーンのインフレ receipt（`0x5143`）をサンプリングし、既知カーブと**照合**して自動投入

自動検出を「復元」ではなく「照合」にしているのは意図的です。receipt から観測できるのは現在の高さまでの段差だけなので、観測した段差だけを入れると**未到達の次の段差で同じ症状が再発**します。照合して一致したらカーブ全体を採用することで、将来分も含めて正しくなります。

判定不能・到達不能・複数一致の場合は投入せず、Join 画面に警告を出します。また `statements` が 0 件の応答は「インフレ無し」ではなく「データ欠落」として扱います（全ブロックが必ずハーベスト手数料 receipt `0x2143` を持つことをネメシス含め実測確認済み）。プルーニングされたノードを参照した際の誤判定防止です。

**追加修正（2026-08-18）**: 当初、生成処理が `fetchAndWritePeerFiles()` の内部に置かれていました。設定の出どころは `.ui-meta.json`（ローカルファイル）なのに、適用が**参加元への到達性に依存**する状態で、参加元が落ちていると正しく設定したスケジュールが黙って無視されていました。`patchInflationConfig()` として切り出し、Step 4c2b で無条件に実行するよう修正しています。

### 4-3. `config-finalization.properties` — 対応済み

**`/network/properties` に含まれません。** インフレーションと並ぶ、もう一つの穴でした。

プリセット間で値が違う項目は以下です。

| キー | shared 既定 | testnet | mainnet |
|---|---|---|---|
| `treasuryReissuanceEpoch` | 0 | 0 | **481** |
| `[treasury_reissuance_epoch_ineligible_voter_addresses]` | 空 | 空 | **内容あり** |

一方、合意に効く主要パラメータは `presets/shared.yml` 由来で**全プリセット共通**でした。

| キー | 値 |
|---|---|
| `finalizationSize` | 10000 |
| `finalizationThreshold` | 6700 |
| `maxHashesPerPoint` | 256 |
| `prevoteBlocksMultiple` | 4 |

`votingSetGrouping` もプリセット間で異なります（shared 180 / testnet 720 / mainnet 1440）が、これは `config-network.properties` の `[chain]` に入るため **REST 公開済み・コピー済みで対象外**です。

**実用上のリスクは中〜低**と評価します。顕在化するのは次の 2 パターンに限られます。

1. **mainnet プリセット由来のカスタムネットワークに、bootstrap プリセットで参加する場合** — `treasuryReissuanceEpoch` が 481 と 0 でズレます。影響は該当エポック周辺に限定されます
2. **ネットワーク管理者がカスタムプリセットで `finalizationSize` / `finalizationThreshold` などを上書きしている場合** — 参加ノード側は既定値のままになり、ファイナライズの成立判定が食い違います

インフレーションと違い、**receipt に相当する観測手段が無いため自動検出はできません。** そのため「プリセット選択 + ファイル取込」で対応しました。

**実装（2026-08-18）**

- `GET /api/finalization-presets` — 同梱 symbol-bootstrap の `shared.yml` に各ネットワークプリセットを重ねて読み、「bootstrap / testnet 既定」と「mainnet（treasuryReissuanceEpoch 481 + 除外投票者 62 件）」の 2 つを返す
- Configuration → 投票・ファイナリティ にプリセット投入ボタンと `config-finalization.properties` のインポートを追加。ファイル側の `size` / `threshold` はプリセットキー `finalizationSize` / `finalizationThreshold` へ読み替える
- 5 つのスカラ値を同カテゴリの通常フィールドとしても編集可能に

インフレーションと違い**ポストパッチではなく `custom-preset.yml` 経由**にしています。スカラ値なのでカスタムプリセットの値がベースプリセットをそのまま上書きし、symbol-bootstrap が `config-finalization.properties` を正しく生成します。

> **訂正（2026-08-18）**: 当初この箇所に「インフレーションはマップのため、キーが欠けているとベース側の値が生き残る」と書いていましたが、**誤りでした**。`ConfigLoader.mergePresets` は `inflation` / `knownPeers` / `knownRestGateways` の 3 つを特別扱いし、深いマージではなく**最後に非空の値を持つプリセットで丸ごと置換**します。
>
> ```js
> const presetData = _.merge({}, ...presets);
> const inflation = reversed.find((p) => !_.isEmpty(p?.inflation))?.inflation;
> if (inflation) presetData.inflation = inflation;   // 丸ごと置換
> ```
>
> 実証: 手元のジェネシスノードは custom-preset.yml に `starting-at-height-2` の 1 件だけを持ち、生成された `config-inflation.properties` も 1 行だけです。bootstrap プリセットの 2 エントリ（`starting-at-height-1` / `starting-at-height-10000`）は残っていません。
>
> したがって**インフレーションも custom-preset.yml 経由で正しく反映されます**。コミット `552a9c5` のメッセージにも同じ誤記があります。

既定値は `shared.yml` と同じ（10000 / 6700 / 256 / 4 / 0）にしてあるため、**既存ネットワークの生成結果は変わりません**。また公式 mainnet / testnet プリセット使用時は、これらのキーを `DANGEROUS_TOP_KEYS` で custom-preset.yml から除去し、公式側の値（mainnet の 481 や除外投票者リスト）を壊さないようにしています。

### 4-4. 合意に影響しないファイル

以下はノードローカルの設定で、参加元と違っていてもブロック検証には影響しません。

- **`config-node.properties`** — ポート、バッファサイズ、BAN ポリシー、`trustedHosts` / `localNetworks`、`host` / `friendlyName` / `roles`、同期バッチ上限など全 71 キー。`minPartnerNodeVersion` / `maxPartnerNodeVersion` はピア接続の可否に効きますが、ブロック検証そのものには影響しません
- **`config-harvesting.properties`** — 自ノードのハーベスト鍵と方針
- **`config-database.properties`** — MongoDB の接続先
- **`config-user.properties`** — 各種ディレクトリのパス
- **`config-task.properties`** — 内部タスクのスケジュール
- **`config-messaging.properties` / `config-pt.properties` / `config-timesync.properties`** — ZMQ、部分トランザクション、時刻同期
- **`config-extensions-*.properties`** — ロードする拡張の一覧
- **`config-logging-*.properties`** — ログ出力

> `config-node.properties` の `maxBlocksPerSyncAttempt`（既定 360）は検証には効きませんが、**障害の見え方**を左右します。バッチ内の 1 ブロックでも検証に失敗すると全体が破棄されるため、停止する高さは「問題のブロック」ではなく「直前のバッチ境界」になります。今回 5401 で止まったのは 5401 が `1 + 360 × 15` だったためで、実際に弾かれていたのは 5760 でした。**停止高さをそのまま原因ブロックと解釈しないこと。**

---

## 5. 残課題

| 項目 | 優先度 | 内容 |
|---|---|---|
| restart モードでの設定未反映 | 低 | 設定変更後は「設定を完全適用して起動」が必要。UI 上の導線は既にあるが、通常 Start との違いが分かりにくい |

---

## 6. 再現用コマンド

```bash
# 生成される config ファイルとキー数
docker exec symbol-manager sh -c \
  'cd /var/lib/symbol-target/nodes/api-node-0/server-config/resources && \
   for f in *; do printf "%-36s %s keys\n" "$f" "$(grep -cE "^[a-zA-Z].*=" "$f")"; done'

# config-network.properties のキーが REST で賄えているか
curl -s http://<参加元>:3000/network/properties > src.json
docker exec symbol-manager sh -c \
  'grep -oE "^[a-zA-Z][a-zA-Z0-9]*" /var/lib/symbol-target/nodes/api-node-0/server-config/resources/config-network.properties | sort -u'
# → src.json の network / chain / plugins / forkHeights の全キーと突き合わせる

# プリセット間のファイナライズ設定差分
docker exec symbol-manager bash -c '
SB=$(find /root/.npm/_npx -maxdepth 4 -type d -name symbol-bootstrap | head -1)
for p in bootstrap testnet mainnet; do
  echo "--- $p ---"
  grep -nE "^ *(votingSetGrouping|finalizationSize|finalizationThreshold|maxHashesPerPoint|prevoteBlocksMultiple|treasuryReissuanceEpoch):" $SB/presets/$p/network.yml
done
grep -nE "^ *(finalizationSize|finalizationThreshold|maxHashesPerPoint|prevoteBlocksMultiple):" $SB/presets/shared.yml'

# 任意の高さのインフレーション量（receipt 0x5143）
curl -s "http://<参加元>:3000/statements/transaction?height=<H>&pageSize=50" \
  | python3 -c "import sys,json;[print(hex(r['type']),r.get('amount')) for s in json.load(sys.stdin)['data'] for r in s['statement']['receipts']]"
```

---

## 関連

- [障害レポート: JOIN ノードがエポック2到達後にクラッシュループする問題](incident-2026-07-04-join-node-crash.md) — 同じく Join ノード固有の、外部状態の進行で後から顕在化した不具合
- [バックアップ / リストア手順書](backup-restore.md)
