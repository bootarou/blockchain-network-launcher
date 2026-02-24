import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Box,
  Users,
  Shield,
  Server,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  Hash,
  Layers,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Database,
  FolderOpen,
} from 'lucide-react';
import { api } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChainStats {
  height: string | null;
  scoreHigh: string | null;
  scoreLow: string | null;
  latestFinalizedBlock: {
    finalizationEpoch: number;
    finalizationPoint: number;
    height: string;
    hash: string;
  } | null;
}

interface NodeInfo {
  version: string | null;
  publicKey: string | null;
  networkGenerationHashSeed: string | null;
  roles: number | null;
  port: number | null;
  networkIdentifier: number | null;
  friendlyName: string | null;
  host: string | null;
  nodePublicKey: string | null;
}

interface PeerInfo {
  publicKey: string;
  host: string;
  friendlyName: string;
  version: string;
  roles: number;
}

interface NodeStatsData {
  available: boolean;
  timestamp: string;
  chain?: ChainStats;
  node?: NodeInfo;
  peers?: { count: number; list: PeerInfo[] };
  health?: { apiNode: string; db: string };
  server?: { serverInfo: unknown };
}

interface StorageData {
  targetDir: string;
  filesystem: { totalBytes: number; usedBytes: number; availBytes: number };
  target: { usedBytes: number; breakdown: Record<string, number> };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatHeight(h: string | null | undefined): string {
  if (!h) return '—';
  const n = Number(h);
  return isNaN(n) ? h : n.toLocaleString();
}

function formatVersion(v: string | null | undefined): string {
  if (!v) return '—';
  const n = Number(v);
  if (isNaN(n)) return v;
  // Symbol node version is encoded as integer: e.g. 16777990 = 0x01000306 → 1.0.3.6
  const major = (n >>> 24) & 0xff;
  const minor = (n >>> 16) & 0xff;
  const patch = (n >>> 8) & 0xff;
  const build = n & 0xff;
  return `${major}.${minor}.${patch}.${build}`;
}

function roleLabel(roles: number | null | undefined): string {
  if (roles == null) return '—';
  const labels: string[] = [];
  if (roles & 1) labels.push('Peer');
  if (roles & 2) labels.push('API');
  if (roles & 4) labels.push('Voting');
  if (roles & 64) labels.push('IPv4');
  if (roles & 128) labels.push('IPv6');
  return labels.length > 0 ? labels.join(', ') : `Role ${roles}`;
}

function shortKey(key: string | null | undefined): string {
  if (!key) return '—';
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-8)}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'たった今';
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  return `${min}分前`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  color = 'text-indigo-400',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className={color}>{icon}</span>
        {label}
      </div>
      <div className="text-xl font-bold text-zinc-100 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-zinc-500 truncate">{sub}</div>}
    </div>
  );
}

function HealthDot({ status }: { status: string }) {
  const color =
    status === 'up'
      ? 'bg-emerald-400 shadow-emerald-400/40'
      : status === 'down'
        ? 'bg-red-400 shadow-red-400/40'
        : 'bg-zinc-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shadow-lg ${color}`} />;
}

// ── Storage helpers ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function usageColor(percent: number): string {
  if (percent >= 90) return 'text-red-400';
  if (percent >= 75) return 'text-amber-400';
  return 'text-emerald-400';
}

function barColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 75) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function barBgColor(percent: number): string {
  if (percent >= 90) return 'bg-red-950/50';
  if (percent >= 75) return 'bg-amber-950/50';
  return 'bg-emerald-950/50';
}

const BREAKDOWN_ICONS: Record<string, React.ReactNode> = {
  nodes: <Server className="w-3 h-3 text-indigo-400" />,
  databases: <Database className="w-3 h-3 text-violet-400" />,
  docker: <Box className="w-3 h-3 text-sky-400" />,
  gateways: <Wifi className="w-3 h-3 text-teal-400" />,
  nemesis: <Shield className="w-3 h-3 text-amber-400" />,
};

function StorageIndicator({ data }: { data: StorageData }) {
  const { filesystem, target } = data;
  const fsPercent = filesystem.totalBytes > 0
    ? Math.round((filesystem.usedBytes / filesystem.totalBytes) * 100)
    : 0;
  const targetPercent = filesystem.totalBytes > 0
    ? Math.round((target.usedBytes / filesystem.totalBytes) * 100)
    : 0;

  // Sort breakdown by size descending
  const breakdownEntries = Object.entries(target.breakdown)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <HardDrive className={`w-4 h-4 ${usageColor(fsPercent)}`} />
          ストレージ使用状況
        </div>
        <span className="text-xs text-zinc-600 font-mono">{data.targetDir}</span>
      </div>

      {/* Main progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold tracking-tight ${usageColor(fsPercent)}`}>
            {fsPercent}%
          </span>
          <span className="text-xs text-zinc-500">
            {formatBytes(filesystem.usedBytes)} / {formatBytes(filesystem.totalBytes)}
            <span className="text-zinc-600 ml-2">(空き {formatBytes(filesystem.availBytes)})</span>
          </span>
        </div>
        <div className={`w-full h-3 rounded-full ${barBgColor(fsPercent)} overflow-hidden`}>
          <div
            className={`h-full rounded-full ${barColor(fsPercent)} transition-all duration-500`}
            style={{ width: `${Math.min(fsPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Target data usage */}
      <div className="flex items-center justify-between text-xs pt-1">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
          ブロックチェーンデータ
        </div>
        <span className="text-zinc-300 font-semibold">
          {formatBytes(target.usedBytes)}
          <span className="text-zinc-600 font-normal ml-1">({targetPercent}%)</span>
        </span>
      </div>

      {/* Breakdown */}
      {breakdownEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
          {breakdownEntries.map(([dir, size]) => (
            <div
              key={dir}
              className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800/50 rounded-lg px-3 py-1.5"
            >
              {BREAKDOWN_ICONS[dir] || <FolderOpen className="w-3 h-3 text-zinc-500" />}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-400 truncate">{dir}</div>
              </div>
              <span className="text-xs text-zinc-300 font-mono whitespace-nowrap">
                {formatBytes(size)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Warning if usage is high */}
      {fsPercent >= 75 && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${
          fsPercent >= 90
            ? 'bg-red-950/40 border-red-900/50 text-red-400'
            : 'bg-amber-950/40 border-amber-900/50 text-amber-400'
        }`}>
          ⚠️ ストレージの残り容量が{fsPercent >= 90 ? '非常に' : ''}少なくなっています。
          ブロックチェーンの同期を続けるには、ディスク容量の拡張を検討してください。
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function NodeStats() {
  const [stats, setStats] = useState<NodeStatsData | null>(null);
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [peersOpen, setPeersOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [nodeData, storageData] = await Promise.all([
        api.getNodeStats(),
        api.getStorage().catch(() => null),
      ]);
      setStats(nodeData);
      if (storageData && !storageData.error) setStorage(storageData);
    } catch {
      // keep previous stats on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto refresh
  useEffect(() => {
    fetchStats();
    if (!autoRefresh) return;
    const iv = setInterval(fetchStats, 12000);
    return () => clearInterval(iv);
  }, [fetchStats, autoRefresh]);

  // ── Render ─────────────────────────────────────────────────────────────

  const notAvailable = !stats || !stats.available;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          Node Statistics
        </h2>
        <div className="flex items-center gap-3">
          {stats?.timestamp && (
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(stats.timestamp)}
            </span>
          )}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              autoRefresh
                ? 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10'
                : 'border-zinc-700 text-zinc-500'
            }`}
          >
            {autoRefresh ? '自動更新 ON' : '自動更新 OFF'}
          </button>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {notAvailable ? (
        <div className="flex items-center gap-3 py-8 justify-center text-zinc-500">
          <WifiOff className="w-5 h-5" />
          <span>ノードが起動していないか、REST Gateway に接続できません</span>
        </div>
      ) : (
        <>
          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Block Height */}
            <StatCard
              icon={<Layers className="w-4 h-4" />}
              label="ブロック高"
              value={formatHeight(stats.chain?.height)}
              color="text-emerald-400"
            />

            {/* Finalization */}
            <StatCard
              icon={<Shield className="w-4 h-4" />}
              label="ファイナライズ高"
              value={formatHeight(stats.chain?.latestFinalizedBlock?.height)}
              sub={
                stats.chain?.latestFinalizedBlock
                  ? `Epoch ${stats.chain.latestFinalizedBlock.finalizationEpoch} / Point ${stats.chain.latestFinalizedBlock.finalizationPoint}`
                  : undefined
              }
              color="text-violet-400"
            />

            {/* Peer count */}
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="ピア数"
              value={stats.peers ? String(stats.peers.count) : '—'}
              color="text-sky-400"
            />

            {/* Node version */}
            <StatCard
              icon={<Server className="w-4 h-4" />}
              label="ノードバージョン"
              value={formatVersion(stats.node?.version)}
              sub={stats.node?.friendlyName || undefined}
              color="text-amber-400"
            />

            {/* Health: API Node */}
            <StatCard
              icon={<Box className="w-4 h-4" />}
              label="API Node"
              value={stats.health?.apiNode ?? '—'}
              color={stats.health?.apiNode === 'up' ? 'text-emerald-400' : 'text-red-400'}
            />

            {/* Health: DB */}
            <StatCard
              icon={<Hash className="w-4 h-4" />}
              label="Database"
              value={stats.health?.db ?? '—'}
              color={stats.health?.db === 'up' ? 'text-emerald-400' : 'text-red-400'}
            />

            {/* Roles */}
            <StatCard
              icon={<Wifi className="w-4 h-4" />}
              label="ノードロール"
              value={roleLabel(stats.node?.roles)}
              color="text-teal-400"
            />

            {/* Chain Score */}
            <StatCard
              icon={<BarChart3 className="w-4 h-4" />}
              label="チェーンスコア"
              value={
                stats.chain?.scoreHigh && stats.chain?.scoreLow
                  ? `${stats.chain.scoreHigh.slice(0, 8)}…`
                  : '—'
              }
              sub={
                stats.chain?.scoreHigh && stats.chain?.scoreLow
                  ? `High: ${stats.chain.scoreHigh} / Low: ${stats.chain.scoreLow}`
                  : undefined
              }
            />
          </div>

          {/* ── Node Identity ── */}
          {stats.node && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs space-y-1.5">
              <div className="text-zinc-500 font-medium mb-2">ノード情報</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  <span className="text-zinc-500">Public Key: </span>
                  <span className="text-zinc-300 font-mono">{shortKey(stats.node.publicKey)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Node Public Key: </span>
                  <span className="text-zinc-300 font-mono">{shortKey(stats.node.nodePublicKey)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Host: </span>
                  <span className="text-zinc-300">{stats.node.host || '—'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Port: </span>
                  <span className="text-zinc-300">{stats.node.port ?? '—'}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-zinc-500">Generation Hash: </span>
                  <span className="text-zinc-300 font-mono break-all">
                    {stats.node.networkGenerationHashSeed || '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Peers list (collapsible) ── */}
          {stats.peers && stats.peers.count > 0 && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setPeersOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:bg-zinc-900/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" />
                  接続ピア一覧 ({stats.peers.count})
                </span>
                {peersOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {peersOpen && (
                <div className="border-t border-zinc-800 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-zinc-500 bg-zinc-900/50 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Host</th>
                        <th className="text-left px-4 py-2 font-medium">Name</th>
                        <th className="text-left px-4 py-2 font-medium">Version</th>
                        <th className="text-left px-4 py-2 font-medium">Roles</th>
                        <th className="text-left px-4 py-2 font-medium">Health</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {stats.peers.list.map((peer, i) => (
                        <tr key={i} className="hover:bg-zinc-900/30">
                          <td className="px-4 py-2 text-zinc-300 font-mono">
                            {peer.host || '—'}
                          </td>
                          <td className="px-4 py-2 text-zinc-400">{peer.friendlyName || '—'}</td>
                          <td className="px-4 py-2 text-zinc-400">{formatVersion(peer.version)}</td>
                          <td className="px-4 py-2 text-zinc-400">{roleLabel(peer.roles)}</td>
                          <td className="px-4 py-2">
                            <HealthDot status="up" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Storage usage (always shown if data available) ── */}
      {storage && <StorageIndicator data={storage} />}
    </div>
  );
}
