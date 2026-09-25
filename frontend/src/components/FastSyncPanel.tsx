import { useEffect, useState } from 'react';
import { Upload, Trash2, RefreshCw, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

export function FastSyncPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getFastSync>> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.getFastSync();
        if (!disposed) { setStatus(next); setOffline(false); }
      } catch { if (!disposed) setOffline(true); }
      finally { if (!disposed) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const upload = async () => {
    if (!file || !trusted || busy || !status?.available || offline) return;
    setBusy(true); setError(''); setProgress(0);
    try { await api.uploadFastSync(file, setProgress); setStatus(await api.getFastSync()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!confirm(t('fastSync.discardConfirm'))) return;
    setBusy(true); setError('');
    try { await api.discardFastSync(); setStatus(await api.getFastSync()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const job = status?.job;
  return <section className="border-y border-zinc-800 py-5 space-y-3 min-w-0" aria-labelledby="fast-sync-title">
    <h3 id="fast-sync-title" className="text-lg font-semibold flex items-center gap-2"><Zap className="w-5 h-5 text-teal-400 shrink-0" />{t('fastSync.title')}</h3>
    <p className="text-sm text-zinc-400">{t('fastSync.description')}</p>
    <p className="text-sm text-amber-400">{t('fastSync.scope')}</p>
    <p className="text-sm text-zinc-400">{t('fastSync.prepare')}</p>
    {offline && <p role="alert" className="text-red-400">{t('fastSync.offline')}</p>}
    {!status && !offline && <RefreshCw className="w-5 h-5 animate-spin" aria-label={t('fastSync.loading')} />}
    {status && !status.available && !job && <p className="text-sm text-amber-400 break-words">{status.reason}</p>}
    {status?.available && <div className="space-y-3">
      <input aria-label={t('fastSync.file')} type="file" accept=".zip" disabled={busy} className="block w-full min-w-0 text-sm"
        onChange={e => { setFile(e.target.files?.[0] ?? null); setTrusted(false); }} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={trusted} disabled={busy}
        onChange={e => setTrusted(e.target.checked)} className="mt-1 shrink-0" />{t('fastSync.trust')}</label>
      <button onClick={upload} disabled={!file || !trusted || busy || offline} className="inline-flex items-center gap-2 rounded px-3 py-2 bg-teal-700 text-white disabled:opacity-40">
        <Upload className="w-4 h-4" />{t('fastSync.import')}
      </button>
    </div>}
    {busy && <p role="status" className="text-sm">{t('fastSync.uploading')} {progress}%</p>}
    {job && <div className="space-y-2 text-sm" role="status">
      <p>{t('fastSync.' + job.state)}{job.height ? ` (${job.height})` : ''}</p>
      {job.state === 'ready' && <p>{t('fastSync.readyNext')}</p>}
      {job.state === 'extracting' && <p>{t('fastSync.processing')}</p>}
      {job.state === 'manual' && <p className="text-amber-400">{t('fastSync.manualNote')}</p>}
      {job.error && <p className="text-red-400 break-words">{job.error}</p>}
      {['ready', 'failed'].includes(job.state) && <button disabled={busy || offline} onClick={discard} className="inline-flex items-center gap-2 rounded border border-zinc-600 px-3 py-2 disabled:opacity-40">
        <Trash2 className="w-4 h-4" />{t('fastSync.discard')}
      </button>}
    </div>}
    {error && <p role="alert" className="text-red-400 text-sm break-words">{error}</p>}
  </section>;
}
