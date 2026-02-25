import React, { useState, useEffect, useCallback } from 'react';
import {
  Share2,
  Download,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Shield,
  Package,
  Globe,
  Hash,
  Clock,
  FileArchive,
  Info,
  Server,
  ChevronDown,
  ChevronRight,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import type { PresetConfig } from '../constants';
import { DEFAULT_PRESET } from '../constants';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

interface ShareNetworkProps {
  onConfigImport: (config: PresetConfig) => void;
}

interface ShareStatus {
  canExport: boolean;
  hasPreset: boolean;
  hasMeta: boolean;
  hasSeed: boolean;
  seedSource: 'imported' | 'generated' | 'none';
  networkName: string;
  generationHashSeed: string;
  detectedIp: string;
  nodeRestPort: string;
}

interface ImportResult {
  success: boolean;
  metadata: Record<string, unknown>;
  config: Record<string, unknown>;
  seedFiles: string[];
}

export function ShareNetwork({ onConfigImport }: ShareNetworkProps) {
  // ── Export state ──
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [sourceNodeHint, setSourceNodeHint] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [showSecurityWarning, setShowSecurityWarning] = useState(false);

  // ── Import state ──
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showImportDetails, setShowImportDetails] = useState(false);

  // Fetch share status on mount
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await api.getShareStatus();
      setStatus(s);
      if (s.detectedIp && !sourceNodeHint) {
        setSourceNodeHint(`http://${s.detectedIp}:${s.nodeRestPort || '3000'}`);
      }
    } catch {
      /* ignore */
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // ── Export handler ──
  const handleExport = () => {
    setShowSecurityWarning(true);
  };

  const handleConfirmExport = async () => {
    setShowSecurityWarning(false);
    setExporting(true);
    setExportDone(false);
    try {
      const url = api.getShareExportUrl(sourceNodeHint || undefined);
      // Trigger browser download
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setExportDone(true);
    } catch {
      /* error handled by browser */
    } finally {
      setExporting(false);
    }
  };

  // ── Import handler ──
  const handleImportFile = async (file: File) => {
    if (!file.name.endsWith('.zip') && !file.name.includes('.symbol-network')) {
      setImportError('ZIPファイル (.symbol-network.zip) を選択してください。');
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setApplied(false);
    try {
      const result = await api.importSharePackage(file);
      setImportResult(result);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleApplyConfig = () => {
    if (!importResult?.config) return;
    const merged = { ...DEFAULT_PRESET, ...importResult.config } as PresetConfig;
    onConfigImport(merged);
    setApplied(true);
  };

  const handleClearImport = () => {
    setImportResult(null);
    setImportError(null);
    setApplied(false);
    setShowImportDetails(false);
  };

  return (
    <div className="space-y-8">
      {/* ═══════════════════════════════════════════════════════════════════
          EXPORT SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-sky-400" />
            ネットワーク共有パッケージ
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            構築したカスタムネットワークを他のユーザーと共有します。
            カスタムプリセット、ネメシスSeedデータ、接続先情報を1つのZIPファイルにパッケージングします。
          </p>
        </div>

        {/* Status card */}
        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            共有ステータスを確認中...
          </div>
        ) : status ? (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
            {/* Status header */}
            <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-medium text-zinc-200">エクスポート準備状況</span>
              </div>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  status.canExport
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                    : 'bg-amber-950/60 text-amber-400 border border-amber-800'
                )}
              >
                {status.canExport ? '✓ エクスポート可能' : '⚠ 準備不足'}
              </span>
            </div>

            <div className="p-4 space-y-4">
              {/* Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatusItem ok={status.hasPreset} label="カスタムプリセット" />
                <StatusItem ok={status.hasSeed} label={`ネメシスSeed (${status.seedSource === 'imported' ? 'インポート済' : status.seedSource === 'generated' ? '自動生成' : '未取得'})`} />
                <StatusItem ok={status.hasMeta} label="UIメタデータ" />
              </div>

              {/* Network info */}
              {status.canExport && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {status.networkName && (
                      <InfoCard icon={<Globe className="w-3.5 h-3.5 text-sky-400" />} label="ネットワーク名" value={status.networkName} />
                    )}
                    {status.generationHashSeed && (
                      <InfoCard
                        icon={<Hash className="w-3.5 h-3.5 text-indigo-400" />}
                        label="Generation Hash"
                        value={truncateHex(status.generationHashSeed)}
                      />
                    )}
                  </div>

                  {/* Source node hint input */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      接続先ノードURL（参加者がピア接続に使用）
                    </label>
                    <input
                      type="text"
                      value={sourceNodeHint}
                      onChange={(e) => {
                        setSourceNodeHint(e.target.value);
                        setExportDone(false);
                      }}
                      placeholder="http://your-server-ip:3000"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-600"
                    />
                    <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded-md px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">自動検出されたIPアドレスが正しいか確認してください。</p>
                        <p className="text-amber-400/60 mt-0.5">
                          Docker環境ではホスト内部IPが検出される場合があります。
                          外部から接続可能なグローバルIP / ドメイン名に変更してください。
                          ポートのデフォルトは 3000（REST Gateway）です。
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Export button */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {exporting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      ZIPパッケージをダウンロード
                    </button>
                    {exportDone && (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ダウンロード開始
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* Not ready message */}
              {!status.canExport && (
                <div className="flex items-start gap-2 text-xs text-zinc-400 bg-zinc-800/50 rounded-md px-3 py-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    ネットワークをConfigurationタブで設定し、Dashboardから起動してください。
                    起動後にネメシスSeedが生成され、エクスポートが可能になります。
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Security warning modal */}
        {showSecurityWarning && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
              <div className="px-5 py-4 bg-amber-950/30 border-b border-amber-900/40 flex items-center gap-3">
                <Shield className="w-6 h-6 text-amber-400" />
                <h3 className="text-base font-bold text-amber-200">セキュリティに関する注意</h3>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm text-zinc-300">
                <p>この共有パッケージには以下が含まれます：</p>
                <ul className="space-y-1.5 text-xs text-zinc-400 list-inside">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    カスタムプリセット（ネットワークパラメータ全体）
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    ネメシスSeedデータ（ジェネシスブロック）
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    接続先ノードURL
                  </li>
                </ul>
                <div className="bg-amber-950/30 border border-amber-900/30 rounded-md px-3 py-2 text-xs text-amber-300/80">
                  <p className="font-medium text-amber-300">⚠ 秘密鍵は含まれません</p>
                  <p className="mt-1">
                    ノードの秘密鍵やaddresses.ymlは含まれません。
                    ただし、ネットワーク設定はネットワークの構造を知る手がかりになるため、
                    信頼できる相手にのみ共有してください。
                  </p>
                </div>
              </div>
              <div className="px-5 py-3 bg-zinc-950/50 border-t border-zinc-800 flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowSecurityWarning(false)}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleConfirmExport}
                  className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  エクスポートする
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="border-t border-zinc-800" />

      {/* ═══════════════════════════════════════════════════════════════════
          IMPORT SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-400" />
            共有パッケージをインポート
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            ネットワーク管理者から受け取った <code className="text-zinc-400">.symbol-network.zip</code> ファイルをインポートして、
            同じカスタムネットワークに参加するための設定を一括で取り込みます。
          </p>
        </div>

        {/* Import result display */}
        {importResult ? (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden space-y-0">
            <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">インポート成功</span>
              </div>
              <button
                onClick={handleClearImport}
                className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                クリア
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Metadata summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniCard
                  label="ネットワーク"
                  value={String(importResult.metadata.networkName || '—')}
                />
                <MiniCard
                  label="Catapult"
                  value={String(importResult.metadata.catapultVersion || '—')}
                />
                <MiniCard
                  label="エクスポート日時"
                  value={formatExportDate(String(importResult.metadata.exportedAt || ''))}
                />
                <MiniCard
                  label="Seedファイル数"
                  value={String(importResult.seedFiles.length)}
                />
              </div>

              {/* Generation Hash */}
              {String(importResult.metadata.generationHashSeed || '') !== '' && (
                <div className="flex items-center gap-2 text-xs">
                  <Hash className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-zinc-500">Generation Hash:</span>
                  <span className="text-zinc-300 font-mono">
                    {truncateHex(String(importResult.metadata.generationHashSeed))}
                  </span>
                </div>
              )}

              {/* Source node hint */}
              {String(importResult.metadata.sourceNodeHint || '') !== '' && (
                <div className="flex items-center gap-2 text-xs">
                  <Server className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-zinc-500">接続先ノード:</span>
                  <span className="text-zinc-300 font-mono">
                    {String(importResult.metadata.sourceNodeHint)}
                  </span>
                </div>
              )}

              {/* Details toggle */}
              <button
                onClick={() => setShowImportDetails(!showImportDetails)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showImportDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                インポートされたファイル詳細
              </button>
              {showImportDetails && (
                <div className="bg-zinc-800/50 rounded-md px-3 py-2 text-xs font-mono text-zinc-400 space-y-0.5 max-h-40 overflow-y-auto">
                  {importResult.seedFiles.map((f) => (
                    <div key={f} className="flex items-center gap-1.5">
                      <FileArchive className="w-3 h-3 text-emerald-500" />
                      {f}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <FileArchive className="w-3 h-3 text-sky-500" />
                    custom-preset.yml
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileArchive className="w-3 h-3 text-sky-500" />
                    ui-meta.json
                  </div>
                </div>
              )}

              {/* Apply button */}
              <div className="flex items-center gap-4 pt-1">
                <button
                  onClick={handleApplyConfig}
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
                      Configurationに反映済み
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
                    Configurationタブで設定を確認し、DashboardでStartしてください
                  </span>
                )}
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
              'relative border-2 border-dashed rounded-lg px-6 py-10 text-center transition-colors cursor-pointer',
              isDragOver
                ? 'border-emerald-500 bg-emerald-950/20'
                : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/50'
            )}
          >
            <input
              type="file"
              accept=".zip"
              onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            {importing ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
                <p className="text-sm text-zinc-400">パッケージを展開中...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <FileArchive className="w-10 h-10 text-zinc-500" />
                <div>
                  <p className="text-sm text-zinc-300">
                    .symbol-network.zip ファイルをドラッグ＆ドロップ、またはクリックして選択
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">
                    プリセット設定・ネメシスSeed・接続先情報が一括でインポートされます
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import error */}
        {importError && (
          <div className="flex items-start gap-3 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-300">インポートに失敗しました</p>
              <p className="text-xs text-red-400/80 mt-0.5">{importError}</p>
            </div>
          </div>
        )}

        {/* How-to section */}
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer hover:text-zinc-400 transition-colors">
            共有パッケージの使い方
          </summary>
          <div className="mt-2 pl-3 border-l-2 border-zinc-800 space-y-2 text-zinc-500">
            <p className="font-medium text-zinc-400">📤 ネットワーク管理者（エクスポートする側）：</p>
            <ol className="list-decimal list-inside space-y-1 pl-2">
              <li>Configurationタブでカスタムネットワークを設定</li>
              <li>DashboardからStartしてネットワークを起動</li>
              <li>このタブでエクスポートして .symbol-network.zip をダウンロード</li>
              <li>参加者にZIPファイルを配布</li>
            </ol>
            <p className="font-medium text-zinc-400 mt-2">📥 参加者（インポートする側）：</p>
            <ol className="list-decimal list-inside space-y-1 pl-2">
              <li>受け取った .symbol-network.zip をこのタブにドロップ</li>
              <li>「Configurationに反映」をクリック</li>
              <li>Configurationタブで設定を確認（必要に応じて調整）</li>
              <li>DashboardからStartで参加完了</li>
            </ol>
          </div>
        </details>
      </section>
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────

function StatusItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-zinc-600 shrink-0" />
      )}
      <span className={ok ? 'text-zinc-200' : 'text-zinc-500'}>{label}</span>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-md px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-0.5">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium text-zinc-200 truncate font-mono">{value}</p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-md px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-200 truncate">{value}</p>
    </div>
  );
}

function truncateHex(s: string): string {
  if (s.length > 20) return s.slice(0, 12) + '…' + s.slice(-6);
  return s;
}

function formatExportDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
