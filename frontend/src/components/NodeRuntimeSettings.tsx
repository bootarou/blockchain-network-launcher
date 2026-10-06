import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

interface Status {
  managed: boolean;
  settings: { debug: boolean; nofile: number };
  containers: { service: string; state?: string; configuredNofile: unknown; error?: string;
    containerNofile?: { Soft: number; Hard: number };
    processes: { pid: string; name: string; soft: string; hard: string; open: string }[] }[];
  configurations: { resources: string; maxOpenFiles: string | null; logging: { file: string; levels: string[] }[] }[];
}

export function NodeRuntimeSettings({ disabled }: { disabled: boolean }) {
  const { lang } = useTranslation();
  const ja = lang === 'ja';
  const [status, setStatus] = useState<Status | null>(null);
  const [debug, setDebug] = useState(false);
  const [nofile, setNofile] = useState('65536');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const refresh = async (initialize = false) => {
    setBusy(true); setError('');
    try {
      const result: Status = await api.getNodeRuntime();
      setStatus(result);
      if (initialize) { setDebug(result.settings.debug); setNofile(String(result.settings.nofile)); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(true); }, []);
  const save = async () => {
    setBusy(true); setSaved(false); setError('');
    try {
      await api.saveNodeRuntime({ debug, nofile: Number(nofile) });
      setSaved(true);
      setStatus(await api.getNodeRuntime());
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 text-zinc-100">
    <h3 className="text-lg font-bold">{ja ? 'ログ・ファイル上限' : 'Logging and file limits'}</h3>
    <p className="text-sm text-zinc-400">{ja
      ? '保存後、操作ページで停止 → 起動すると反映されます。保存だけでは稼働中のノードを変更しません。'
      : 'After saving, stop and start from Operations to apply. Saving does not change a running node.'}</p>
    <fieldset disabled={disabled || busy || !status} className="space-y-3 disabled:opacity-60">
      <label className="flex items-center gap-2"><input type="checkbox" checked={debug}
        onChange={e => { setDebug(e.target.checked); setSaved(false); }} />
        {ja ? 'Debugログを有効にする（node・broker・自動復旧）' : 'Enable Debug logs (node, broker and automatic recovery)'}</label>
      <p className="text-xs text-zinc-400">{ja
        ? 'ON: コンソール・ファイル・個別コンポーネントのログレベルをDebug、OFF: Infoに設定します。Debugはログ量が増えます。ローテーション設定は維持するため、障害発生前のログを早めに退避してください。'
        : 'ON sets console, file and component thresholds to Debug; OFF sets Info. Debug increases log volume. Rotation is preserved, so archive pre-incident logs promptly.'}</p>
      <label className="flex flex-wrap items-center gap-3">{ja ? 'プロセスごとのFD上限（nofile）' : 'FD limit per process (nofile)'}
        <input type="number" min={65536} max={1048576} step={1} value={nofile}
          onChange={e => { setNofile(e.target.value); setSaved(false); }} className="bg-zinc-800 border border-zinc-600 rounded px-3 py-1 w-40" />
      </label>
      <p className="text-xs text-zinc-400">{ja ? '既定値65,536。soft / hardの両方に適用します。メモリを事前確保する値ではありません。' : 'Default: 65,536 for both soft and hard limits. This does not preallocate memory.'}</p>
      <button type="button" onClick={save} className="bg-indigo-600 rounded px-4 py-2">{ja ? '次回起動用に保存' : 'Save for next start'}</button>
    </fieldset>
    {saved && <p role="status" className="text-emerald-400">{ja ? '保存しました。停止 → 起動後に実測値を更新して確認してください。' : 'Saved. Stop and start, then refresh the actual values.'}</p>}
    {error && <p role="alert" className="text-red-400 whitespace-pre-wrap">{error}</p>}
    <button type="button" disabled={busy} onClick={() => refresh()} className="border border-zinc-600 rounded px-3 py-1 disabled:opacity-50">{ja ? '設定・実測値を更新' : 'Refresh configuration and actual values'}</button>
    {status && <>
      <p className="text-sm">{ja ? '保存済み（次回起動）' : 'Saved (next start)'}: nofile={status.settings.nofile}, Debug={status.managed ? (status.settings.debug ? 'ON' : 'OFF') : (ja ? '未指定（既存ログ設定を維持）' : 'Unmanaged (preserve existing logging)')}</p>
      {!status.containers.length && <p className="text-sm text-zinc-400">{ja ? 'ノード設定はまだ生成されていません。' : 'Node configuration has not been generated yet.'}</p>}
      {status.containers.map(c => <div key={c.service} className="text-sm border-t border-zinc-700 pt-2 space-y-1">
        <p className="font-semibold">{c.service}: {c.state ?? (ja ? '確認できません' : 'Unavailable')}</p>
        <p>Compose nofile: {c.configuredNofile == null ? (ja ? '未指定' : 'Unset') : JSON.stringify(c.configuredNofile)}</p>
        <p>{ja ? 'コンテナ作成時' : 'At container creation'}: {c.containerNofile ? `${c.containerNofile.Soft} / ${c.containerNofile.Hard}` : (ja ? '未指定／未作成' : 'Unset / not created')}</p>
        {c.processes.map(p => <p key={p.pid}>{p.name} (PID {p.pid}): soft={p.soft}, hard={p.hard}, {ja ? '使用FD' : 'Open FDs'}={p.open}
          {Number(p.soft) < status.settings.nofile && <span className="text-amber-400"> {ja ? '— 保存済み上限より低い値です' : '— Below saved limit'}</span>}</p>)}
        {!c.processes.length && <p className="text-zinc-400">{ja ? 'Catapultプロセスの実測値は取得できていません。停止中は取得できません。' : 'No Catapult process measurement available. Stopped processes cannot be measured.'}</p>}
        {c.error && <p className="text-amber-400 whitespace-pre-wrap">{c.error}</p>}
      </div>)}
      <details className="text-sm"><summary className="cursor-pointer">{ja ? '生成済みログ設定・RocksDB設定' : 'Generated logging and RocksDB settings'}</summary>
        <p className="text-zinc-400 my-2">{ja ? 'RocksDBのmaxOpenFilesはDB側の設定で、OSのnofileとは別です。0はCatapult側で明示指定せず、RocksDBの既定値を使う意味です。ここでは変更しません。' : 'RocksDB maxOpenFiles is separate from OS nofile. 0 leaves the RocksDB default unchanged. It is read-only here.'}</p>
        {status.configurations.map(c => <div key={c.resources} className="my-2 break-all"><p>{c.resources}</p><p>maxOpenFiles: {c.maxOpenFiles ?? '—'}</p>
          {c.logging.map(l => <p key={l.file}>{l.file}: {l.levels.join(' / ')}</p>)}
        </div>)}
      </details>
    </>}
  </section>;
}
