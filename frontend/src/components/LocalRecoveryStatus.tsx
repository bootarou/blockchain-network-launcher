import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import { api, type RecoveryJob } from '../lib/api';
import { useTranslation } from '../i18n';

export function LocalRecoveryStatus({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const [job, setJob] = useState<RecoveryJob | null>(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.getRecovery();
        if (!disposed) { setJob(result.job); onBusy(result.busy); setError(''); }
      } catch (e) {
        if (!disposed) { setError((e as Error).message); onBusy(true); }
      } finally { if (!disposed) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [onBusy]);

  const act = async (action: 'apply' | 'abandon') => {
    if (!job || !confirm(t(`recovery.confirm.${action}`))) return;
    setActing(true);
    try {
      await api.recoveryAction(action, job.id);
      const result = await api.getRecovery();
      setJob(result.job); onBusy(result.busy);
    } catch (e) { alert((e as Error).message); }
    finally { setActing(false); }
  };
  if (!job && !error) return null;
  return (
    <section className="border-y border-zinc-700 py-4 space-y-3 min-w-0" aria-live="polite">
      <h3 className="text-base font-semibold flex items-center gap-2"><Wrench className="w-4 h-4" />{t('recovery.title')}</h3>
      {error && <p role="alert" className="text-red-300 break-words">{t('recovery.connectionError')}: {error}</p>}
      {job && <>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {(job.state === 'running' || job.state === 'applying') && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{t(`recovery.state.${job.state}`)}</span>
          {['running', 'applying', 'failed', 'interrupted', 'manual'].includes(job.state) &&
            <span className="text-zinc-400">{t(`recovery.phase.${job.phase}`)}</span>}
          {job.height && <span>{t('recovery.height')}: {job.height}</span>}
        </div>
        <p className="text-xs text-zinc-400 break-all">{job.work}</p>
        {job.error && <p role="alert" className="text-sm text-red-300 break-words">{job.error}</p>}
        {job.detail && job.state === 'running' && <pre className="text-xs whitespace-pre-wrap break-all max-h-32 overflow-auto">{job.detail}</pre>}
        {job.state === 'complete' && <p className="text-sm text-emerald-300">{t('recovery.complete')}</p>}
        {job.state === 'manual' && <p className="text-sm text-red-300">{t('recovery.manual')}</p>}
        <div className="flex flex-wrap gap-3">
          {job.state === 'ready' && <button type="button" disabled={acting || !!error} onClick={() => act('apply')}
            className="flex items-center gap-2 rounded-lg px-4 py-2 bg-emerald-700 disabled:opacity-50 text-sm">
            <CheckCircle2 className="w-4 h-4" />{t('recovery.apply')}
          </button>}
          {['ready', 'failed', 'interrupted'].includes(job.state) && <button type="button" disabled={acting || !!error} onClick={() => act('abandon')}
            className="flex items-center gap-2 rounded-lg px-4 py-2 border border-zinc-600 disabled:opacity-50 text-sm">
            <XCircle className="w-4 h-4" />{t('recovery.abandon')}
          </button>}
        </div>
      </>}
    </section>
  );
}
