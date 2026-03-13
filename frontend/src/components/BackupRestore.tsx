import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Upload, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileArchive, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BackupStatus {
  canBackup: boolean;
  files: Record<string, boolean>;
  nodeState: string;
}

interface RestoreResult {
  success: boolean;
  restoredFiles: string[];
  message: string;
}

// ─── File label mapping ──────────────────────────────────────────────────────

const FILE_LABELS: Record<string, string> = {
  'custom-preset.yml': 'backup.files.preset',
  'addresses.yml': 'backup.files.addresses',
  'nemesis/seed/': 'backup.files.seed',
  'nemesis/transactions/': 'backup.files.transactions',
};

// ═════════════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════════════

export function BackupRestore() {
  const { t } = useTranslation();

  // ── Backup state ──
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // ── Restore state ──
  const [dragOver, setDragOver] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch backup status ──
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBackupStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ── Backup download handler ──
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = api.getBackupDownloadUrl();
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Small delay to let the download start
      setTimeout(() => setDownloading(false), 2000);
    }
  };

  // ── Restore handler ──
  const handleRestore = async (file: File) => {
    if (!confirm(t('backup.restore.confirm'))) return;

    setRestoring(true);
    setRestoreProgress(0);
    setRestoreResult(null);
    setRestoreError(null);

    try {
      const result = await api.uploadRestore(file, (pct) => {
        setRestoreProgress(pct);
      });
      setRestoreResult(result);
      // Refresh status after restore
      fetchStatus();
    } catch (err: any) {
      setRestoreError(err.message || 'Unknown error');
    } finally {
      setRestoring(false);
    }
  };

  // ── Drag and drop handlers ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) {
      handleRestore(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleRestore(file);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    }
  };

  const isStopped = status?.nodeState === 'stopped';

  return (
    <div className="space-y-8">
      {/* ── Page Header ── */}
      <div>
        <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-teal-400" />
          {t('backup.title')}
        </h2>
        <p className="text-zinc-400 mt-2 text-sm leading-relaxed">
          {t('backup.description')}
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          BACKUP SECTION
          ══════════════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
          <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Download className="w-5 h-5 text-teal-400" />
            {t('backup.section.backup')}
          </h3>
        </div>

        <div className="p-6 space-y-5">
          {/* Status indicator */}
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {t('backup.status.checking')}
            </div>
          ) : status?.canBackup ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              {t('backup.status.ready')}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />
              {t('backup.status.notReady')}
            </div>
          )}

          {/* File status table */}
          {status && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                {t('backup.files.title')}
              </h4>
              <div className="grid gap-2">
                {Object.entries(FILE_LABELS).map(([key, labelKey]) => {
                  const available = status.files[key] ?? false;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50"
                    >
                      <div className="flex items-center gap-3">
                        <FileArchive className="w-4 h-4 text-zinc-500" />
                        <div>
                          <span className="text-sm text-zinc-200">{t(labelKey)}</span>
                          <span className="text-xs text-zinc-600 ml-2">({key})</span>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          available ? 'text-emerald-400' : 'text-zinc-600'
                        }`}
                      >
                        {available ? t('backup.files.available') : t('backup.files.missing')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Security note */}
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-800/30">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              {t('backup.note')}
            </p>
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload}
            disabled={!status?.canBackup || downloading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors
              bg-teal-600 hover:bg-teal-500 text-white
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-teal-600"
          >
            {downloading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {downloading ? t('backup.downloading') : t('backup.download')}
          </button>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          RESTORE SECTION
          ══════════════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
          <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Upload className="w-5 h-5 text-sky-400" />
            {t('backup.section.restore')}
          </h3>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-zinc-400 text-sm">{t('backup.restore.description')}</p>

          {/* Node must be stopped warning */}
          {!isStopped && status && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-950/30 border border-red-800/30">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{t('backup.restore.requireStop')}</p>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => isStopped && !restoring && fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer
              ${dragOver
                ? 'border-sky-400 bg-sky-950/20'
                : isStopped && !restoring
                  ? 'border-zinc-700 bg-zinc-800/30 hover:border-zinc-600 hover:bg-zinc-800/50'
                  : 'border-zinc-800 bg-zinc-900/30 cursor-not-allowed opacity-50'
              }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileSelect}
              disabled={!isStopped || restoring}
            />

            {restoring ? (
              <>
                <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
                <p className="text-sm text-sky-300">
                  {t('backup.restore.uploading', { percent: String(restoreProgress) })}
                </p>
                {/* Progress bar */}
                <div className="w-48 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full transition-all duration-300"
                    style={{ width: `${restoreProgress}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-zinc-500" />
                <p className="text-sm text-zinc-400">
                  {dragOver ? t('backup.restore.dropzoneActive') : t('backup.restore.dropzone')}
                </p>
                <p className="text-xs text-zinc-600">.zip</p>
              </>
            )}
          </div>

          {/* Restore result */}
          {restoreResult && (
            <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {t('backup.restore.success')}
              </div>
              <div className="text-xs text-zinc-400">
                <p className="font-medium mb-1">{t('backup.restore.restoredFiles')}</p>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-500">
                  {restoreResult.restoredFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Restore error */}
          {restoreError && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-950/30 border border-red-800/30">
              <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">
                {t('backup.restore.error', { error: restoreError })}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
