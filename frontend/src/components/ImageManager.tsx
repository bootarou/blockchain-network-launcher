import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package,
  Download,
  Upload,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server,
  Database,
  Globe,
  HardDrive,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface DockerImage {
  repository: string;
  tag: string;
  size: string;
  id: string;
  created: string;
  fullName: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function imageIcon(repo: string) {
  if (repo.includes('symbol-server') || repo.includes('catapult'))
    return <Server className="w-4 h-4 text-indigo-400" />;
  if (repo.includes('symbol-rest'))
    return <Globe className="w-4 h-4 text-emerald-400" />;
  if (repo.includes('mongo'))
    return <Database className="w-4 h-4 text-amber-400" />;
  return <Package className="w-4 h-4 text-zinc-400" />;
}

function imageCategory(repo: string): string {
  if (repo.includes('symbol-server') || repo.includes('catapult')) return 'Catapult Server';
  if (repo.includes('symbol-rest')) return 'REST Gateway';
  if (repo.includes('mongo')) return 'MongoDB';
  if (repo.includes('explorer')) return 'Explorer';
  if (repo.includes('faucet')) return 'Faucet';
  if (repo.includes('agent')) return 'Agent';
  return 'Other';
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImageManager() {
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getImages();
      setImages(data.images || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // ── Export (download tar) ──────────────────────────────────────────────

  const handleExport = (image: string) => {
    const url = api.getImageExportUrl(image);
    // Open in new tab — browser handles the large download with progress
    window.open(url, '_blank');
  };

  // ── Import (upload tar) ────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImport(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportProgress(0);
    setMessage(null);
    try {
      const result = await api.importImage(file, (pct) => setImportProgress(pct));
      setMessage({
        type: 'success',
        text: result.output || 'イメージをロードしました',
      });
      // Refresh the list
      await fetchImages();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'インポートに失敗しました',
      });
    } finally {
      setImporting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const totalSize = images.length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/30 transition-colors"
      >
        <h2 className="text-lg font-bold flex items-center gap-2 text-zinc-100">
          <Package className="w-5 h-5 text-purple-400" />
          Docker Images
          <span className="text-sm font-normal text-zinc-500 ml-1">
            ({totalSize} images)
          </span>
        </h2>
        <div className="flex items-center gap-3">
          {/* Quick summary when collapsed */}
          {!expanded && images.length > 0 && (
            <span className="text-xs text-zinc-500 hidden sm:inline">
              {images.filter((i) => i.repository.includes('symbol-server')).length} server,{' '}
              {images.filter((i) => i.repository.includes('symbol-rest')).length} REST
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-4 border-t border-zinc-800">
          {/* Toolbar */}
          <div className="flex items-center gap-3 pt-4">
            <label className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Import .tar
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            <button
              onClick={fetchImages}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              更新
            </button>

            <p className="text-xs text-zinc-600 ml-auto hidden sm:block">
              DockerHubからの消失に備えて、イメージをtarファイルにバックアップできます
            </p>
          </div>

          {/* Import progress */}
          {importing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-purple-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  イメージをインポート中... {importProgress > 0 ? `${importProgress}%` : ''}
                </span>
              </div>
              <div className="w-full h-2 bg-purple-950/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <p className="text-xs text-zinc-600">
                アップロード完了後、docker load の処理に時間がかかります。ターミナルログで進捗を確認できます。
              </p>
            </div>
          )}

          {/* Message */}
          {message && (
            <div
              className={`flex items-start gap-2 text-sm px-4 py-3 rounded-lg border ${
                message.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-300'
                  : 'bg-red-950/40 border-red-900/50 text-red-300'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="break-all">{message.text}</span>
              <button
                onClick={() => setMessage(null)}
                className="ml-auto text-xs opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )}

          {/* Image list */}
          {loading && images.length === 0 ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-sm">
              <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Symbol関連のDockerイメージが見つかりません
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/60 text-zinc-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">イメージ</th>
                    <th className="text-left px-4 py-2.5 font-medium">タグ</th>
                    <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">
                      カテゴリ
                    </th>
                    <th className="text-right px-4 py-2.5 font-medium">サイズ</th>
                    <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">
                      作成
                    </th>
                    <th className="text-right px-4 py-2.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {images.map((img) => (
                    <tr key={img.fullName} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {imageIcon(img.repository)}
                          <span className="text-zinc-200 font-mono text-xs truncate max-w-[200px]">
                            {img.repository}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 font-mono text-xs">
                        {img.tag}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs hidden sm:table-cell">
                        {imageCategory(img.repository)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-300 text-xs font-mono">
                        {img.size}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600 text-xs hidden md:table-cell">
                        {img.created}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleExport(img.fullName)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 rounded-md transition-colors border border-indigo-500/30"
                          title={`${img.fullName} を .tar にエクスポート`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Help text */}
          <div className="text-xs text-zinc-600 space-y-1 pt-1">
            <p>
              <strong className="text-zinc-500">Export:</strong>{' '}
              イメージを <code className="text-zinc-500">.tar</code> ファイルとしてダウンロード（1-2 GB/イメージ）
            </p>
            <p>
              <strong className="text-zinc-500">Import:</strong>{' '}
              バックアップした <code className="text-zinc-500">.tar</code> ファイルをアップロードしてDockerにロード
            </p>
            <p>
              <strong className="text-zinc-500">復元手順:</strong>{' '}
              .tar をインポート → Configuration の Images カテゴリでイメージ名を設定 → Start
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
