import React, { useState } from 'react';
import {
  BookOpen,
  Rocket,
  Monitor,
  Settings,
  Globe,
  LayoutDashboard,
  HelpCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Server,
  RefreshCw,
  Trash2,
  Play,
  Square,
  Activity,
} from 'lucide-react';

// ── Collapsible Section ──────────────────────────────────────────────────────

function Section({
  id,
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-indigo-400 shrink-0" />
        <span className="font-semibold text-zinc-100 flex-1">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        )}
      </button>
      {open && <div className="px-5 py-4 space-y-4 text-sm text-zinc-300 leading-relaxed">{children}</div>}
    </section>
  );
}

// ── Mini Table ───────────────────────────────────────────────────────────────

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 border-b border-zinc-700 text-zinc-400 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-zinc-800/50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, color = 'zinc' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    red: 'bg-red-900/50 text-red-300 border-red-800',
    yellow: 'bg-amber-900/50 text-amber-300 border-amber-800',
    zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    indigo: 'bg-indigo-900/50 text-indigo-300 border-indigo-800',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${colors[color] ?? colors.zinc}`}>
      {children}
    </span>
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}

// ── Main Help Page ───────────────────────────────────────────────────────────

export function HelpPage() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <BookOpen className="w-7 h-7 text-indigo-400" />
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">ヘルプ・マニュアル</h2>
          <p className="text-zinc-500 text-sm">Symbol Network Manager の使い方</p>
        </div>
      </div>

      {/* Quick TOC */}
      <nav className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">目次</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {[
            { label: 'クイックスタート', href: '#quickstart', icon: Rocket },
            { label: '画面の説明', href: '#screens', icon: Monitor },
            { label: 'ネットワーク参加', href: '#join', icon: Globe },
            { label: 'ボタンの説明', href: '#buttons', icon: LayoutDashboard },
            { label: 'リセットの違い', href: '#reset', icon: RefreshCw },
            { label: 'トラブルシューティング', href: '#trouble', icon: AlertTriangle },
          ].map(({ label, href, icon: I }) => (
            <a
              key={href}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-200"
            >
              <I className="w-4 h-4" />
              {label}
            </a>
          ))}
        </div>
      </nav>

      {/* ── Sections ── */}

      <Section id="quickstart" title="クイックスタート" icon={Rocket} defaultOpen>
        <p>カスタム Symbol ネットワークにノードとして参加するまでの手順です。</p>

        <div className="space-y-4 mt-2">
          <Step n={1}>
            <strong>Docker Compose で起動</strong>
            <div className="mt-1 bg-zinc-900 rounded-lg px-4 py-2 font-mono text-xs text-zinc-400">
              docker compose up -d --build
            </div>
            <p className="mt-1 text-zinc-500">ブラウザで <code className="text-indigo-400">http://localhost:4000</code> にアクセス</p>
          </Step>

          <Step n={2}>
            <strong>「Join Network」タブでソースノードの URL を入力</strong>
            <p className="text-zinc-500">例: <code className="text-indigo-400">http://192.168.0.33:3000</code></p>
            <p className="text-zinc-500">「取得」ボタンでネットワーク設定を自動取得します。</p>
          </Step>

          <Step n={3}>
            <strong>Seed ファイルをインポート（推奨）</strong>
            <p className="text-zinc-500">
              ネットワーク管理者から受け取った nemesis seed ファイルをドラッグ＆ドロップします。
              最低限 <Badge>00001.dat</Badge> が必要です。
            </p>
          </Step>

          <Step n={4}>
            <strong>「設定に反映」→「Dashboard」タブで Start</strong>
            <p className="text-zinc-500">
              パスワードを入力して Start ボタンを押すと、設定生成→コンテナ起動→ブロック同期が自動実行されます。
            </p>
          </Step>

          <Step n={5}>
            <strong>ヘルスチェックが緑になれば成功！</strong>
            <p className="text-zinc-500">
              ヘッダー右上のインジケーターが <Badge color="green">apiNode: up</Badge>{' '}
              <Badge color="green">db: up</Badge> になれば正常です。
            </p>
          </Step>
        </div>
      </Section>

      <Section id="screens" title="画面の説明" icon={Monitor}>
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <Globe className="w-4 h-4 text-emerald-400" />
              Join Network
            </h4>
            <p>
              既存のカスタムネットワークに参加するための画面です。
              ソースノードの REST API URL を入力してネットワーク設定を自動取得し、
              Seed ファイルのインポートも行えます。
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <Settings className="w-4 h-4 text-indigo-400" />
              Configuration
            </h4>
            <p>
              ノードの詳細設定を行う画面です。Join Network から自動反映された値を確認・修正できます。
              Preset / Assembly / Catapult Version / ノード名 / 各種鍵などを設定します。
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <LayoutDashboard className="w-4 h-4 text-indigo-400" />
              Dashboard
            </h4>
            <p>
              ノードの操作・監視を行うメイン画面です。Start/Stop/Reset 等の操作ボタンと、
              リアルタイムのターミナルログを表示します。設定の YAML/JSON エクスポート・インポートも可能です。
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              Help（このページ）
            </h4>
            <p>使い方やトラブルシューティング情報を表示します。</p>
          </div>
        </div>
      </Section>

      <Section id="join" title="ネットワーク参加の詳細" icon={Globe}>
        <h4 className="font-semibold text-zinc-100 mb-2">必要な Seed ファイル</h4>
        <Table
          headers={['ファイル名', '必須', '内容']}
          rows={[
            ['00001.dat', <Badge color="red">必須</Badge>, 'Nemesis ブロックデータ'],
            ['00001.stmt', <Badge color="yellow">推奨</Badge>, 'Nemesis ブロックステートメント'],
            ['hashes.dat', <Badge color="yellow">推奨</Badge>, 'ブロックハッシュ（GenerationHash + EntityHash）'],
            ['proof.index.dat', <Badge color="zinc">任意</Badge>, 'ファイナライゼーションインデックス（自動生成可）'],
            ['00001.proof', <Badge color="zinc">任意</Badge>, 'ファイナライゼーション証明'],
            ['proof.heights.dat', <Badge color="zinc">任意</Badge>, '証明の高さデータ'],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">Catapult バージョンの選択</h4>
        <p>
          ソースノードと<strong>同じバージョン</strong>を使用してください。
          バージョンが異なると、設定プロパティ数の不一致やブロック検証エラーが発生します。
        </p>
        <Table
          headers={['バージョン', 'イメージ', '備考']}
          rows={[
            ['v2', 'gcc-1.0.3.6', 'Ubuntu 22.04 / OpenSSL 3 ネイティブ'],
            ['v3', 'gcc-1.0.3.9', 'パッチイメージ自動ビルド（OpenSSL 互換レイヤー）'],
          ]}
        />
      </Section>

      <Section id="buttons" title="ボタンの説明" icon={LayoutDashboard}>
        <h4 className="font-semibold text-zinc-100 mb-2">Dashboard 操作ボタン</h4>
        <Table
          headers={['ボタン', '説明']}
          rows={[
            [
              <span className="flex items-center gap-1.5"><Play className="w-3.5 h-3.5 text-emerald-400" /> Start</span>,
              '設定生成 → コンテナ起動 → ヘルスチェック。パスワードの入力が必要です。',
            ],
            [
              <span className="flex items-center gap-1.5"><Square className="w-3.5 h-3.5 text-red-400" /> Stop</span>,
              'コンテナを停止。データと設定は全て保持されます。',
            ],
            [
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-blue-400" /> Health Check</span>,
              'symbol-bootstrap healthCheck を実行してノードの状態を確認。',
            ],
            [
              <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-zinc-400" /> Reset</span>,
              'ネットワークデータ（ブロック・DB）のみ削除。設定と証明書は保持。同じネットワークにゼロから再同期したい場合に使用。',
            ],
            [
              <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-red-400" /> 完全初期化</span>,
              '全設定・全データ・証明書・Seed を削除して初期状態に。別のネットワークに切り替える場合に使用。',
            ],
          ]}
        />
      </Section>

      <Section id="reset" title="リセット操作の違い" icon={RefreshCw}>
        <Table
          headers={['操作', '設定ファイル', 'ブロックデータ', '証明書・鍵', 'Seed', '用途']}
          rows={[
            [
              <strong>Stop → Start</strong>,
              <Badge color="green">保持</Badge>,
              <Badge color="green">保持</Badge>,
              <Badge color="green">保持</Badge>,
              <Badge color="green">保持</Badge>,
              '単純な再起動',
            ],
            [
              <strong>Reset → Start</strong>,
              <Badge color="green">保持</Badge>,
              <Badge color="red">削除</Badge>,
              <Badge color="green">保持</Badge>,
              <Badge color="green">保持</Badge>,
              '同じネットワークに再同期',
            ],
            [
              <strong>完全初期化</strong>,
              <Badge color="red">全削除</Badge>,
              <Badge color="red">全削除</Badge>,
              <Badge color="red">全削除</Badge>,
              <Badge color="red">全削除</Badge>,
              '別ネットワークに切り替え',
            ],
          ]}
        />
      </Section>

      <Section id="trouble" title="トラブルシューティング" icon={AlertTriangle}>
        <div className="space-y-5">
          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">apiNode が「down」のまま</h4>
            <p className="mb-2">
              REST gateway と api-node 間の TLS 接続に問題がある可能性があります。
            </p>
            <p>
              <strong>対処法：</strong> 「完全初期化」→ Seed ファイルを再インポート →「Start」でやり直してください。
            </p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-red-300 mb-2">Segmentation fault (exit code 139)</h4>
            <p className="mb-2">
              proof.index.dat のフォーマット不正が主な原因です。
            </p>
            <p>
              <strong>対処法：</strong> 「完全初期化」→ Seed ファイルを再インポート → 「Start」でやり直してください。
              最新版では proof.index.dat を正しい 48 バイト形式で自動生成するため、通常発生しません。
            </p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">Failure_Chain_Block_Unknown_Signer</h4>
            <p className="mb-2">
              nemesis ブロックのトランザクションが正しく処理されず、アカウントステートキャッシュにハーベスティング鍵が登録されていません。
            </p>
            <p>
              <strong>対処法：</strong> 「完全初期化」→ 正しい Seed ファイルをインポートし直す → 「Start」で再起動。
            </p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">ブロック同期が進まない</h4>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>ソースノードがダウンしていないか確認</li>
              <li>ファイアウォールでポート 7900 がブロックされていないか確認</li>
              <li>Catapult バージョンがソースノードと一致しているか確認</li>
              <li>ターミナルログで <code className="text-indigo-400">Accepted</code> が出ているか確認</li>
            </ul>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">コンテナが起動しない</h4>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Docker Desktop が起動しているか確認</li>
              <li>ディスク容量に余裕があるか確認</li>
              <li>ターミナルログでエラーメッセージを確認</li>
              <li>「完全初期化」→ 「Start」でやり直す</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="tech" title="技術仕様" icon={Server}>
        <h4 className="font-semibold text-zinc-100 mb-2">使用技術</h4>
        <Table
          headers={['レイヤー', '技術']}
          rows={[
            ['Frontend', 'React 19 + Vite + Tailwind CSS v4 + TypeScript'],
            ['Backend', 'Node.js + Express 5 + WebSocket'],
            ['Bootstrap', 'symbol-bootstrap 1.1.10'],
            ['Server V2', 'symbolplatform/symbol-server:gcc-1.0.3.6'],
            ['Server V3', 'symbolplatform/symbol-server:gcc-1.0.3.9'],
            ['REST', 'symbolplatform/symbol-rest:2.4.2'],
            ['Database', 'MongoDB 5.0.15'],
            ['Container', 'Docker-in-Docker (DinD)'],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">ポート一覧</h4>
        <Table
          headers={['ポート', '用途']}
          rows={[
            ['4000', 'Symbol Network Manager Web UI / API'],
            ['7900', 'Symbol P2P ノード通信'],
            ['3000', 'Symbol REST API'],
            ['27017', 'MongoDB（内部のみ）'],
            ['7902', 'ZeroMQ（内部のみ）'],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">アーキテクチャ</h4>
        <div className="bg-zinc-900 rounded-lg p-4 font-mono text-xs text-zinc-400 whitespace-pre overflow-x-auto">{`Host (Windows/macOS/Linux)
└─ symbol-manager (Docker Container)
   ├─ Frontend (React + Vite)     ← port 4000
   ├─ Backend  (Express + WS)     ← port 4000
   └─ V2 Containers (DinD)
      ├─ api-node-0               ← port 7900
      ├─ broker
      ├─ rest-gateway             ← port 3000
      └─ db (MongoDB)`}</div>
      </Section>
    </div>
  );
}
