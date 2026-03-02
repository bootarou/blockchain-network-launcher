# Symbol Network Manager — macOS インストールガイド

## 動作要件

| 項目 | 要件 |
|------|------|
| OS | macOS 12 (Monterey) 以降 |
| チップ | Intel / Apple Silicon (M1/M2/M3/M4) 両対応 |
| RAM | 8 GB 以上（16 GB 推奨） |
| ディスク | 30 GB 以上の空き容量 |
| ソフトウェア | Docker Desktop for Mac |

---

## 1. Docker Desktop のインストール

### 1-1. ダウンロード

公式サイトからインストーラーをダウンロードします：

👉 https://www.docker.com/products/docker-desktop/

> **Apple Silicon (M1/M2/M3/M4)** の場合は「Apple Chip」版を選択してください。  
> **Intel Mac** の場合は「Intel Chip」版を選択してください。

### 1-2. インストール

1. ダウンロードした `.dmg` ファイルを開く
2. `Docker.app` を `Applications` フォルダにドラッグ
3. `Applications` から `Docker` を起動
4. セキュリティの許可を求められた場合は許可する

### 1-3. 初期設定

1. Docker Desktop が起動するまで待つ（メニューバーに 🐳 アイコンが表示される）
2. 利用規約に同意
3. アイコンが 🟢 **緑色（Running）** になるまで待つ

### 1-4. 動作確認

ターミナルを開いて：

```bash
docker --version
docker compose version
```

両方ともバージョンが表示されればOKです。

---

## 2. Symbol Network Manager のセットアップ

### 2-1. ZIPを展開

配布された `symbol-web-ui.zip` を任意のフォルダに展開します。

```bash
# 例：ホームディレクトリに展開
cd ~
unzip symbol-web-ui.zip
cd symbol-web-ui
```

### 2-2. 環境変数ファイルの準備

```bash
cp .env.example .env
```

> **ストレージパスについて**  
> `.env` ファイル内の `SYMBOL_TARGET_DIR` はブロックチェーンデータの保存先です。  
> macOS の Docker Desktop では、デフォルトの `/var/lib/symbol-target` を推奨します。  
> この領域は Docker Desktop の仮想ディスク上にあり十分な容量があります。  
> **通常は変更不要です。**

### 2-3. ビルド & 起動

```bash
cd ~/symbol-web-ui
docker compose up -d
```

初回ビルドには **5〜15分** かかります（インターネット速度に依存）。

### 2-4. 起動確認

```bash
docker ps
```

`symbol-manager` コンテナが `Up` 状態になっていればOKです。

---

## 3. アクセス

ブラウザで以下を開きます：

| 画面 | URL |
|------|-----|
| メイン画面（開発モード） | http://localhost:5173 |
| バックエンドAPI | http://localhost:4000/api/status |

> 初回アクセス時、フロントエンドのビルドに数秒かかる場合があります。

---

## 4. 基本操作

### ノードの起動

1. ブラウザで http://localhost:5173 を開く
2. **Config** タブでネットワーク設定を行う
3. **Dashboard** タブで **Start** ボタンをクリック
4. パスワードを入力して起動

### Explorer（ブロックチェーンエクスプローラー）

1. **Config → Explorer** タブで **Build** をクリック（初回のみ、約5分）
2. ビルド完了後、**Start** をクリック
3. http://localhost:8090 でエクスプローラーにアクセス

### ノードの停止

1. **Dashboard** タブで **Stop** ボタンをクリック

---

## 5. 停止 / 再起動 / 完全削除

### アプリの停止

```bash
cd ~/symbol-web-ui
docker compose down
```

### アプリの再起動

```bash
cd ~/symbol-web-ui
docker compose up -d
```

### 完全削除（ブロックチェーンデータも含む）

```bash
cd ~/symbol-web-ui
docker compose down
docker volume prune -f
```

---

## 6. トラブルシューティング

### Docker Desktop が起動しない

- macOS のバージョンが 12 以上か確認
- Docker Desktop を再インストール
- Apple Silicon の場合、Rosetta 2 が必要な場合があります：
  ```bash
  softwareupdate --install-rosetta
  ```

### ビルドが失敗する

```bash
docker compose build --no-cache
docker compose up -d
```

### ポートが競合する

```bash
# 使用中のポートを確認
lsof -i :4000
lsof -i :5173
```

`docker-compose.yml` でポートマッピングを変更できます。

### ログの確認

```bash
docker logs symbol-manager --tail 100 -f
```

### ディスク容量不足

Docker Desktop の Settings → Resources → Disk image size を増やしてください。

### Apple Silicon で動作が遅い場合

Docker Desktop → Settings → General で **「Use Virtualization framework」** が有効になっているか確認してください。

---

## 7. アップデート

新しいバージョンの ZIP を受け取った場合：

```bash
cd ~/symbol-web-ui
docker compose down
```

1. 新しいZIPの内容でファイルを上書き（`.env` と `shared/` フォルダは **そのまま保持**）
2. 再ビルド & 起動：

```bash
docker compose build --no-cache
docker compose up -d
```

> **注意**: `shared/` フォルダにはプリセット設定やネットワークの構成情報が保存されています。  
> アップデート時に削除しないでください。
