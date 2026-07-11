# BNL — PQC Catapult 対応 実装計画書

**ブランチ**: `feat-PQC-custom-catapult`（ベース: `feat-custom-catapult`）
**作成日**: 2026-07-11
**ステータス**: ✅ **全 Phase 実装・受け入れ検証完了**（同日。結果は §7）
**⚠️ 運用ルール: このブランチは `main` / `dev` / `feat-custom-catapult` 等、他のいかなるブランチにもマージしない。**
PQC チェーンは既存 Symbol とワイヤフォーマット非互換（公開鍵 1312 B / 署名 2420 B / iVRF ブロックヘッダ）のため、
コードベースを共有しつつも成果物としては完全に別系統として扱う。

---

## 1. 方針決定: 「切り替え式」ではなく「PQC 専用ランチャー」にする

既存 UI に「旧 catapult ⇔ PQC」の切り替えを実装する案を調査したうえで、**PQC 専用ランチャーとして改修する**方針を採る。
理由（調査で確認した事実）:

1. **symbol-bootstrap がイメージに 1 系統しか入らない。**
   `Dockerfile` は `ARG SYMBOL_BOOTSTRAP_REPO`（既定 `bootarou/symbol-bootstrap.git`）を
   `npm install -g` しており、鍵・証明書・nemesis 生成はすべてこのグローバル install に依存する。
   PQC には [`pqc-bootstrap` ブランチ](https://github.com/bootarou/symbol-bootstrap/tree/pqc-bootstrap)
   （ML-DSA-44 鍵/証明書・iVRF VrfKeyLink・PQC nemesis）が必須で、旧ネットワークには旧版が必須。
   同居させるには二重インストールと呼び分けの大改修が必要。
2. **bootstrap 共有テンプレート汚染のリスク。**
   `server.ts` は既に「custom 設定が共有 mustache テンプレートへ漏れて公式 v2/v3 実行を壊す」問題への
   防御コード（`postGenPatches` / `removeProps` の分離）を多数抱えている。鍵生成レベルで別物の
   PQC bootstrap を同一マシンで切り替えると、この汚染面が証明書・addresses.yml にまで拡大する。
3. **旧前提の UI 機能が PQC では無意味または誤動作。**
   mainnet/testnet 参加（`JoinNetwork.tsx`）、公式 nodeWatch によるノード発見、
   公開鍵 hex 64 桁前提の表示（`AddressViewer.tsx` ほか）はいずれも PQC チェーンでは成立しない。
4. 切り替え債務が大きい場合は PQC 専用として改修してよい、とプロジェクトオーナーが承認済み。

ただし**既存の版管理機構（`CATAPULT_VERSIONS` / `CUSTOM_SERVER_IMAGE` / `CUSTOM_CONFIG_PATCHES`）は
そのまま流用**し、「PQC を唯一の版として登録する」形で実装する（差分最小・レビュー容易）。

## 2. 使用する公開物（すべて公開済み・検証済み）

| 種別 | 参照 |
|---|---|
| catapult server/broker イメージ | `nftdrive/bnl-catapult-server-pqc:1.0.3.9-bnl`（ML-DSA-44 / ML-KEM-768 / iVRF / ML-DSA 投票） |
| REST イメージ | `nftdrive/bnl-catapult-rest-pqc:2.4.3-bnl`（iVRF ブロックスキーマ） |
| symbol-bootstrap | `github.com/bootarou/symbol-bootstrap#pqc-bootstrap` |
| explorer | `github.com/bootarou/pqc-catapult-explorer#feat-pqc`（PQC SDK v2 使用） |
| mongo | `mongo:5.0.15`（公式・無改変。pqc-bootstrap の preset 既定） |

---

## 3. 実装ステップ

### Phase 1 — マネージャイメージ（Dockerfile）

| # | 作業 | 対象 |
|---|---|---|
| 1-1 | `ARG SYMBOL_BOOTSTRAP_REPO` の既定値を `https://github.com/bootarou/symbol-bootstrap.git#pqc-bootstrap` に変更（npm は `#<branch>` 付き git URL を解釈する） | `Dockerfile:31` |
| 1-2 | bootstrap テンプレート補完 COPY（`.npmignore` 対策）が pqc-bootstrap のファイル構成でも成立するか確認 | `Dockerfile:34-36` 付近 |
| 1-3 | イメージ再ビルドで `symbol-bootstrap --version` と `config -p bootstrap -a dual` の PQC 鍵生成を確認 | ビルド検証 |

### Phase 2 — バックエンド（backend/server.ts）

| # | 作業 | 対象 |
|---|---|---|
| 2-1 | `CATAPULT_VERSIONS` を PQC 1 エントリに置換: `{ id: 'pqc', serverImage: 'nftdrive/bnl-catapult-server-pqc:1.0.3.9-bnl', needsOpenSslPatch: false, ... }`。v2 / v3 定義と、それ専用の `removeProps` 相互防御コードを削除 | `server.ts:2834-2890` 付近 |
| 2-2 | `configPatches` の整理: v3 用パッチのうち PQC イメージに必要なもの（`[cache_database]` 等）を検証して残し、`[fork_heights]` 系は PQC nemesis 前提で要否を実測確認 | 同上 |
| 2-3 | `chainFinalizationHeight` は PQC イメージにも実装済みのため、`CUSTOM_CONFIG_PATCHES` 経由ではなく `pqc` 版の `postGenPatches` 既定に昇格させる（UI の Configuration 上書き機構 `applyCustomConfigValueOverrides` はそのまま機能する） | `server.ts:2999-3030` 付近 |
| 2-4 | `shared/custom-preset.yml` の既定を PQC イメージへ: `symbolServerImage: nftdrive/bnl-catapult-server-pqc:1.0.3.9-bnl` / `symbolRestImage: nftdrive/bnl-catapult-rest-pqc:2.4.3-bnl` | `shared/custom-preset.yml` |
| 2-5 | `resolveVersion()` のフォールバックを `pqc` に変更（保存済み preset の image 名から版を推定するロジックの分岐先を整理） | `server.ts:3039-3060` 付近 |
| 2-6 | mainnet / testnet 参加系 API・公式 nodeWatch 依存のエンドポイントを無効化（501 を返す or ルート削除）。`/api/explorer-proxy/api/symbol/nodes/*` の自前実装は自ネットワーク用なので**残す** | `server.ts:1452-1551` ほか JoinNetwork 系 |
| 2-7 | `CUSTOM_SERVER_IMAGE` 機構は PQC 版イメージの差し替え試験用として温存（継承元を v3 → pqc に変更） | `server.ts:2951-2975` |

### Phase 3 — Explorer 統合

| # | 作業 | 対象 |
|---|---|---|
| 3-1 | `EXPLORER_REPO` を `https://github.com/bootarou/pqc-catapult-explorer.git`、`EXPLORER_BRANCH` を `feat-pqc` に変更 | `server.ts:1593-1594` |
| 3-2 | 生成 Dockerfile 内の sed（`publicPath '/explorer-smd/'` 置換・`helper.js` の ws 強制）が feat-pqc のファイル内容とまだ一致するか確認し、不一致なら no-op 化 or 修正（現行 feat-pqc は `publicPath: '/'` のため置換は不発で無害の見込み） | `server.ts:1655-1660` |
| 3-3 | explorer イメージビルドは `npm install` 時に GitHub から PQC SDK v2 を取得する（`git+https`）。ビルドコンテナからの外部 https 到達性を確認 | ビルド検証 |
| 3-4 | ブロック詳細で `iVrfProofLeaf` / `iVrfProofPath` が表示されることを確認（旧 `proofGamma` 不在） | 動作検証 |

### Phase 4 — フロントエンド（frontend/src）

| # | 作業 | 対象 |
|---|---|---|
| 4-1 | Catapult バージョン選択を PQC 単一に（selector を固定表示化。`isCustomVersion` 分岐の整理） | `components/ConfigForm.tsx:284-320` |
| 4-2 | mainnet / testnet 参加 UI を削除または「PQC では利用不可」表示に（Seed インポートによるカスタムネットワーク参加は PQC ノード同士なら成立するため温存） | `components/JoinNetwork.tsx` |
| 4-3 | 公開鍵表示の 2624 hex 対応（折り返し・省略表示・コピー動作。アドレスは従来 39 文字のまま） | `components/AddressViewer.tsx`、`Dashboard.tsx` ほか公開鍵を出す箇所を grep |
| 4-4 | ブランド表記: タイトル・バッジを「BNL Post-Quantum Catapult」系に変更、非公式フォーク免責を Help に追記 | `App.tsx`、`HelpPage.tsx`、`index.html` |
| 4-5 | i18n（ja/en）に PQC 文言を追加（iVRF proof、ML-DSA 等のラベル） | `i18n/ja.ts`、`i18n/en.ts` |

### Phase 5 — ドキュメント

| # | 作業 | 対象 |
|---|---|---|
| 5-1 | README を PQC 専用ランチャーとして書き換え（免責・PQC 暗号構成表・関連リポジトリ表 — 他リポジトリと同形式） | `README.md` |
| 5-2 | MANUAL.md の該当箇所（バージョン選択・参加フロー）を PQC 前提に更新 | `MANUAL.md` |

### Phase 6 — 検証（受け入れ条件）

1. `docker compose build`（マネージャイメージ）→ `start.sh` で UI 起動
2. UI からネットワーク新規作成 → node/broker/db/rest が healthy、**iVRF/ML-DSA でブロックが伸びる**（vrf エラー 0）
3. Explorer をビルド・起動 → ブロック詳細に iVRF proof 表示、アカウント・Tx 閲覧可
4. ノード停止/再起動/フルリセット、バックアップ（設定のみ/フル）→ リストアが PQC ネットワークで機能
5. ターミナルログ・ダッシュボード統計（ブロック高・ファイナリティ・ハーベスト状態）が正常
6. `chainFinalizationHeight` を Configuration UI から設定 → 指定高さで停止することを確認

---

## 4. リスク・注意事項

| # | 項目 | 対応 |
|---|---|---|
| 1 | 旧ネットワークのバックアップ zip は PQC ランチャーでリストア不可（鍵形式・nemesis 非互換） | リストア時に nemesis の互換チェックを入れ、明示的に拒否メッセージを出す |
| 2 | PQC イメージは linux/amd64 のみ | README の要件に明記（Apple Silicon はエミュレーション） |
| 3 | 同一マシンに旧 BNL（main 系）が居ると bootstrap の npm グローバル install が衝突 | ランチャーはコンテナ内 install のため原則衝突しない。ホスト側 npx キャッシュには触れない設計を維持 |
| 4 | pqc-bootstrap は v1.1.10 ベースの `lib/` 直接パッチ | 上流更新の追従は行わない（このブランチでは凍結） |
| 5 | ブランチ運用 | **`feat-PQC-custom-catapult` は独立系統。main/dev/feat-custom-catapult へマージ禁止**（本書冒頭） |

## 5. 関連リポジトリ

| | |
|---|---|
| [bnl-catapult-pqc](https://github.com/bootarou/bnl-catapult-pqc) | PQC catapult 本体（総括: [PQC-SUMMARY.md](https://github.com/bootarou/bnl-catapult-pqc/blob/feat-VRF/votiong/PQC-SUMMARY.md)） |
| [symbol-bootstrap `pqc-bootstrap`](https://github.com/bootarou/symbol-bootstrap/tree/pqc-bootstrap) | PQC ネットワーク生成 CLI（本ランチャーが内蔵） |
| [pqc-catapult-explorer](https://github.com/bootarou/pqc-catapult-explorer) | PQC エクスプローラ（本ランチャーがビルド・起動） |
| [custom-catapult-chainFinalizationHeight](https://github.com/bootarou/custom-catapult-chainFinalizationHeight) | 非 PQC のカスタム catapult（旧系統の土台） |

---

## 7. 受け入れ検証結果（2026-07-11 実施・全項目合格）

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | マネージャイメージビルド（PQC bootstrap 同梱 + サニティチェック） | ✅ `✅ PQC symbol-bootstrap verified` |
| 2 | ネットワーク新規作成（`config`→`compose`→`run`、voting 有効 dual） | ✅ node / broker / db / rest 全稼働 |
| 3 | iVRF / ML-DSA 採掘 | ✅ 高さ 15 まで連続採掘、`invalid vrf` エラー 0 |
| 4 | REST の iVRF ブロック | ✅ `GET /blocks/2` = `iVrfProofLeaf` + path 2048hex、`proofGamma` なし |
| 5 | `chainFinalizationHeight`（Configuration UI 値 = 15） | ✅ 高さ 15 で凍結（30 秒×4 回確認、以降ブロック生成なし） |
| 6 | Explorer（pqc-catapult-explorer#feat-pqc をビルド・起動） | ✅ :8090 で SPA 配信、プロキシ経由で iVRF ブロック取得 |
| 7 | 停止 → restart モード再開 | ✅ 高さ 15 のまま再開（データ継続） |
| 8 | バックアップ（設定のみ zip） | ✅ ML-DSA 公開鍵（2624 hex）入り addresses.yml・暗号化秘密鍵・preset 同梱 |

### 検証中に発見・修正した問題（すべてコミット済み）

| 問題 | 修正 | コミット |
|---|---|---|
| `npm install -g <git-url>` が壊れた bootstrap を作る（npm 10.8 の tmp-clone symlink バグ、`files` ホワイトリスト、`prepack` 発火） | git clone + `npm install --omit=dev` + bin symlink 方式へ | launcher `7fafd99` |
| pqc-bootstrap の `bin/run` 実行ビット欠落（コンテナ抽出時に消失） | `update-index --chmod=+x` + Dockerfile の防御 chmod | pqc-bootstrap `d1c75d1` |
| 幽霊依存: `tweetnacl` / `symbol-openapi-typescript-fetch-client` が hoisting 前提で未宣言 → 非 hoist 配置で `MODULE_NOT_FOUND` | dependencies へ明示宣言 | pqc-bootstrap `3a976b5` |
| **`VotingUtils` が ed25519 サイズ固定**で PQC 投票鍵ツリー（1,766,800B）を拒否。voting 有効ノードは従来の PQC bootstrap 検証で未踏だった経路 | ML-DSA-44 レイアウト（root 公開鍵 1312B / 署名 2420B、ヘッダ 48+1312）で read/create を書き換え。実ファイル解析・往復テスト済み | pqc-bootstrap `3e98d32` |
| Docker レイヤーキャッシュがリモートブランチ更新を検知しない | ブランチ tip の API 応答を `ADD` してキャッシュバスト | launcher `53b512c` |
| explorer の `mv dist www` 失敗（PQC explorer は `www/` 直接出力） | `[ -d www ] || mv dist www` に変更 | launcher `4506ca9` |

---

## 8. 受け入れ後の追補修正（2026-07-11〜12）

運用・Explorer SMD 統合（explorer リポジトリの `PQC-SMD-PLAN.md` 参照）の過程で発見・修正したもの。

| # | 修正 | 内容 | コミット |
|---|---|---|---|
| 1 | Explorer clone レイヤーの cache-bust | ブランチ tip（GitHub refs API）の `ADD` で、explorer 更新が再ビルドに確実に反映されるように（bootstrap と同方式） | `1fa9412` |
| 2 | SPA/REST ルーティング修正 | Explorer の Vue Router は history モードでページ URL が REST パスと衝突（`/blocks/1` のリロードが JSON を返す）。プロキシに **Accept ヘッダ判定**を追加し、`GET`+`text/html`（ブラウザ遷移）は SPA へ、それ以外（SPA 内部 fetch・curl・SDK）は REST へ。**旧系統 `feat-custom-catapult`（`aa14901`）/ `main`（`8d37c78`）にも独立コミットとして適用済み** | `e2aaa57` |
| 3 | HTML / `/config` の no-cache 化 | 静的サーバーの長期キャッシュにより再デプロイがブラウザに反映されない問題。ハッシュ付きアセットはキャッシュ可のまま、HTML と `/config` のみ `Cache-Control: no-cache` | `b7ba56f` |
| 4 | Explorer ビルドの多段化 | clone / 依存インストール / ビルドをステージ分離。依存不変なら `npm install`（PQC SDK 取得+ビルド含む、最重量ステップ）をキャッシュ再利用。**無変更再ビルド 約 7 分 → 約 5 秒（実測）**、ソースのみの変更 → 約 2〜3 分 | `9636515` |
| 5 | **`chainFinalizationHeight` の UI 表示** | フィールド生成が `VITE_CUSTOM_CONFIG_PATCHES` 環境変数依存 + カテゴリ/ダッシュボード表示が `custom*` バージョン限定ゲートで、PQC 版 UI に設定が出ていなかった。**組み込みフィールド化**（カテゴリ「BNL 拡張設定」・常時表示・説明付き）し、NodeStats の確定高さインジケータのゲートも撤去（0 = 無効時は非表示） | `666cd10` |
