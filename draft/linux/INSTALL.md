# Symbol Network Manager — Linux インストールガイド

## 動作要件

| 項目 | 要件 |
|------|------|
| OS | Ubuntu 22.04+ / Debian 12+ / CentOS Stream 9+ / Fedora 38+ |
| アーキテクチャ | x86_64 (amd64) |
| RAM | 8 GB 以上（16 GB 推奨） |
| ディスク | 30 GB 以上の空き容量 |
| ソフトウェア | Docker Engine + Docker Compose Plugin |

---

## 1. Docker Engine のインストール

### Ubuntu / Debian の場合

```bash
# 古いバージョンを削除
sudo apt-get remove docker docker-engine docker.io containerd runc 2>/dev/null

# 必要なパッケージをインストール
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Docker 公式 GPG キーを追加
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# リポジトリを追加（Ubuntu の場合）
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker Engine をインストール
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

> **Debian** の場合は URL 中の `ubuntu` を `debian` に置き換えてください。

### CentOS / Fedora の場合

```bash
# リポジトリを追加
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Docker Engine をインストール
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Docker を起動 & 自動起動有効化
sudo systemctl start docker
sudo systemctl enable docker
```

### 一般ユーザーで Docker を実行可能にする（推奨）

```bash
sudo usermod -aG docker $USER
```

> **ログアウトして再ログイン** するまで反映されません。

### 動作確認

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

> `unzip` がない場合：`sudo apt install unzip` または `sudo dnf install unzip`

### 2-2. 環境変数ファイルの準備

```bash
cp .env.example .env
```

#### ストレージパスの設定

`.env` ファイル内の `SYMBOL_TARGET_DIR` はブロックチェーンデータの保存先です。

```bash
# .env を編集
nano .env
```

**推奨設定例：**

| ケース | 設定値 |
|--------|--------|
| デフォルト（ルートFS） | `SYMBOL_TARGET_DIR=/var/lib/symbol-target` |
| 別パーティション | `SYMBOL_TARGET_DIR=/data/symbol-target` |
| 外付けHDD | `SYMBOL_TARGET_DIR=/mnt/hdd/symbol-target` |

> **重要**: 指定したパスは Docker コンテナ内からも同じパスでアクセスされます。  
> 権限の問題を防ぐため、以下を実行してください：
> ```bash
> sudo mkdir -p /var/lib/symbol-target
> sudo chmod 777 /var/lib/symbol-target
> ```

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

### リモートからアクセスする場合

サーバーのIPアドレスを使用します：

```
http://<サーバーIP>:5173
```

ファイアウォールでポートを開放してください：

```bash
# UFW (Ubuntu)
sudo ufw allow 4000/tcp
sudo ufw allow 5173/tcp
sudo ufw allow 8090/tcp   # Explorer 用

# firewalld (CentOS/Fedora)
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --permanent --add-port=5173/tcp
sudo firewall-cmd --permanent --add-port=8090/tcp
sudo firewall-cmd --reload
```

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
sudo rm -rf /var/lib/symbol-target   # ストレージパスに合わせて変更
```

---

## 6. サーバー運用のヒント（ヘッドレス環境）

### systemd サービスとして登録

```bash
sudo tee /etc/systemd/system/symbol-manager.service << 'EOF'
[Unit]
Description=Symbol Network Manager
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/<ユーザー名>/symbol-web-ui
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=<ユーザー名>

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable symbol-manager
```

> `<ユーザー名>` を実際のユーザー名に置き換えてください。

### OS 起動時に自動スタート

```bash
sudo systemctl enable symbol-manager
```

---

## 7. トラブルシューティング

### Permission denied (Docker ソケット)

```bash
sudo usermod -aG docker $USER
# ログアウト→再ログイン
```

### ビルドが失敗する

```bash
docker compose build --no-cache
docker compose up -d
```

### ポートが競合する

```bash
# 使用中のポートを確認
sudo ss -tlnp | grep -E '4000|5173|8090'
```

### ログの確認

```bash
docker logs symbol-manager --tail 100 -f
```

### ディスク容量不足

```bash
# Docker の不要データを削除
docker system prune -a -f
```

---

## 8. アップデート

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
