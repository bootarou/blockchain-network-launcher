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
6. [ボタンの説明](#ボタンの説明)
7. [リセット操作の違い](#リセット操作の違い)
8. [トラブルシューティング](#トラブルシューティング)
9. [技術仕様](#技術仕様)

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
| Bootstrap | symbol-bootstrap 1.1.10 |
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

## ライセンス

本ツールは Symbol ブロックチェーンの開発・検証を支援する目的で作成されたものです。
