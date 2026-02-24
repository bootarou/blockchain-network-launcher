import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Server,
  Users,
  Hash,
  Clock,
  Coins,
  ChevronDown,
  ChevronRight,
  Upload,
  FolderOpen,
  Trash2,
  FileCheck,
  HardDrive,
} from 'lucide-react';
import type { PresetConfig } from '../constants';
import { DEFAULT_PRESET } from '../constants';
import { api } from '../lib/api';
import { networkPropertiesToConfig } from '../lib/utils';
import { cn } from '../lib/utils';

interface JoinNetworkProps {
  onConfigImport: (config: PresetConfig) => void;
}

interface FetchResult {
  partial: Partial<PresetConfig>;
  raw: {
    networkProperties: Record<string, unknown>;
    nodeInfo: Record<string, unknown>;
    peers: Record<string, unknown>[];
  };
}

// Pre-defined known Symbol endpoints
const KNOWN_NODES = [
  { label: 'Mainnet (symbol.services)', url: 'http://wolf.importance.jp:3000' },
  { label: 'Mainnet (allnodes)', url: 'http://symbol-mainnet.allnodes.me:3000' },
  { label: 'Testnet (401-sai-dual)', url: 'http://401-sai-dual.symboltest.net:3000' },
];

export function JoinNetwork({ onConfigImport }: JoinNetworkProps) {
  const [nodeUrl, setNodeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [applied, setApplied] = useState(false);

  // --- Seed import state ---
  const [seedStatus, setSeedStatus] = useState<{
    imported: boolean;
    ready: boolean;
    files: Record<string, number>;
    requiredFiles: string[];
    optionalFiles: string[];
  } | null>(null);
  const [seedUploading, setSeedUploading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Fetch seed status on mount
  const refreshSeedStatus = useCallback(async () => {
    try {
      const status = await api.getSeedStatus();
      setSeedStatus(status);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshSeedStatus(); }, [refreshSeedStatus]);

  // Handle seed file upload (via file picker or drag&drop)
  const handleSeedFiles = async (fileList: FileList) => {
    setSeedUploading(true);
    setSeedError(null);
    try {
      const allowed = new Set([
        '00001.dat', '00001.stmt', 'hashes.dat',
        '00001.proof', 'proof.heights.dat',
        'index.dat', 'proof.index.dat',
        // Also accept data-format files (backend will strip 800B header)
        '00000.dat', '00000.stmt', '00000.proof',
      ]);
      const files: { name: string; data: string }[] = [];

      for (const file of Array.from(fileList)) {
        if (!allowed.has(file.name)) continue;
        const buf = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')
        );
        files.push({ name: file.name, data: base64 });
      }

      if (files.length === 0) {
        setSeedError('有効なseedファイルが見つかりません。00001.dat (または 00000.dat), 00001.stmt (または 00000.stmt), hashes.dat が必要です。');
        return;
      }

      await api.uploadSeedFiles(files);
      await refreshSeedStatus();
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeedUploading(false);
    }
  };

  const handleClearSeed = async () => {
    if (!confirm('インポートしたseedファイルを削除しますか？')) return;
    try {
      await api.clearSeed();
      await refreshSeedStatus();
      setSeedError(null);
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleSeedFiles(e.dataTransfer.files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFetch = async () => {
    const url = nodeUrl.trim();
    if (!url) {
      setError('ノードURLを入力してください');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setApplied(false);

    try {
      const data = await api.fetchNetworkFromNode(url);

      const partial = networkPropertiesToConfig(
        data.networkProperties,
        data.nodeInfo,
        data.peers
      );

      setResult({
        partial,
        raw: {
          networkProperties: data.networkProperties,
          nodeInfo: data.nodeInfo,
          peers: data.peers,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    // Include the source node URL so backend can build correct peer files
    const merged = { ...DEFAULT_PRESET, ...result.partial, sourceNodeUrl: nodeUrl.trim() } as PresetConfig;
    onConfigImport(merged);
    setApplied(true);
  };

  const handleSelectKnown = (url: string) => {
    setNodeUrl(url);
    setResult(null);
    setApplied(false);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* ── Heading ── */}
      <div>
        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-400" />
          既存ネットワークに参加
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          稼働中のSymbolノードURLを入力して、そのネットワークの設定を取得します。
          取得した設定をConfigurationに反映して、同じネットワークに参加するノードを構築できます。
        </p>
      </div>

      {/* ── Known Nodes ── */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-zinc-500 self-center mr-1">既知ノード:</span>
        {KNOWN_NODES.map((n) => (
          <button
            key={n.url}
            onClick={() => handleSelectKnown(n.url)}
            className={cn(
              'px-3 py-1 rounded-md text-xs border transition-colors',
              nodeUrl === n.url
                ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
            )}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* ── URL input ── */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={nodeUrl}
            onChange={(e) => {
              setNodeUrl(e.target.value);
              setResult(null);
              setApplied(false);
              setError(null);
            }}
            placeholder="http://node-hostname:3000"
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg px-4 py-2.5 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-600"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFetch();
            }}
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={loading || !nodeUrl.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          取得
        </button>
      </div>

      {/* ── Nemesis Seed Import ── */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-zinc-200">ネメシスSeedデータ</span>
          </div>
          {seedStatus?.imported && (
            <button
              onClick={handleClearSeed}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              クリア
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-zinc-500 leading-relaxed">
            カスタムネットワークの管理者からジェネシスブロックのseedファイルを入手してインポートしてください。
            ネメシスブロックはネットワーク秘密鍵で署名されており、REST APIからの再構築では完全な一致が困難です。
          </p>
          <details className="text-xs text-zinc-600">
            <summary className="cursor-pointer hover:text-zinc-400 transition-colors">
              管理者向け: Seedファイルの取得方法
            </summary>
            <div className="mt-2 pl-3 border-l-2 border-zinc-800 space-y-1 text-zinc-500">
              <p>symbol-bootstrap の target ディレクトリ内にある以下のファイルを提供してください:</p>
              <code className="block bg-zinc-800/50 rounded px-2 py-1.5 text-zinc-400 font-mono">
                nemesis/seed/00000/00001.dat<br />
                nemesis/seed/00000/00001.stmt<br />
                nemesis/seed/00000/hashes.dat<br />
                nemesis/seed/00000/00001.proof &nbsp;(任意)<br />
              </code>
              <p className="mt-1">
                または <code className="text-zinc-400">data/00000/</code> 内の
                <code className="text-zinc-400">00000.dat</code> から800バイトのヘッダーを除去したものでも可。
              </p>
            </div>
          </details>

          {/* Seed status indicator */}
          {seedStatus?.imported ? (
            <div className="flex items-start gap-3 bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-300">Seedデータ インポート済み</p>
                <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {Object.entries(seedStatus.files).map(([name, size]) => (
                    <div key={name} className="flex items-center gap-1.5 text-xs">
                      <FileCheck className="w-3 h-3 text-emerald-500" />
                      <span className="text-zinc-400 font-mono">{name}</span>
                      <span className="text-zinc-600">{formatBytes(size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Drop zone */
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'relative border-2 border-dashed rounded-lg px-6 py-8 text-center transition-colors cursor-pointer',
                isDragOver
                  ? 'border-amber-500 bg-amber-950/20'
                  : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/50'
              )}
            >
              <input
                type="file"
                multiple
                onChange={(e) => e.target.files && handleSeedFiles(e.target.files)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                accept=".dat,.stmt"
              />
              {seedUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                  <p className="text-sm text-zinc-400">アップロード中...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-zinc-500" />
                  <p className="text-sm text-zinc-300">
                    Seedファイルをドラッグ＆ドロップ、またはクリックして選択
                  </p>
                  <p className="text-xs text-zinc-600">
                    必須: <span className="text-amber-400/80">00001.dat</span>,{' '}
                    <span className="text-amber-400/80">00001.stmt</span>,{' '}
                    <span className="text-amber-400/80">hashes.dat</span>
                    <br />
                    任意: 00001.proof, proof.heights.dat, index.dat
                  </p>
                </div>
              )}
            </div>
          )}

          {seedError && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/30 rounded px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{seedError}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">取得に失敗しました</p>
            <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Hash className="w-4 h-4 text-indigo-400" />}
              label="Network"
              value={String(result.partial.networkType ?? '—')}
              sub={`ID: ${result.partial.networkIdentifier ?? '—'}`}
            />
            <SummaryCard
              icon={<Clock className="w-4 h-4 text-amber-400" />}
              label="Block Target"
              value={String(result.partial.blockGenerationTargetTime ?? '—')}
              sub={`Epoch: ${result.partial.epochAdjustment ?? '—'}`}
            />
            <SummaryCard
              icon={<Coins className="w-4 h-4 text-emerald-400" />}
              label="Currency Mosaic"
              value={truncateHex(String(result.partial.currencyMosaicId ?? '—'))}
              sub={`Divisibility: ${result.partial.maxMosaicDivisibility ?? '—'}`}
            />
            <SummaryCard
              icon={<Users className="w-4 h-4 text-purple-400" />}
              label="Peers Found"
              value={String(result.raw.peers.length)}
              sub={`Nodes: ${(result.partial.nodes ?? []).length} mapped`}
            />
          </div>

          {/* Key properties table */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
              <Server className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium text-zinc-300">取得した主要プロパティ</span>
            </div>
            <div className="divide-y divide-zinc-800/60 max-h-64 overflow-y-auto">
              {Object.entries(result.partial)
                .filter(([k]) => k !== 'nodes' && k !== 'gateways')
                .map(([key, value]) => (
                  <div key={key} className="flex items-center px-4 py-1.5 text-xs hover:bg-zinc-800/40">
                    <span className="w-56 text-zinc-500 truncate">{key}</span>
                    <span className="flex-1 text-zinc-300 truncate font-mono">
                      {typeof value === 'boolean' ? (value ? '✓' : '✗') : String(value)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Peers list */}
          {result.raw.peers.length > 0 && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-medium text-zinc-300">
                  ピアノード ({result.raw.peers.length})
                </span>
              </div>
              <div className="divide-y divide-zinc-800/60 max-h-40 overflow-y-auto">
                {result.raw.peers.slice(0, 20).map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                    <span className="w-8 text-zinc-600">#{i + 1}</span>
                    <span className="flex-1 text-zinc-300 font-mono truncate">
                      {String(p.host ?? '—')}
                    </span>
                    <span className="text-zinc-500">
                      {String(p.friendlyName ?? '')}
                    </span>
                    <span className="text-zinc-600">
                      roles={String(p.roles ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON toggle */}
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showRawJson ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Raw JSON レスポンス
          </button>

          {showRawJson && (
            <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 max-h-64 overflow-auto font-mono whitespace-pre-wrap">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          )}

          {/* Apply button */}
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleApply}
              disabled={applied}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                applied
                  ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800 cursor-default'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              )}
            >
              {applied ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  設定に反映済み
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Configurationに反映
                </>
              )}
            </button>
            {applied && (
              <span className="text-xs text-zinc-500">
                Configuration タブで取得した設定を確認・カスタマイズできます
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold text-zinc-200 truncate">{value}</p>
      <p className="text-xs text-zinc-600 truncate mt-0.5">{sub}</p>
    </div>
  );
}

function truncateHex(s: string): string {
  if (s.length > 16) return s.slice(0, 10) + '…' + s.slice(-4);
  return s;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
