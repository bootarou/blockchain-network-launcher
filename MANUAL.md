# Symbol Network Manager — ユーザーマニュアル

## 目次

1. [概要](#概要)
2. [システム要件](#システム要件)
3. [初回セットアップ](#初回セットアップ)
4. [画面の説明](#画面の説明)
   - [Join Network（ネットワーク参加）](#join-network)
   - [Configuration（設定）](#configuration)
   - [Dashboard（操作パネル）](#dashboard)
5. [基本的な使い方](#基本的な使い方)
   - [カスタムネットワークに参加する](#カスタムネットワークに参加する)
   - [Seedファイルをインポートする](#seedファイルをインポートする)
   - [ノードを起動する](#ノードを起動する)
   - [ノードを停止・再起動する](#ノードを停止再起動する)
   - [証明書の有効期限を確認する](#証明書の有効期限を確認する)
   - [証明書を更新する](#証明書を更新する)
6. [ボタンの説明](#ボタンの説明)
7. [リセット操作の違い](#リセット操作の違い)
8. [Docker Host Mode（ホストネットワークモード）](#docker-host-mode)
9. [nodeEqualityStrategy（ノード同一性判定）](#nodeequalitystrategy)
10. [トラブルシューティング](#トラブルシューティング)
11. [技術仕様](#技術仕様)

---

## 概要

Symbol Network Manager は、Symbol ブロックチェーンのカスタムネットワーク（プライベートネットワーク）にノードとして参加するための Web UI ツールです。

Docker-in-Docker（DinD）アーキテクチャを採用しており、`symbol-bootstrap` を内部で使用してノードの設定・起動・管理を自動化します。

---

## システム要件

| 項目 | 要件 |
|------|------|
| OS | Windows / macOS / Linux |
| Docker | Docker Desktop または Docker Engine |
| メモリ | 4GB 以上推奨 |
| ディスク | 10GB 以上の空き容量 |
| ポート | `4000`（管理UI）、`7900`（P2P）、`3000`（REST API） |

---

## 初回セットアップ

### 1. Docker Compose で起動

```bash
cd Symbol-web-ui
docker compose up -d --build
```

### 2. Web UI にアクセス

ブラウザで `http://localhost:4000` を開きます。

### 3. 参加するネットワークの情報を準備

- ソースノードの REST API URL（例：`http://192.168.0.33:3000`）
- ネットワーク管理者から提供された **Seed ファイル**（推奨）

---

## 画面の説明

ヘッダーのタブで画面を切り替えます。デスクトップ（横幅1600px以上）では左右2カラムで表示されます。

### Join Network

既存のカスタムネットワークに参加するための画面です。

1. **ソースノード URL** — 参加先ネットワークの REST API エンドポイントを入力
2. **ネットワーク情報取得** — URL を入力して「取得」ボタンを押すと、ネットワークの設定を自動取得
3. **Seed ファイルインポート** — ネットワーク管理者から受け取った nemesis seed ファイルをドラッグ＆ドロップ
4. **設定に反映** — 取得した情報を Configuration に反映

### Configuration

ノードの詳細設定を行う画面です。Join Network から自動反映された値を確認・修正できます。

主な設定項目：
- **Preset** — ネットワーク種別（`testnet` / `mainnet` / `bootstrap`）
- **Assembly** — ノード構成（`dual` = Peer + API）
- **Password** — ネットワーク暗号化パスワード
- **Catapult Version** — サーバーバージョン（`v2` = gcc-1.0.3.6 / `v3` = gcc-1.0.3.9）
- **Node Settings** — ノード名、ホスト、各種鍵の設定

### Dashboard

ノードの操作・監視を行うメイン画面です。

- **操作ボタン** — Start / Stop / Health Check / Reset / 完全初期化
- **ターミナルログ** — リアルタイムで処理の進行状況を表示
- **設定のインポート/エクスポート** — YAML / JSON 形式で設定を保存・読み込み

---

## 基本的な使い方

### カスタムネットワークに参加する

1. **「Join Network」タブ** を開く
2. ソースノードの URL を入力して **「取得」** をクリック
3. ネットワーク設定が自動取得される
4. **「設定に反映」** をクリック → Configuration タブに切り替わる

### Seed ファイルをインポートする

> ⚠️ **推奨：** ネットワーク管理者から Seed ファイルを入手してインポートしてください。
> REST API からの nemesis ブロック再構築は一部のネットワークで動作しない場合があります。

1. **「Join Network」タブ** の Seed インポートエリアにファイルをドラッグ＆ドロップ
2. 必要なファイル：
   - `00001.dat`（nemesis ブロックデータ）— **必須**
   - `00001.stmt`（nemesis ブロックステートメント）
   - `hashes.dat`（ブロックハッシュ）
   - `proof.index.dat`（ファイナライゼーションインデックス）
   - `00001.proof`（ファイナライゼーション証明）
   - `proof.heights.dat`（証明の高さデータ）
3. インポート状態が表示される

### ノードを起動する

1. **「Dashboard」タブ** を開く
2. **パスワード** を入力（Configuration で設定したもの）
3. **「Start」** ボタンをクリック
4. 以下の処理が自動実行される：
   - Step 1: 設定ファイル生成（`symbol-bootstrap config`）
   - Step 2: サーバーイメージのパッチ適用
   - Step 3: config-network.properties のパッチ
   - Step 4: docker-compose.yml 生成・ピア取得・証明書生成・nemesis seed インストール
   - Step 5: コンテナ起動（`docker-compose up -d`）
   - Step 6: ヘルスチェック待機
5. ターミナルログで進行状況を確認
6. ヘッダー右上の **ヘルスインジケーター** が緑になれば成功

### ノードを停止・再起動する

- **Stop** → **Start** で再起動（データは保持されたまま）
- 同期済みブロックデータから継続します

### 証明書の有効期限を確認する

Dashboard の **「ノード統計」** セクション下部に **「証明書の有効期限」** パネルが表示されます。

| 証明書 | 説明 | デフォルト有効期間 |
|--------|------|-------------------|
| **ノード証明書** | api-node の TLS 通信用 | 375 日（約 1 年） |
| **CA 証明書** | ノード証明書の署名用 | 7,300 日（約 20 年） |
| **REST ノード証明書** | REST gateway の TLS 通信用 | 375 日（約 1 年） |
| **REST CA 証明書** | REST 証明書の署名用 | 7,300 日（約 20 年） |

各証明書に **残り日数** と **プログレスバー** が表示されます。残り日数に応じて色が変わります：

- 🟢 **緑** — 残り 91 日以上（安全）
- 🟡 **黄** — 残り 31〜90 日（注意）
- 🔴 **赤** — 残り 30 日以内（要更新）

> ⚠️ **重要：** ノード証明書（デフォルト 375 日）は定期的な更新が必要です。期限切れになるとノード間通信および REST gateway との接続が停止します。

### 証明書を更新する

1. **ノードを停止する** — Dashboard で **「Stop」** をクリック
2. 証明書パネルの **「証明書を更新」** ボタンをクリック
3. **パスワード** を入力（ノード起動時と同じネットワーク暗号化パスワード）
4. 必要に応じて **「期限が近くなくても強制的に更新する」** にチェック
   - デフォルトでは残り 30 日以内でないと更新されません
   - 強制更新したい場合はチェックを入れてください
5. **「更新を実行」** をクリック
6. 処理が完了すると成功メッセージが表示される
7. **ノードを再起動する** — パスワードを入力して **「Start」** をクリック

> 💡 **ヒント：** 証明書の更新は以下の処理を自動で実行します：
> - `symbol-bootstrap renewCertificates` — ノード証明書の再生成
> - REST gateway 証明書の再生成 — api-node とは別の ID を維持
>
> CA 証明書のキーペアは保持されるため、ノードの公開鍵は変わりません。

---

## ボタンの説明

### Dashboard 操作ボタン

| ボタン | 説明 |
|--------|------|
| **▶ Start** | ノードを起動（設定生成 → コンテナ起動 → ヘルスチェック） |
| **■ Stop** | ノードを停止（コンテナを停止するのみ、データは保持） |
| **♥ Health Check** | `symbol-bootstrap healthCheck` を実行 |
| **🗑 Reset** | ネットワークデータのみリセット（設定・証明書は保持） |
| **🗑 完全初期化** | 全設定・全データ・証明書を削除して初期状態に戻す |

### ヘッダーボタン

| ボタン | 説明 |
|--------|------|
| **Reset**（ヘッダー右上） | UI の設定値をデフォルトに戻す（サーバーには影響なし） |

---

## リセット操作の違い

| 操作 | 設定ファイル | ブロックデータ | 証明書・鍵 | Seed ファイル | 用途 |
|------|:---:|:---:|:---:|:---:|------|
| **Stop → Start** | ✅ 保持 | ✅ 保持 | ✅ 保持 | ✅ 保持 | 単純な再起動 |
| **Reset** | ✅ 保持 | ❌ 削除 | ✅ 保持 | ✅ 保持 | 同じネットワークに再同期 |
| **完全初期化** | ❌ 全削除 | ❌ 全削除 | ❌ 全削除 | ❌ 全削除 | 別のネットワークに切り替え |

---

## Docker Host Mode

### 概要

Docker Host Mode は、catapult コンテナ（`api-node-0`、`broker`）を Docker のホストネットワークモード（`network_mode: host`）で実行する機能です。

Configuration の **Nodes** タブにある **「Docker Host Mode」** トグルで ON/OFF を切り替えます。

### なぜ必要か

通常の Docker ブリッジネットワークでは、外部ピアからの接続が **DNAT（宛先アドレス変換）** を経由します。このため catapult が認識するピアの IP アドレスは、実際の送信元ではなく **Docker ブリッジのゲートウェイ IP**（例: `172.20.0.1`）に書き換えられます。

- **2台構成** → 外部ピアは1台だけなので問題にならない
- **3台以上** → 全外部ピアが同一 IP に見える → `nodeEqualityStrategy: host` の場合にピア識別が衝突

Host Mode ではコンテナがホスト OS のネットワーク名前空間を直接共有するため、DNAT が発生せず、ピアの実 IP アドレスがそのまま認識されます。

### プラットフォーム別の動作

| 環境 | Host Mode 動作 | LAN 接続 | 推奨 |
|------|:-:|:-:|------|
| **ネイティブ Linux Docker** | ✅ 正常 | ✅ ポート7900がLANに公開 | 3台以上で推奨 |
| **Docker Desktop（Windows）** | ⚠ VM内のみ | ❌ ポート7900がLANから到達不可 | **使用不可** |
| **Docker Desktop（macOS）** | ⚠ VM内のみ | ❌ ポート7900がLANから到達不可 | **使用不可** |

> ⚠️ **重要：Docker Desktop（Windows/Mac）では Docker Host Mode を使用しないでください。**
>
> Docker Desktop はコンテナを WSL2（Windows）または HyperKit/Virtualization.framework（Mac）の仮想マシン内で実行します。`network_mode: host` を設定すると、コンテナは VM 内のネットワーク名前空間を共有しますが、ホスト OS の LAN インターフェースには直接アクセスできません。
>
> 結果として、ポート 7900 は VM 内でのみリッスンされ、LAN 上の他のノードから接続できなくなります。
>
> Web UI では Docker Desktop 環境を自動検出し、Host Mode を ON にすると赤い警告バナーが表示されます。

### パッチ内容

Host Mode を有効にすると、Start 時に以下のパッチが自動適用されます：

| 対象 | 変更内容 |
|------|----------|
| `docker-compose.yml` — api-node-0 | `network_mode: host` 追加、`ports` / `networks` 削除 |
| `docker-compose.yml` — broker | `network_mode: host` 追加、`ports` / `networks` 削除 |
| `docker-compose.yml` — db | `ports: 127.0.0.1:27017:27017` 追加（ホストからMongoDB接続用） |
| `config-database.properties` | `databaseUri` → `mongodb://127.0.0.1:27017` |
| `rest.json` — apiNode.host | ブリッジネットワークのゲートウェイ IP に変更（rest-gateway → catapult の接続経路） |
| `config-node.properties` — localNetworks | Docker サブネットのプレフィックス追加をスキップ |

> 💡 rest-gateway はブリッジネットワーク上に残ります（Docker DNS で `db` コンテナに到達するため）。catapult へはブリッジゲートウェイ IP 経由で接続します。

### 切り替え手順

**有効化：**
1. Configuration → Nodes タブ → **Docker Host Mode** を ON
2. **Save** で保存
3. Dashboard → **Stop** → **Start**（Full Reset は不要）

**無効化：**
1. Configuration → Nodes タブ → **Docker Host Mode** を OFF
2. **Save** で保存
3. Dashboard → **Stop** → **Start**

---

## nodeEqualityStrategy

### 概要

`nodeEqualityStrategy` は、catapult がネットワーク上のピアノードを「同一ノードかどうか」判定する方法を決める設定です。

Configuration の **Nodes** タブにあるプルダウンメニューで選択します。

### 選択肢

| 値 | 判定方法 | 説明 |
|----|----------|------|
| **`host`**（デフォルト） | IP アドレス | 同じ IP からの接続は同一ノードとみなす |
| **`public-key`** | 公開鍵 | ノードの公開鍵が一致すれば同一ノードとみなす |

### プラットフォーム別の推奨設定

| 構成 | Docker 環境 | 推奨設定 | 理由 |
|------|------------|----------|------|
| **2台** | Docker Desktop / Linux | `host`（デフォルト）でOK | 外部ピアは1台のみ、IP衝突なし |
| **3台以上** | Docker Desktop（Win/Mac） | **`public-key`** | DNAT で全外部ピアが同一IPに見えるため、IP判定では衝突する |
| **3台以上** | ネイティブ Linux + Host Mode | `host`（デフォルト）でOK | Host Mode なら DNAT なし、実IPが見える |

### 具体例：3台構成での DNAT 問題

```
Node A (192.168.0.31) ──┐
                        ├── Docker bridge (172.20.0.1) ── DNAT ── api-node-0 (172.20.0.x)
Node B (192.168.0.36) ──┘
```

Node C の catapult から見ると：
- Node A の接続元 IP → `172.20.0.1`
- Node B の接続元 IP → `172.20.0.1`

`nodeEqualityStrategy: host` の場合、Node A と Node B が同一ノードとみなされ、一方が切断される → 同期不安定。

`nodeEqualityStrategy: public-key` なら、IP が同じでも公開鍵が異なるため正しく2つの別ノードとして識別される。

### 設定変更の反映

この設定は `config-node.properties` に書き込まれます。変更後は **Stop → Start** で反映されます（Full Reset は不要）。

### まとめ早見表

| 台数 | OS | Docker Host Mode | nodeEqualityStrategy | 備考 |
|:----:|:---|:-:|:-:|------|
| 2台 | Windows/Mac | OFF | どちらでもOK | 最もシンプルな構成 |
| 2台 | Linux | OFF or ON | どちらでもOK | |
| 3台+ | Windows/Mac | **OFF**（使用不可） | **public-key** | DNAT対策として必須 |
| 3台+ | Linux | **ON**（推奨） | どちらでもOK | Host Mode で DNAT 回避 |

### OS・台数別の制約と推奨構成

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Docker Desktop (Windows / Mac)                │
│                                                                    │
│  ┌──────────────────────────────────┐                              │
│  │   ホスト OS (Windows / macOS)    │                              │
│  │                                  │                              │
│  │   ┌──────────────────────────┐   │                              │
│  │   │  WSL2 / HyperKit VM     │   │   network_mode: host は      │
│  │   │                         │   │   VM 内のみ有効               │
│  │   │  ┌───────────────────┐  │   │                              │
│  │   │  │ api-node-0 :7900  │──┼───┼── ❌ LAN に到達不可          │
│  │   │  └───────────────────┘  │   │                              │
│  │   │                         │   │   ports: マッピング経由       │
│  │   │  ┌───────────────────┐  │   │   (ブリッジモード) なら       │
│  │   │  │ api-node-0 :7900  │──┼───┼── ✅ LAN に公開可能          │
│  │   │  └───────────────────┘  │   │                              │
│  │   └──────────────────────────┘   │                              │
│  └──────────────────────────────────┘                              │
│                                                                    │
│  結論: Docker Desktop では Host Mode OFF + ブリッジモードを使用    │
│        3台以上なら nodeEqualityStrategy: public-key で DNAT 回避   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      ネイティブ Linux Docker                        │
│                                                                    │
│  ┌──────────────────────────────────────────┐                      │
│  │   Linux ホスト (VM なし・直接実行)       │                      │
│  │                                          │                      │
│  │   ┌───────────────────┐                  │                      │
│  │   │ api-node-0 :7900  │──────────────────┼── ✅ LAN に直接公開  │
│  │   └───────────────────┘                  │                      │
│  │   network_mode: host =                   │   DNAT なし          │
│  │   ホスト OS のネットワーク名前空間を共有 │   実 IP を保持       │
│  └──────────────────────────────────────────┘                      │
│                                                                    │
│  結論: Host Mode ON で最適なパフォーマンス                         │
│        台数制限なし、DNAT 問題なし、VM オーバーヘッドなし          │
└─────────────────────────────────────────────────────────────────────┘
```

#### 構成ごとの判断フローチャート

```
ノードは何台？
  │
  ├── 2台 ──────── OS は？
  │                  ├── Windows/Mac ── Host Mode OFF（デフォルトのまま）✅
  │                  └── Linux ──────── Host Mode OFF or ON どちらでもOK ✅
  │
  └── 3台以上 ──── OS は？
                     ├── Windows/Mac ── Host Mode OFF（使用不可）
                     │                  └── nodeEqualityStrategy: public-key に変更 ⚠
                     │
                     └── Linux ──────── Host Mode ON（推奨）✅
                                        └── nodeEqualityStrategy はどちらでもOK
```

#### 本番運用の推奨構成

| 項目 | 推奨 |
|------|------|
| **OS** | ネイティブ Linux（Ubuntu 22.04+ 等） |
| **Docker** | Docker Engine（Docker Desktop ではなく） |
| **Docker Host Mode** | ON |
| **nodeEqualityStrategy** | `host`（デフォルト） |
| **理由** | VM オーバーヘッドなし、DNAT なし、ポート直接公開 |

### ネットワーク構築の推奨手順

#### 1台目（ネメシスノード）= Linux で構築

ネットワークの最初のノード（ネメシスブロック生成者）は **ネイティブ Linux** で構築することを強く推奨します。

```
┌─────────────────────────────────────────────────────────────────┐
│  1台目: Linux ネメシスノード（ネットワーク管理者）              │
│                                                                 │
│  ├── Docker Host Mode: ON                                       │
│  ├── Assembly: dual（API + Peer）                               │
│  ├── Preset: bootstrap（ネメシスブロック生成）                  │
│  ├── インポータンス: 高（全通貨の初期配分を保持）              │
│  ├── 投票鍵: あり → ファイナリティブロック生成                  │
│  ├── ブロック生成（ハーベスティング）の主力                     │
│  └── 他ノード向けの Seed ファイル提供元                         │
│                                                                 │
│  役割: ネットワークの基盤として安定稼働                         │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Seed ファイル配布 + P2P 接続 (7900)
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ 2台目  │ │ 3台目  │  ...  参加ノードは OS を問わない
│Win/Mac │ │ Linux  │
│ブリッジ│ │ Host   │
│ Mode   │ │ Mode   │
└────────┘ └────────┘
```

**Linux を1台目にする理由：**

| 理由 | 説明 |
|------|------|
| **Host Mode が使える** | ポート7900がLANに直接公開され、他ノードから確実に接続可能 |
| **DNAT 問題なし** | 3台以上に拡張する際も、ピアIPが正しく認識される |
| **VM オーバーヘッドなし** | Docker Desktop の WSL2/HyperKit を経由しないため高速・安定 |
| **Seed 提供元として安定** | 他ノードの Join Network で指定する REST API (`:3000`) が安定稼働 |
| **ファイナリティの要** | インポータンス + 投票鍵を持つノードが安定していることが最重要 |

#### 2台目以降 = OS 不問

Linux ネメシスノードが安定稼働していれば、2台目以降は **Windows / macOS / Linux** のいずれでも参加可能です。

| 手順 | 操作 |
|------|------|
| 1 | Join Network タブ → ソースノード URL に Linux ノードの REST API を入力 |
| 2 | Seed ファイルをインポート（Linux ノードの管理者から受領） |
| 3 | 設定に反映 → Save → Start |
| 4 | 自動的にブロック同期 + ファイナリティ同期が開始 |

> 💡 参加ノードにインポータンスや投票鍵がなくても、ブロック同期・ファイナリティ同期（proof の受信・検証）は正常に動作します。

---

## トラブルシューティング

### apiNode が「down」のまま

**原因：** REST gateway と api-node 間の TLS 接続に問題がある可能性があります。

**対処法：**
1. ターミナルログで `connecting to api-node-0:7900` が繰り返されていないか確認
2. `完全初期化` → `Start` でやり直す
3. それでも解決しない場合は Docker コンテナのログを確認：
   ```
   docker exec symbol-manager bash -c "cd /opt/symbol-target/docker && docker compose logs rest-gateway"
   ```

### Segmentation fault (exit code 139)

**原因：** proof.index.dat のフォーマット不正が主な原因です。

**対処法：** `完全初期化` → Seed ファイルを再インポート → `Start` でやり直してください。本アプリの最新版では proof.index.dat を正しい 48 バイト形式で自動生成するため、通常発生しません。

### Failure_Chain_Block_Unknown_Signer

**原因：** nemesis ブロックのトランザクションが正しく処理されず、アカウントステートキャッシュにハーベスティング鍵が登録されていません。

**対処法：**
1. `完全初期化` でクリーン状態に戻す
2. 正しい Seed ファイルをインポートし直す
3. `Start` で再起動

### 証明書の更新に失敗する

**考えられる原因：**
- ノードが起動中（停止が必要）
- パスワードが間違っている
- 証明書ファイルが存在しない（一度もノードを起動していない）

**対処法：**
1. 必ず **Stop** でノードを停止してから更新を実行
2. ノード起動時と同じパスワードを使用しているか確認
3. ターミナルログでエラーの詳細を確認
4. 解決しない場合は `完全初期化` → `Start` でやり直す（証明書は再生成されます）

### ブロック同期が進まない

**考えられる原因：**
- ソースノードがダウンしている
- ファイアウォールでポート 7900 がブロックされている
- Catapult バージョンのミスマッチ

**確認方法：**
1. ソースノードの REST API にアクセスできるか確認
2. ターミナルログで `connection attempt ... completed with Accepted` が出ているか確認
3. ソースノードと同じ Catapult バージョンを使用しているか確認

### コンテナが起動しない

**対処法：**
1. Docker Desktop が起動しているか確認
2. ディスク容量に余裕があるか確認
3. ターミナルログでエラーメッセージを確認
4. `完全初期化` → `Start` でやり直す

---

## 技術仕様

### アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│  Host (Windows/macOS/Linux)                      │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  symbol-manager (Docker Container)         │  │
│  │  ┌──────────┐  ┌───────────┐               │  │
│  │  │ Frontend │  │  Backend  │               │  │
│  │  │ React    │  │  Express  │  port 4000    │  │
│  │  │ Vite     │  │  Node.js  │               │  │
│  │  └──────────┘  └─────┬─────┘               │  │
│  │                      │ docker.sock          │  │
│  │  ┌───────────────────┴──────────────────┐  │  │
│  │  │  V2 Containers (Docker-in-Docker)    │  │  │
│  │  │  ┌───────────┐  ┌───────────────┐   │  │  │
│  │  │  │ api-node-0│  │ rest-gateway  │   │  │  │
│  │  │  │ :7900     │  │ :3000         │   │  │  │
│  │  │  ├───────────┤  └───────────────┘   │  │  │
│  │  │  │  broker   │  ┌───────────────┐   │  │  │
│  │  │  └───────────┘  │  MongoDB (db) │   │  │  │
│  │  │                 └───────────────┘   │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 使用技術

| レイヤー | 技術 |
|----------|------|
| Frontend | React 19 + Vite + Tailwind CSS v4 + TypeScript |
| Backend | Node.js + Express 5 + WebSocket |
| Bootstrap | symbol-bootstrap 1.1.10（[bootarou/symbol-bootstrap](https://github.com/bootarou/symbol-bootstrap)） |
| Server V2 | symbolplatform/symbol-server:gcc-1.0.3.6 |
| Server V3 | symbolplatform/symbol-server:gcc-1.0.3.9 |
| REST | symbolplatform/symbol-rest:2.4.2 |
| Database | MongoDB 5.0.15 |
| Container | Docker-in-Docker (DinD) |

### ポート一覧

| ポート | 用途 |
|--------|------|
| 4000 | Symbol Network Manager Web UI / API |
| 7900 | Symbol P2P ノード通信 |
| 3000 | Symbol REST API |
| 27017 | MongoDB（内部のみ） |
| 7902 | ZeroMQ（内部のみ） |

### ディレクトリ構造（コンテナ内）

```
/opt/symbol-target/          ← symbol-bootstrap のターゲットディレクトリ
├── docker/
│   ├── docker-compose.yml   ← V2 コンテナ定義
│   ├── mongo/               ← MongoDB 初期化スクリプト
│   └── server/              ← start.sh 等
├── nodes/
│   └── api-node-0/
│       ├── server-config/   ← サーバー設定
│       ├── broker-config/   ← ブローカー設定
│       ├── cert/            ← TLS 証明書
│       ├── data/            ← ブロックチェーンデータ
│       ├── seed/            ← nemesis seed
│       └── logs/            ← ログファイル
├── gateways/
│   └── rest-gateway/        ← REST gateway 設定・証明書
└── databases/
    └── db/                  ← MongoDB データ
```

---

## 外部依存の管理

本ツールは以下の外部リソースに依存しています。元リポジトリ（`fbsobreira/symbol-bootstrap`）が削除された教訓を踏まえ、重要な依存は自前のリポジトリにフォーク/ミラーリングしています。

### GitHubリポジトリ

| 依存 | 元リポジトリ | フォーク先（バックアップ） | 用途 |
|------|-------------|--------------------------|------|
| symbol-bootstrap | ~~fbsobreira/symbol-bootstrap~~（削除済み） | [bootarou/symbol-bootstrap](https://github.com/bootarou/symbol-bootstrap) | ノード構築・管理ツール |
| Symbol Explorer | [symbol/explorer](https://github.com/symbol/explorer) | [bootarou/explorer-smd](https://github.com/bootarou/explorer-smd) | ブロックチェーンエクスプローラー |

### Dockerイメージ

| イメージ | Docker Hub | 対策 |
|----------|-----------|------|
| symbolplatform/symbol-server | [Docker Hub](https://hub.docker.com/r/symbolplatform/symbol-server) | ImageManager でローカルバックアップ推奨 |
| symbolplatform/symbol-rest | [Docker Hub](https://hub.docker.com/r/symbolplatform/symbol-rest) | ImageManager でローカルバックアップ推奨 |
| mongo:5.0.15 | [Docker Hub](https://hub.docker.com/_/mongo) | Docker公式（低リスク） |

### カスタムリポジトリの利用

`Dockerfile` の `SYMBOL_BOOTSTRAP_REPO` ビルド引数でインストール元を変更できます：

```bash
# デフォルト（bootarou/symbol-bootstrap）
docker compose build

# 別のリポジトリを指定
docker compose build --build-arg SYMBOL_BOOTSTRAP_REPO=https://github.com/<your-org>/symbol-bootstrap.git
```

---

## ライセンス

本ツールは Symbol ブロックチェーンの開発・検証を支援する目的で作成されたものです。
