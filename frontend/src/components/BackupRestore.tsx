import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Upload, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileArchive, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { api, type BackupFile } from '../lib/api';
import { FastSyncPanel } from './FastSyncPanel';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BackupStatus {
  canBackup: boolean;
  files: Record<string, boolean>;
  fullBackup?: { available: boolean; bytes: number };
  nodeState: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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
  'harvesters.dat': 'backup.files.harvesters',
};

// ═════════════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════════════

export function BackupRestore() {
  const { t } = useTranslation();

  // ── Backup state ──
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [listError, setListError] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const creating = backups.some(backup => backup.state === 'creating');
  const backupBusy = creating || submitting;
  const [exportKind, setExportKind] = useState<'identity' | 'full' | 'fast-sync'>('identity');
  const fullBackup = exportKind !== 'identity';

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

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api.listBackups();
        if (!disposed) {
          setBackups(data.backups);
          setStatus(previous => previous ? { ...previous, nodeState: data.nodeState } : previous);
          setListError(false);
          setListLoaded(true);
        }
      } catch { if (!disposed) setListError(true); }
      finally { if (!disposed) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  const handleCreate = async () => {
    setSubmitting(true);
    setBackupError(null);
    try {
      const job = await api.createBackup(fullBackup, exportKind === 'fast-sync' ? 'fast-sync' : 'backup');
      setBackups(previous => [job, ...previous.filter(item => item.id !== job.id)]);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('backup.saved.confirmDelete'))) return;
    setBackupError(null);
    try {
      await api.deleteBackup(id);
      setBackups(previous => previous.filter(job => job.id !== id));
    } catch (error) { setBackupError(error instanceof Error ? error.message : String(error)); }
  };

  // ── Restore handler ──
  const handleRestore = async (file: File) => {
    if (status?.nodeState !== 'stopped' || restoring || backupBusy || !listLoaded || listError) return;
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
      // The restored preset replaced the configuration on disk, but the app
      // still holds the PRE-restore config in memory — and Start saves that
      // in-memory config back to disk before launching, which would clobber
      // the restored settings.  Reload so everything re-reads from disk.
      setTimeout(() => window.location.reload(), 4000);
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

      <FastSyncPanel />

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
          {status && exportKind !== 'fast-sync' && (
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
                      <div className="flex items-center gap-3 min-w-0">
                        <FileArchive className="w-4 h-4 text-zinc-500 shrink-0" />
                        <div className="min-w-0 break-words">
                          <span className="text-sm text-zinc-200">{t(labelKey)}</span>
                          <span className="text-xs text-zinc-600 block sm:inline sm:ml-2 break-all">({key})</span>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium shrink-0 whitespace-nowrap ml-2 ${
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
              {t(exportKind === 'fast-sync' ? 'fastSync.distributionNote' : 'backup.note')}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="backup-kind" className="block text-sm">{t('fastSync.exportKind')}</label>
            <select id="backup-kind" value={exportKind} disabled={backupBusy || restoring}
              onChange={e => setExportKind(e.target.value as typeof exportKind)}
              className="w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
              <option value="identity">{t('help.backupIdentityLabel')}</option>
              <option value="full" disabled={!status?.fullBackup?.available}>{t('backup.full.label')}</option>
              <option value="fast-sync" disabled={!status?.fullBackup?.available}>{t('fastSync.package')}</option>
            </select>
            {fullBackup && <p className="text-xs text-zinc-400">{t(exportKind === 'fast-sync' ? 'fastSync.exportDesc' : 'backup.full.desc')}</p>}
            {fullBackup && status?.fullBackup && <p className="text-xs text-zinc-500">{t('fastSync.sourceSize')} {formatBytes(status.fullBackup.bytes)}</p>}
            {fullBackup && !isStopped && <p className="text-xs text-amber-400">{t('backup.full.requireStop')}</p>}
          </div>

          {/* Download button */}
          <button
            onClick={handleCreate}
            disabled={!status?.canBackup || backupBusy || restoring || !listLoaded || listError || (fullBackup && !isStopped)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors
              bg-teal-600 hover:bg-teal-500 text-white
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-teal-600"
          >
            {backupBusy ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileArchive className="w-4 h-4" />
            )}
            {backupBusy ? t('backup.saved.creating') : t(exportKind === 'fast-sync' ? 'fastSync.export' : 'backup.saved.create')}
          </button>
          {(backupError || listError) && <p role="alert" className="text-sm text-red-300 break-words">{backupError || t('backup.saved.loadError')}</p>}
          <div className="border-t border-zinc-800 pt-4">
            <h4 className="text-sm font-medium text-zinc-200 mb-3">{t('backup.saved.title')}</h4>
            {!listLoaded && !listError && <p className="text-sm text-zinc-500">{t('backup.status.checking')}</p>}
            {listLoaded && backups.length === 0 && <p className="text-sm text-zinc-500">{t('backup.saved.empty')}</p>}
            <ul className="divide-y divide-zinc-800">
              {backups.map(job => (
                <li key={job.id} className="py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 basis-52">
                    <p className="text-sm text-zinc-200 break-all">{job.filename}</p>
                    {job.kind === 'fast-sync' && <p className="text-xs text-teal-400 mt-1">{t('fastSync.package')}</p>}
                    <p className={`text-xs mt-1 ${job.state === 'failed' ? 'text-red-300' : 'text-zinc-400'}`}>
                      {t(`backup.saved.${job.state}`)} · {formatBytes(job.bytes)}
                      {job.state === 'creating' && ` · ${t('backup.saved.files', { count: String(job.processedFiles) })}`}
                    </p>
                    {job.error && <p className="text-xs text-red-300 mt-1 break-words">{job.error}</p>}
                    {job.full && job.state === 'ready' && <p className="text-xs text-zinc-400 mt-1 break-words">
                      {t(job.fastSyncEligible ? 'fastSync.eligible' : 'fastSync.ineligible')}
                      {job.fastSyncUnavailable ? `: ${job.fastSyncUnavailable}` : ''}
                    </p>}
                  </div>
                  {job.state === 'ready' && (
                    <a href={api.getBackupDownloadUrl(job.id)} download title={t('backup.download')} aria-label={t('backup.download')}
                      className="p-2 text-teal-400 hover:bg-zinc-800 rounded-md shrink-0">
                      <Download className="w-5 h-5" />
                    </a>
                  )}
                  {job.state !== 'creating' && (
                    <button onClick={() => handleDelete(job.id)} title={t('backup.saved.delete')} aria-label={t('backup.saved.delete')}
                      className="p-2 text-zinc-400 hover:text-red-300 hover:bg-zinc-800 rounded-md shrink-0">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
            onClick={() => isStopped && !restoring && !backupBusy && listLoaded && !listError && fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer
              ${dragOver
                ? 'border-sky-400 bg-sky-950/20'
                : isStopped && !restoring && !backupBusy && listLoaded && !listError
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
              disabled={!isStopped || restoring || backupBusy || !listLoaded || listError}
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
              <div className="flex items-center gap-2 text-xs text-sky-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {t('backup.restore.reloading')}
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
