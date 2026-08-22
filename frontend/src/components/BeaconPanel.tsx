import { useCallback, useEffect, useState } from 'react';
import {
  Radio, Loader2, CheckCircle2, AlertTriangle, Download, RefreshCw, ShieldCheck, KeyRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

type Status = 'READY' | 'GENERATING' | 'VALID' | 'ERROR';

interface Endpoints {
  p2pHost: string;
  p2pPort: number;
  apiHost: string;
  apiPort: number;
  apiScheme: 'http' | 'https';
}

interface Preview {
  node: {
    nodeName: string; networkName: string; generationHash: string;
    transportPublicKey: string; mainPublicKey: string; friendlyName: string;
  };
  endpoints: Endpoints;
  endpointSources: Record<keyof Endpoints, string>;
  block: { height: string; blockHash: string; blockTimestamp: string };
  warnings: string[];
}

interface Generated {
  fileName: string;
  payloadHash: string;
  signature: string;
  payloadByteLength: number;
}

/** Read-only key/value row. Values are monospace so hashes stay comparable. */
function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="w-56 shrink-0 text-xs text-zinc-500">{label}</span>
      <span className={`text-sm text-zinc-200 break-all ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

export function BeaconPanel() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<Partial<Endpoints>>({});
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('READY');
  const [error, setError] = useState<{ code: string; message: string; detail?: string } | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (overrides: Partial<Endpoints> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.beaconPreview(overrides);
      setPreview(result as Preview);
      setStatus('READY');
    } catch (err: unknown) {
      setPreview(null);
      setStatus('ERROR');
      setError(err as { code: string; message: string });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const endpoints: Endpoints | null = preview ? { ...preview.endpoints, ...edits } : null;

  const setEndpoint = <K extends keyof Endpoints>(key: K, value: Endpoints[K]): void => {
    setEdits((prev) => ({ ...prev, [key]: value }));
    // Any edit invalidates a previously generated Beacon: the signed bytes changed.
    setGenerated(null);
    setStatus('READY');
  };

  const handleGenerate = async (): Promise<void> => {
    if (!password) { alert(t('beacon.passwordRequired')); return; }
    setStatus('GENERATING');
    setError(null);
    setGenerated(null);
    try {
      const result = await api.beaconGenerate(password, edits);
      setGenerated({
        fileName: result.fileName,
        payloadHash: result.payloadHash,
        signature: result.signature,
        payloadByteLength: result.payloadByteLength,
      });
      setPreview(result.preview as Preview);
      setStatus('VALID');
      // The signed file goes straight to the browser; BNL never stores it.
      const blob = new Blob([result.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setStatus('ERROR');
      setError(err as { code: string; message: string });
    }
  };

  const statusChip = {
    READY: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    GENERATING: 'bg-amber-900/40 text-amber-300 border-amber-800',
    VALID: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    ERROR: 'bg-red-900/40 text-red-300 border-red-800',
  }[status];

  const inputBase =
    'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-indigo-400" />
            {t('beacon.title')}
          </h2>
          <p className="text-sm text-zinc-500 mt-1">{t('beacon.description')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${statusChip}`}>
            {status}
          </span>
          <button
            onClick={() => { setEdits({}); void load(); }}
            disabled={loading}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
            title={t('beacon.reload')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-300 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-mono text-xs">{error.code}</span>
          </div>
          <p>{error.message}</p>
          {error.detail && <p className="text-xs text-red-400/70 font-mono break-all">{error.detail}</p>}
        </div>
      )}

      {preview?.warnings.map((warning) => (
        <div key={warning} className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-xs text-amber-300">
          {warning}
        </div>
      ))}

      {preview && endpoints && (
        <>
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium text-zinc-300">{t('beacon.identity')}</span>
            </div>
            <div className="px-4 py-2">
              <Row label={t('beacon.nodeName')} value={preview.node.nodeName} mono={false} />
              <Row label={t('beacon.friendlyName')} value={preview.node.friendlyName} mono={false} />
              <Row label="Generation Hash" value={preview.node.generationHash} />
              <Row label="Transport Public Key" value={preview.node.transportPublicKey} />
              <Row label="Main Public Key" value={preview.node.mainPublicKey} />
            </div>
          </section>

          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
              <span className="text-sm font-medium text-zinc-300">{t('beacon.endpoints')}</span>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-amber-300/80">{t('beacon.endpointsNote')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">P2P Host</label>
                  <input className={inputBase} value={endpoints.p2pHost}
                    onChange={(e) => setEndpoint('p2pHost', e.target.value)} />
                  <p className="mt-1 text-[11px] text-zinc-600">{preview.endpointSources.p2pHost}</p>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">P2P Port</label>
                  <input className={inputBase} type="number" min={1} max={65535} value={endpoints.p2pPort}
                    onChange={(e) => setEndpoint('p2pPort', Number(e.target.value))} />
                  <p className="mt-1 text-[11px] text-zinc-600">{preview.endpointSources.p2pPort}</p>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">API Host</label>
                  <input className={inputBase} value={endpoints.apiHost}
                    onChange={(e) => setEndpoint('apiHost', e.target.value)} />
                  <p className="mt-1 text-[11px] text-zinc-600">{preview.endpointSources.apiHost}</p>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">API Port</label>
                  <input className={inputBase} type="number" min={1} max={65535} value={endpoints.apiPort}
                    onChange={(e) => setEndpoint('apiPort', Number(e.target.value))} />
                  <p className="mt-1 text-[11px] text-zinc-600">{preview.endpointSources.apiPort}</p>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">API Scheme</label>
                  <select className={inputBase} value={endpoints.apiScheme}
                    onChange={(e) => setEndpoint('apiScheme', e.target.value as 'http' | 'https')}>
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-600">{preview.endpointSources.apiScheme}</p>
                </div>
              </div>
              <div className="text-xs text-zinc-500 font-mono bg-zinc-950/60 rounded-lg px-3 py-2 space-y-1">
                <div>P2P&nbsp;&nbsp;: {endpoints.p2pHost.includes(':') ? `[${endpoints.p2pHost}]` : endpoints.p2pHost}:{endpoints.p2pPort}</div>
                <div>REST : {endpoints.apiScheme}://{endpoints.apiHost.includes(':') ? `[${endpoints.apiHost}]` : endpoints.apiHost}:{endpoints.apiPort}</div>
              </div>
            </div>
          </section>

          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
              <span className="text-sm font-medium text-zinc-300">{t('beacon.block')}</span>
            </div>
            <div className="px-4 py-2">
              <Row label={t('beacon.height')} value={preview.block.height} />
              <Row label={t('beacon.blockHash')} value={preview.block.blockHash} />
              <Row label={t('beacon.blockTimestamp')} value={preview.block.blockTimestamp} />
            </div>
            <p className="px-4 pb-3 text-[11px] text-zinc-600">{t('beacon.blockNote')}</p>
          </section>

          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
            <label className="block text-xs text-zinc-500">{t('beacon.password')}</label>
            <input
              type="password"
              className={inputBase}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('beacon.passwordPlaceholder')}
            />
            <p className="text-[11px] text-zinc-600">{t('beacon.passwordNote')}</p>
            <button
              onClick={() => void handleGenerate()}
              disabled={status === 'GENERATING' || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {status === 'GENERATING'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('beacon.generating')}</>
                : <><Download className="w-4 h-4" /> {t('beacon.generate')}</>}
            </button>
          </section>

          {generated && (
            <section className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300 font-medium text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {t('beacon.generated')}
              </div>
              <div className="flex items-center gap-2 text-emerald-300/90 text-xs">
                <ShieldCheck className="w-4 h-4" />
                {t('beacon.signatureValid')}
              </div>
              <div className="pt-1">
                <Row label={t('beacon.fileName')} value={generated.fileName} mono={false} />
                <Row label="Payload Hash" value={generated.payloadHash} />
                <Row label="Signature" value={generated.signature} />
                <Row label={t('beacon.payloadSize')} value={`${generated.payloadByteLength} bytes`} mono={false} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
