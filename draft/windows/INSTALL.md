# Symbol Network Manager — Windows インストールガイド

## 動作要件

| 項目 | 要件 |
|------|------|
| OS | Windows 10 (21H2以降) / Windows 11 |
| RAM | 8 GB 以上（16 GB 推奨） |
| ディスク | 30 GB 以上の空き容量 |
| ソフトウェア | Docker Desktop for Windows |

---

## 1. Docker Desktop のインストール

### 1-1. ダウンロード

公式サイトからインストーラーをダウンロードします：

👉 https://www.docker.com/products/docker-desktop/

### 1-2. インストール

1. ダウンロードした `Docker Desktop Installer.exe` を実行
2. **「Use WSL 2 instead of Hyper-V」** にチェックを入れる（推奨）
3. インストール完了後、PCを **再起動**

### 1-3. 初期設定

1. Docker Desktop を起動
2. 利用規約に同意
3. タスクトレイのDockerアイコンが 🟢 **緑色（Running）** になるまで待つ

### 1-4. 動作確認

PowerShell またはコマンドプロンプトを開いて：

```powershell
docker --version
docker compose version
```

両方ともバージョンが表示されればOKです。

> **WSL2 が未インストールの場合**  
> PowerShell（管理者）で以下を実行後、PCを再起動してください：
> ```powershell
> wsl --install
> ```

---

## 2. Symbol Network Manager のセットアップ

### 2-1. ZIPを展開

配布された `symbol-web-ui.zip` を任意のフォルダに展開します。

例：`C:\symbol-web-ui`

### 2-2. 環境変数ファイルの準備

展開したフォルダ内の `.env.example` を `.env` にコピーします：

```powershell
cd C:\symbol-web-ui
copy .env.example .env
```

> **ストレージパスについて**  
> `.env` ファイル内の `SYMBOL_TARGET_DIR` はブロックチェーンデータの保存先です。  
> Docker Desktop (Windows) では `/var/lib/symbol-target` がデフォルトで推奨です。  
> この領域は Docker Desktop の仮想ディスク (VHDX) 上にあり、大容量（通常 1TB）です。  
> **通常は変更不要です。**

### 2-3. ビルド & 起動

PowerShell で展開したフォルダに移動して実行：

```powershell
cd C:\symbol-web-ui
docker compose up -d
```

初回ビルドには **5〜15分** かかります（インターネット速度に依存）。

> **symbol-bootstrap のインストール元について**  
> デフォルトでは [bootarou/symbol-bootstrap](https://github.com/bootarou/symbol-bootstrap) から  
> インストールされます。別のリポジトリを使用する場合は `.env` に追記してください：  
> ```
> SYMBOL_BOOTSTRAP_REPO=https://github.com/<your-org>/symbol-bootstrap.git
> ```

### 2-4. 起動確認

```powershell
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
3. **Dashboard** タブでパスワードを入力して **Start** ボタンをクリック


### Explorer（ブロックチェーンエクスプローラー）

1. **Config → Explorer** タブで **Build** をクリック（初回のみ、約5分）
2. ビルド完了後、**Start** をクリック
3. http://localhost:8090 でエクスプローラーにアクセス

### ノードの停止

1. **Dashboard** タブで **Stop** ボタンをクリック

---

## 5. 停止 / 再起動 / 完全削除

### アプリの停止

```powershell
cd C:\symbol-web-ui
docker compose down
```

### アプリの再起動

```powershell
cd C:\symbol-web-ui
docker compose up -d
```

### 完全削除（ブロックチェーンデータも含む）

```powershell
cd C:\symbol-web-ui
docker compose down
docker volume prune -f
```

---

## 6. トラブルシューティング

### Docker Desktop が起動しない

- WSL2 がインストールされているか確認：`wsl --status`
- BIOS で仮想化（VT-x / AMD-V）が有効か確認
- Docker Desktop を再インストール

### ビルドが失敗する

```powershell
docker compose build --no-cache
docker compose up -d
```

### ポートが競合する

他のアプリが 4000 / 5173 / 8090 ポートを使用している場合：

```powershell
# 使用中のポートを確認
netstat -ano | findstr :4000
```

`docker-compose.yml` でポートマッピングを変更できます。

### ログの確認

```powershell
docker logs symbol-manager --tail 100 -f
```

### ディスク容量不足

Docker Desktop の Settings → Resources → Disk image size を増やしてください。

---

## 7. アップデート

新しいバージョンの ZIP を受け取った場合：

```powershell
cd C:\symbol-web-ui
docker compose down
```

1. 新しいZIPの内容でファイルを上書き（`.env` と `shared/` フォルダは **そのまま保持**）
2. 再ビルド & 起動：

```powershell
docker compose build --no-cache
docker compose up -d
```

> **注意**: `shared/` フォルダにはプリセット設定やネットワークの構成情報が保存されています。  
> アップデート時に削除しないでください。
