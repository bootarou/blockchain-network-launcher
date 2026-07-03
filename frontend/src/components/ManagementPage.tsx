import React, { useCallback, useEffect, useState } from 'react';
import {
  HardDrive,
  FolderOpen,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  Wrench,
  FileText,
  Download,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { AddressViewer } from './AddressViewer';
import { ImageManager } from './ImageManager';

interface VolumeInfo {
  mountPoint: string;
  fsType: string;
  totalGB: number;
  availGB: number;
  usedPercent: number;
}

export function ManagementPage() {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<Record<string, unknown> | null>(null);
  const [networkState, setNetworkState] = useState<string>('stopped');
  const [storageInfo, setStorageInfo] = useState<{ targetDir: string; totalGB: number; availGB: number } | null>(null);
  const [setupVolumes, setSetupVolumes] = useState<VolumeInfo[]>([]);
  const [setupCustomPath, setSetupCustomPath] = useState('');
  const [setupSelectedPath, setSetupSelectedPath] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(true);
  const [setupLoadingVols, setSetupLoadingVols] = useState(false);

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

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getStorage();
        if (data && !data.error) {
          const totalGB = Math.round(data.filesystem.totalBytes / (1024 ** 3));
          const availGB = Math.round(data.filesystem.availBytes / (1024 ** 3));
          setStorageInfo({ targetDir: data.targetDir, totalGB, availGB });
        }
      } catch {
        /* ignore */
      }
    })();
  }, [setupSuccess]);

  useEffect(() => {
    if (!setupExpanded || setupVolumes.length > 0) return;
    (async () => {
      setSetupLoadingVols(true);
      try {
        const res = await api.getVolumes();
        if (res.volumes) setSetupVolumes(res.volumes);
      } catch {
        /* ignore */
      }
      setSetupLoadingVols(false);
    })();
  }, [setupExpanded, setupVolumes.length]);

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
    const blob = new Blob([JSON.stringify(addresses, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'addresses.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-bold">{t('manage.title')}</h2>
        </div>
        <p className="text-zinc-400 text-sm">{t('manage.description')}</p>
      </div>

      {nodeStopped && storageInfo && (needsSetup || setupSuccess) && (
        <div className={`border rounded-2xl p-5 shadow-xl space-y-4 ${
          setupSuccess
            ? 'bg-emerald-950/30 border-emerald-800/50'
            : 'bg-amber-950/20 border-amber-800/40'
        }`}>
          <button
            onClick={() => setSetupExpanded((value) => !value)}
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
              {setupExpanded ? (
                <ChevronUp className="w-4 h-4 text-zinc-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              )}
            </div>
          </button>

          {setupExpanded && (
            <div className="space-y-4">
              {!setupSuccess && <div className="text-sm text-zinc-400">{t('setup.desc')}</div>}

              {!setupSuccess && (
                <div className="bg-sky-950/30 border border-sky-800/40 rounded-lg px-3 py-2 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[10px] text-sky-300/80 leading-relaxed">
                    {t('stats.pathHintWindows')}
                  </div>
                </div>
              )}

              {!setupSuccess && storageInfo && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <FolderOpen className="w-3.5 h-3.5" />
                  {t('setup.currentPath')}:
                  <code className="text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">{storageInfo.targetDir}</code>
                  <span className="text-amber-400">({storageInfo.availGB} GB {t('setup.free')})</span>
                </div>
              )}

              {setupError && (
                <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
                  <span className="text-xs text-red-400">{setupError}</span>
                </div>
              )}

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
                        .filter((volume) => volume.availGB >= 10)
                        .map((volume) => {
                          const isCurrent = volume.mountPoint === storageInfo?.targetDir;
                          const isSelected = setupSelectedPath === volume.mountPoint && !setupCustomPath.trim();
                          return (
                            <button
                              key={volume.mountPoint}
                              onClick={() => {
                                setSetupSelectedPath(volume.mountPoint);
                                setSetupCustomPath('');
                              }}
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
                                <span className="text-sm font-mono text-zinc-300">{volume.mountPoint}</span>
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
                                {volume.availGB} GB {t('setup.free')}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

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

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">{t('manage.addressesTitle')}</h3>
            <p className="text-sm text-zinc-400">{t('manage.addressesDescription')}</p>
          </div>
          <button
            onClick={fetchAddresses}
            className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-900/50 text-indigo-300 rounded-lg text-sm transition-colors border border-indigo-500/30"
          >
            <FileText className="w-4 h-4" />
            {t('dashboard.viewAddresses')}
          </button>
        </div>

        {addresses && (
          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-sm font-semibold text-indigo-300">target/addresses.yml</h4>
              <button
                onClick={downloadAddresses}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> {t('dashboard.download')}
              </button>
            </div>
            <pre className="text-xs text-green-400 bg-black/50 p-4 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(addresses, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <AddressViewer />
      <ImageManager />
    </div>
  );
}