import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Activity,
  Trash2,
  Download,
  Upload,
  FileDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Unlock,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { configToYaml, yamlToConfig } from '../lib/utils';
import type { PresetConfig } from '../constants';
import { TerminalLogs } from './TerminalLogs';

type CommandStatus = 'idle' | 'running' | 'success' | 'error';

interface OperationsPageProps {
  config: PresetConfig;
  onConfigImport: (newConfig: PresetConfig) => void;
}

export function OperationsPage({ config, onConfigImport }: OperationsPageProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [cmdStatus, setCmdStatus] = useState<Record<string, CommandStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeModal, setActiveModal] = useState<'start' | 'stop' | null>(null);
  const [networkState, setNetworkState] = useState<string>('stopped');

  const fetchNetworkState = useCallback(async () => {
    try {
      const status = await api.getStatus();
      if (status?.state) setNetworkState(status.state);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchNetworkState();
    const iv = setInterval(fetchNetworkState, 5000);
    return () => clearInterval(iv);
  }, [fetchNetworkState]);

  const nodeStopped = networkState === 'stopped' || networkState === 'error';
  const nodeRunning = networkState === 'running';

  const waitForState = async (
    targetStates: string[],
    timeoutMs = 300_000,
    intervalMs = 2_000,
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await api.getStatus();
        if (targetStates.includes(status.state)) return;
      } catch {
        /* ignore transient errors */
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };

  const runCommand = async (cmd: string, payload?: Record<string, unknown>) => {
    const isModal = cmd === 'start' || cmd === 'stop';
    if (isModal) setActiveModal(cmd as 'start' | 'stop');
    setCmdStatus((state) => ({ ...state, [cmd]: 'running' }));
    try {
      const res = await api.sendCommand(cmd, payload);
      if (res.error) {
        setCmdStatus((state) => ({ ...state, [cmd]: 'error' }));
        alert(res.error);
        if (isModal) setActiveModal(null);
        return;
      }

      if (isModal) {
        const finalStates = cmd === 'start' ? ['running', 'error'] : ['stopped', 'error'];
        await waitForState(finalStates);
      }

      setCmdStatus((state) => ({ ...state, [cmd]: 'success' }));
      setTimeout(() => setCmdStatus((state) => ({ ...state, [cmd]: 'idle' })), 3000);
    } catch {
      setCmdStatus((state) => ({ ...state, [cmd]: 'error' }));
    } finally {
      if (isModal) setActiveModal(null);
    }
  };

  const handleStart = async () => {
    if (!password) {
      alert(t('dashboard.alertNoPassword'));
      return;
    }
    await api.savePreset(config);
    await runCommand('start', { password });
  };

  // Full-apply start: forces the "full" start mode so symbol-bootstrap
  // regenerates every config file from the preset (keys/data preserved).
  // Escape hatch for settings the quick-restart path does not sync.
  const handleFullApply = async () => {
    if (!password) {
      alert(t('dashboard.alertNoPassword'));
      return;
    }
    if (!confirm(t('dashboard.confirmFullApply'))) return;
    await api.savePreset(config);
    await runCommand('start', { password, mode: 'full' });
  };

  const handleStop = () => runCommand('stop');
  const handleHealthCheck = () => runCommand('healthCheck');

  const handleReset = () => {
    if (confirm(t('dashboard.confirmReset'))) {
      runCommand('resetData');
    }
  };

  const handleFullReset = async () => {
    if (confirm(t('dashboard.confirmFullReset'))) {
      await runCommand('fullReset');
      window.location.reload();
    }
  };

  const handleClearLocks = () => {
    if (confirm(t('dashboard.confirmClearLocks'))) {
      runCommand('clearLocks');
    }
  };

  // Crash diagnosis + auto-recovery: detects 0-byte block/state files left
  // behind by an unexpected shutdown (power loss, forced reboot) and, after
  // confirmation, resets data to seed for a network resync (keys preserved).
  const handleCrashRecovery = async () => {
    setCmdStatus((state) => ({ ...state, crashRecovery: 'running' }));
    const finish = (status: CommandStatus) => {
      setCmdStatus((state) => ({ ...state, crashRecovery: status }));
      if (status !== 'running') {
        setTimeout(() => setCmdStatus((state) => ({ ...state, crashRecovery: 'idle' })), 3000);
      }
    };
    try {
      const diag = await api.sendCommand('crashDiagnose');
      if (diag.error) throw new Error(diag.error);
      if (diag.running) {
        alert(t('dashboard.crashDiagRunning'));
        finish('idle');
        return;
      }
      if (diag.verdict === 'clean') {
        alert(t('dashboard.crashDiagClean'));
        finish('success');
        return;
      }

      const damageList = [
        ...(diag.corruptBlockFiles ?? []),
        ...(diag.corruptStateFiles ?? []),
        ...(diag.corruptSpoolIndexes ?? []),
        ...(diag.staleLocks ?? []),
        ...(diag.orphanBlockFiles ?? []),
        ...(diag.orphanSpoolFiles ?? []),
      ].slice(0, 8).join('\n');

      let force = false;
      if (diag.verdict === 'locks-only') {
        if (!confirm(`${t('dashboard.confirmCrashClean')}\n\n${damageList}`)) {
          finish('idle');
          return;
        }
      } else {
        const src = diag.resyncSource;
        const srcLine = src?.ok
          ? `${t('dashboard.crashResyncFrom')}: ${src.url} (height ${src.remoteHeight})`
          : `${t('dashboard.crashNoSource')}\n(${src?.reason ?? ''})`;
        if (!confirm(`${t('dashboard.confirmCrashReset')}\n\n${damageList}\n\n${srcLine}`)) {
          finish('idle');
          return;
        }
        if (!src?.ok) {
          if (!confirm(t('dashboard.confirmCrashForce'))) {
            finish('idle');
            return;
          }
          force = true;
        }
      }

      const result = await api.sendCommand('crashRecovery', force ? { force: true } : undefined);
      if (result.error) throw new Error(result.error);
      alert(result.action === 'reset' ? t('dashboard.crashResetDone') : t('dashboard.crashCleanDone'));
      finish('success');
    } catch (err) {
      alert(`${t('dashboard.crashRecoveryFailed')}\n${(err as Error).message}`);
      finish('error');
    }
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportYaml = () => {
    downloadFile(configToYaml(config), 'custom-preset.yml', 'application/x-yaml');
  };

  const exportJson = () => {
    downloadFile(JSON.stringify(config, null, 2), 'custom-preset.json', 'application/json');
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = file.name.endsWith('.yml') || file.name.endsWith('.yaml')
          ? yamlToConfig(text)
          : (JSON.parse(text) as PresetConfig);

        onConfigImport(parsed);
        alert(t('dashboard.importSuccess'));
      } catch (err) {
        alert(t('dashboard.importParseError') + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const StatusIcon = ({ cmd }: { cmd: string }) => {
    const status = cmdStatus[cmd] ?? 'idle';
    switch (status) {
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yml,.yaml"
        className="hidden"
        onChange={handleFileUpload}
      />

      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 min-w-[320px] max-w-md mx-4">
            {activeModal === 'start' ? (
              <Play className="w-10 h-10 text-emerald-400 animate-pulse" />
            ) : (
              <Square className="w-10 h-10 text-red-400 animate-pulse fill-current" />
            )}
            <h3 className="text-lg font-bold text-zinc-100">
              {activeModal === 'start' ? t('dashboard.modalStartTitle') : t('dashboard.modalStopTitle')}
            </h3>
            <p className="text-sm text-zinc-400 text-center">
              {activeModal === 'start' ? t('dashboard.modalStartDesc') : t('dashboard.modalStopDesc')}
            </p>
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-zinc-500">{t('dashboard.modalHint')}</p>
          </div>
        </div>
      )}

      <div className="border-b border-zinc-800 pb-4">
        <h2 className="text-lg font-bold">{t('operations.title')}</h2>
        <p className="text-zinc-400 text-sm">{t('operations.description')}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-5 text-zinc-100">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          {t('dashboard.title')}
        </h3>

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            {t('dashboard.passwordLabel')}
          </label>
          <input
            type="password"
            placeholder={t('dashboard.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full md:w-96 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          {nodeStopped && (
            <button
              onClick={handleStart}
              disabled={cmdStatus.start === 'running'}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              <Play className="w-4 h-4" />
              {t('dashboard.start')}
              <StatusIcon cmd="start" />
            </button>
          )}

          {nodeRunning && (
            <button
              onClick={handleStop}
              disabled={cmdStatus.stop === 'running'}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
              {t('dashboard.stop')}
              <StatusIcon cmd="stop" />
            </button>
          )}

          <button
            onClick={handleHealthCheck}
            disabled={cmdStatus.healthCheck === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Activity className="w-4 h-4" />
            {t('dashboard.healthCheck')}
            <StatusIcon cmd="healthCheck" />
          </button>

          {nodeStopped && (
            <button
              onClick={handleFullApply}
              disabled={cmdStatus.start === 'running'}
              title={t('dashboard.fullApplyHint')}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-emerald-300 rounded-lg font-medium transition-colors border border-emerald-800"
            >
              <RefreshCw className="w-4 h-4" />
              {t('dashboard.fullApply')}
            </button>
          )}

          {nodeStopped && (
            <button
              onClick={handleReset}
              disabled={cmdStatus.resetData === 'running'}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-lg font-medium transition-colors ml-auto border border-zinc-600"
            >
              <Trash2 className="w-4 h-4" />
              {t('dashboard.reset')}
              <StatusIcon cmd="resetData" />
            </button>
          )}

          {nodeStopped && (
            <button
              onClick={handleFullReset}
              disabled={cmdStatus.fullReset === 'running'}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded-lg font-medium transition-colors border border-red-700"
            >
              <Trash2 className="w-4 h-4" />
              {t('dashboard.fullReset')}
              <StatusIcon cmd="fullReset" />
            </button>
          )}

          {nodeStopped && (
            <button
              onClick={handleClearLocks}
              disabled={cmdStatus.clearLocks === 'running'}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-900 hover:bg-amber-800 disabled:opacity-50 text-amber-200 rounded-lg font-medium transition-colors border border-amber-700"
            >
              <Unlock className="w-4 h-4" />
              {t('dashboard.clearLocks')}
              <StatusIcon cmd="clearLocks" />
            </button>
          )}

          {nodeStopped && (
            <button
              onClick={handleCrashRecovery}
              disabled={cmdStatus.crashRecovery === 'running'}
              title={t('dashboard.crashRecoveryHint')}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-900 hover:bg-orange-800 disabled:opacity-50 text-orange-200 rounded-lg font-medium transition-colors border border-orange-700"
            >
              <Wrench className="w-4 h-4" />
              {t('dashboard.crashRecovery')}
              <StatusIcon cmd="crashRecovery" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 pt-4 border-t border-zinc-800">
          <button
            onClick={exportYaml}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <Download className="w-4 h-4" />
            {t('dashboard.exportYaml')}
          </button>

          <button
            onClick={exportJson}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <FileDown className="w-4 h-4" />
            {t('dashboard.exportJson')}
          </button>

          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <Upload className="w-4 h-4" />
            {t('dashboard.import')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{t('terminal.title')}</h3>
          <p className="text-sm text-zinc-400">symbol-bootstrap の起動・停止・復旧時のログを確認できます。</p>
        </div>
        <TerminalLogs />
      </div>
    </div>
  );
}