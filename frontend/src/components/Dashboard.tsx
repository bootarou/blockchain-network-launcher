import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';
import {
  Play,
  Square,
  Activity,
  Trash2,
  Download,
  Upload,
  FileText,
  FileDown,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Save,
  HardDrive,
  FolderOpen,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { configToYaml, yamlToConfig } from '../lib/utils';
import type { PresetConfig } from '../constants';
import { TerminalLogs } from './TerminalLogs';
import { NodeStats } from './NodeStats';
import { ImageManager } from './ImageManager';
import { AddressViewer } from './AddressViewer';

type CommandStatus = 'idle' | 'running' | 'success' | 'error';

interface DashboardProps {
  config: PresetConfig;
  onConfigImport: (newConfig: PresetConfig) => void;
}

export function Dashboard({ config, onConfigImport }: DashboardProps) {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<unknown>(null);
  const [password, setPassword] = useState('');
  const [cmdStatus, setCmdStatus] = useState<Record<string, CommandStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeModal, setActiveModal] = useState<'start' | 'stop' | null>(null);
  const [networkState, setNetworkState] = useState<string>('stopped');

  // ── Poll network status ────────────────────────────────────────────────
  const fetchNetworkState = useCallback(async () => {
    try {
      const status = await api.getStatus();
      if (status?.state) setNetworkState(status.state);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchNetworkState();
    const iv = setInterval(fetchNetworkState, 5000);
    return () => clearInterval(iv);
  }, [fetchNetworkState]);

  const nodeStopped = networkState === 'stopped' || networkState === 'error';
  const nodeRunning = networkState === 'running';

  // ── Storage setup state ────────────────────────────────────────────────
  interface VolumeInfo { mountPoint: string; fsType: string; totalGB: number; availGB: number; usedPercent: number }
  const [storageInfo, setStorageInfo] = useState<{ targetDir: string; totalGB: number; availGB: number } | null>(null);
  const [setupVolumes, setSetupVolumes] = useState<VolumeInfo[]>([]);
  const [setupCustomPath, setSetupCustomPath] = useState('');
  const [setupSelectedPath, setSetupSelectedPath] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(true);
  const [setupLoadingVols, setSetupLoadingVols] = useState(false);

  // Fetch storage info on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await api.getStorage();
        if (data && !data.error) {
          const totalGB = Math.round(data.filesystem.totalBytes / (1024 ** 3));
          const availGB = Math.round(data.filesystem.availBytes / (1024 ** 3));
          setStorageInfo({ targetDir: data.targetDir, totalGB, availGB });
        }
      } catch { /* ignore */ }
    })();
  }, [setupSuccess]); // re-fetch after successful change

  // Load volumes when setup panel is opened
  useEffect(() => {
    if (!setupExpanded || setupVolumes.length > 0) return;
    (async () => {
      setSetupLoadingVols(true);
      try {
        const res = await api.getVolumes();
        if (res.volumes) setSetupVolumes(res.volumes);
      } catch { /* ignore */ }
      setSetupLoadingVols(false);
    })();
  }, [setupExpanded]);

  const setupEffectivePath = setupCustomPath.trim() || setupSelectedPath;
  const needsSetup = storageInfo && storageInfo.availGB < 10;

  const handleSetupApply = async () => {
    const newPath = setupEffectivePath;
    if (!newPath) return;
    setSetupSaving(true);
    setSetupError('');
    try {
      const res = await api.setTargetDir(newPath);
      if (res.success) {
        setSetupSuccess(newPath);
        setSetupCustomPath('');
        setSetupSelectedPath('');
      } else if (res.error === 'FORBIDDEN_PATH') {
        setSetupError(t('stats.forbiddenPath'));
      } else if (res.error === 'SAME_PATH') {
        setSetupError(t('stats.samePath'));
      } else {
        setSetupError(res.message || res.error || 'Failed');
      }
    } catch {
      setSetupError(t('stats.copyFailed'));
    }
    setSetupSaving(false);
  };

  // ── Command helpers ────────────────────────────────────────────────────

  /** Poll /api/status until networkStatus.state reaches a final state. */
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
      } catch { /* ignore transient errors */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  const runCommand = async (cmd: string, payload?: Record<string, unknown>) => {
    const isModal = cmd === 'start' || cmd === 'stop';
    if (isModal) setActiveModal(cmd as 'start' | 'stop');
    setCmdStatus((s) => ({ ...s, [cmd]: 'running' }));
    try {
      const res = await api.sendCommand(cmd, payload);
      if (res.error) {
        setCmdStatus((s) => ({ ...s, [cmd]: 'error' }));
        alert(res.error);
        if (isModal) setActiveModal(null);
        return;
      }

      // For start / stop, keep modal visible until the operation truly finishes.
      if (isModal) {
        const finalStates =
          cmd === 'start'
            ? ['running', 'error']
            : ['stopped', 'error'];
        await waitForState(finalStates);
      }

      setCmdStatus((s) => ({ ...s, [cmd]: 'success' }));
      setTimeout(() => setCmdStatus((s) => ({ ...s, [cmd]: 'idle' })), 3000);
    } catch {
      setCmdStatus((s) => ({ ...s, [cmd]: 'error' }));
    } finally {
      if (isModal) setActiveModal(null);
    }
  };

  const handleSave = async () => {
    try {
      setCmdStatus((s) => ({ ...s, save: 'running' }));
      await api.savePreset(config);
      setCmdStatus((s) => ({ ...s, save: 'success' }));
      setTimeout(() => setCmdStatus((s) => ({ ...s, save: 'idle' })), 3000);
    } catch {
      setCmdStatus((s) => ({ ...s, save: 'error' }));
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

  const handleStop = () => runCommand('stop');
  const handleHealthCheck = () => runCommand('healthCheck');

  const handleReset = () => {
    if (confirm(t('dashboard.confirmReset'))) {
      runCommand('resetData');
    }
  };

  const handleFullReset = () => {
    if (confirm(t('dashboard.confirmFullReset'))) {
      runCommand('fullReset');
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────

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

  // ── Import ─────────────────────────────────────────────────────────────

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        let parsed: PresetConfig;

        if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
          parsed = yamlToConfig(text);
        } else {
          parsed = JSON.parse(text) as PresetConfig;
        }

        onConfigImport(parsed);
        alert(t('dashboard.importSuccess'));
      } catch (err) {
        alert(t('dashboard.importParseError') + (err as Error).message);
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-imported
    e.target.value = '';
  };

  // ── Addresses ──────────────────────────────────────────────────────────

  const fetchAddresses = async () => {
    try {
      const data = await api.getAddresses();
      setAddresses(data);
    } catch {
      alert(t('dashboard.addressesNotFound'));
    }
  };

  const downloadAddresses = () => {
    if (!addresses) return;
    downloadFile(JSON.stringify(addresses, null, 2), 'addresses.json', 'application/json');
  };

  // ── Status icon helper ─────────────────────────────────────────────────

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

  // Hidden file input for import
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,.yml,.yaml"
      className="hidden"
      onChange={handleFileUpload}
    />
  );

  return (
    <div className="space-y-6">
      {hiddenInput}

      {/* ── Loading Modal for Start / Stop ── */}
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

      {/* ── Storage Setup Banner ── */}
      {nodeStopped && storageInfo && (needsSetup || setupSuccess) && (
        <div className={`border rounded-2xl p-5 shadow-xl space-y-4 ${
          setupSuccess
            ? 'bg-emerald-950/30 border-emerald-800/50'
            : 'bg-amber-950/20 border-amber-800/40'
        }`}>
          <button
            onClick={() => setSetupExpanded(v => !v)}
            className="w-full flex items-center justify-between"
          >
            <h2 className="text-lg font-bold flex items-center gap-2">
              <HardDrive className={`w-5 h-5 ${
                setupSuccess ? 'text-emerald-400' : 'text-amber-400'
              }`} />
              <span className={setupSuccess ? 'text-emerald-300' : 'text-amber-200'}>
                {t('setup.title')}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {!setupSuccess && storageInfo && (
                <span className="text-xs text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded">
                  {t('setup.currentSmall').replace('{avail}', String(storageInfo.availGB))}
                </span>
              )}
              {setupExpanded
                ? <ChevronUp className="w-4 h-4 text-zinc-500" />
                : <ChevronDown className="w-4 h-4 text-zinc-500" />
              }
            </div>
          </button>

          {setupExpanded && (
            <div className="space-y-4">
              {/* Description */}
              {!setupSuccess && (
                <div className="text-sm text-zinc-400">
                  {t('setup.desc')}
                </div>
              )}

              {/* Hint */}
              {!setupSuccess && (
                <div className="bg-sky-950/30 border border-sky-800/40 rounded-lg px-3 py-2 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[10px] text-sky-300/80 leading-relaxed">
                    {t('stats.pathHintWindows')}
                  </div>
                </div>
              )}

              {/* Current path info */}
              {!setupSuccess && storageInfo && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <FolderOpen className="w-3.5 h-3.5" />
                  {t('setup.currentPath')}: <code className="text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">{storageInfo.targetDir}</code>
                  <span className="text-amber-400">({storageInfo.availGB} GB {t('setup.free')})</span>
                </div>
              )}

              {/* Error */}
              {setupError && (
                <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
                  <span className="text-xs text-red-400">{setupError}</span>
                </div>
              )}

              {/* Success */}
              {setupSuccess && (
                <div className="space-y-2">
                  <div className="text-sm text-emerald-400">
                    {t('stats.restartRequired').replace('{path}', setupSuccess)}
                  </div>
                  <code className="block text-xs bg-zinc-950 text-zinc-300 rounded px-3 py-2 font-mono select-all">
                    {t('stats.restartCommand')}
                  </code>
                </div>
              )}

              {/* Volume list */}
              {!setupSuccess && (
                <div>
                  <div className="text-xs text-zinc-500 mb-2">{t('setup.recommendedVolumes')}</div>
                  {setupLoadingVols ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {setupVolumes
                        .filter(v => v.availGB >= 10)
                        .map(v => {
                          const isCurrent = v.mountPoint === storageInfo?.targetDir;
                          const isSelected = setupSelectedPath === v.mountPoint && !setupCustomPath.trim();
                          return (
                            <button
                              key={v.mountPoint}
                              onClick={() => { setSetupSelectedPath(v.mountPoint); setSetupCustomPath(''); }}
                              className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                                isSelected
                                  ? 'border-indigo-500/60 bg-indigo-500/10'
                                  : isCurrent
                                    ? 'border-zinc-600 bg-zinc-800/40'
                                    : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-600'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <HardDrive className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-zinc-500'}`} />
                                <span className="text-sm font-mono text-zinc-300">{v.mountPoint}</span>
                                {isCurrent && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                                    {t('stats.currentLabel')}
                                  </span>
                                )}
                                {isSelected && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                                    {t('stats.selected')}
                                  </span>
                                )}
                              </div>
                              <span className="text-sm text-emerald-400 font-semibold">
                                {v.availGB} GB {t('setup.free')}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* Custom path */}
              {!setupSuccess && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">{t('stats.customPath')}</div>
                  <input
                    type="text"
                    value={setupCustomPath}
                    onChange={(e) => setSetupCustomPath(e.target.value)}
                    placeholder={t('stats.customPathPlaceholder')}
                    className="w-full text-sm bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              )}

              {/* Apply */}
              {!setupSuccess && (
                <button
                  onClick={handleSetupApply}
                  disabled={!setupEffectivePath || setupSaving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  {setupSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('setup.apply')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Node Statistics ── */}
      <NodeStats />

      {/* ── Network Controls ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-5 text-zinc-100">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          {t('dashboard.title')}
        </h2>

        {/* Password */}
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

        {/* Command buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={cmdStatus.save === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('dashboard.save')}
            <StatusIcon cmd="save" />
          </button>

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

          <button
            onClick={handleReset}
            disabled={cmdStatus.resetData === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-lg font-medium transition-colors ml-auto border border-zinc-600"
          >
            <Trash2 className="w-4 h-4" />
            {t('dashboard.reset')}
            <StatusIcon cmd="resetData" />
          </button>

          <button
            onClick={handleFullReset}
            disabled={cmdStatus.fullReset === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded-lg font-medium transition-colors border border-red-700"
          >
            <Trash2 className="w-4 h-4" />
            {t('dashboard.fullReset')}
            <StatusIcon cmd="fullReset" />
          </button>
        </div>

        {/* Import / Export / Addresses */}
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

          <button
            onClick={fetchAddresses}
            className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-900/50 text-indigo-300 rounded-lg text-sm transition-colors border border-indigo-500/30 ml-auto"
          >
            <FileText className="w-4 h-4" />
            {t('dashboard.viewAddresses')}
          </button>
        </div>
      </div>

      {/* ── Addresses viewer (raw JSON) ── */}
      {addresses && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-indigo-300">target/addresses.yml</h3>
            <div className="flex gap-3">
              <button
                onClick={downloadAddresses}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> {t('dashboard.download')}
              </button>
              <button
                onClick={() => setAddresses(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                {t('dashboard.close')}
              </button>
            </div>
          </div>
          <pre className="text-xs text-green-400 bg-black/50 p-4 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(addresses, null, 2)}
          </pre>
        </div>
      )}

      {/* ── Address Viewer (structured with decrypt & balances) ── */}
      <AddressViewer />

      {/* ── Docker Images ── */}
      <ImageManager />

      {/* ── Terminal ── */}
      <TerminalLogs />
    </div>
  );
}
