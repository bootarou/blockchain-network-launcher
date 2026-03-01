import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';
import {
  Globe,
  Play,
  Square,
  Hammer,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import type { PresetConfig } from '../constants';

interface ExplorerManagerProps {
  config: PresetConfig;
  nodeRunning: boolean;
}

type ExplorerStatus = 'not-built' | 'building' | 'stopped' | 'running' | 'error';

export function ExplorerManager({ config, nodeRunning }: ExplorerManagerProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ExplorerStatus>('not-built');
  const [loading, setLoading] = useState(false);

  // Pre-fill namespace config from user's preset
  const defaultNsName =
    config.baseNamespace && config.nemesisMosaics?.[0]?.name
      ? `${config.baseNamespace}.${config.nemesisMosaics[0].name}`
      : 'symbol.xym';
  const defaultDiv = String(config.nemesisMosaics?.[0]?.divisibility ?? 6);

  const [nsName, setNsName] = useState(defaultNsName);
  const [nsId, setNsId] = useState('E74B99BA41F4AFEE');
  const [divisibility, setDivisibility] = useState(defaultDiv);

  // ── Poll explorer status ─────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getExplorerStatus();
      if (res?.status) setStatus(res.status as ExplorerStatus);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 5000);
    return () => clearInterval(iv);
  }, [fetchStatus]);

  // Update namespace defaults when preset config changes
  useEffect(() => {
    const ns =
      config.baseNamespace && config.nemesisMosaics?.[0]?.name
        ? `${config.baseNamespace}.${config.nemesisMosaics[0].name}`
        : 'symbol.xym';
    const div = String(config.nemesisMosaics?.[0]?.divisibility ?? 6);
    setNsName(ns);
    setDivisibility(div);
  }, [config.baseNamespace, config.nemesisMosaics]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleBuild = async () => {
    setLoading(true);
    try {
      await api.buildExplorer();
      // Status will update via polling
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      await api.startExplorer({
        namespaceName: nsName,
        namespaceId: nsId,
        divisibility,
        port: config.explorerPort || 8090,
      });
    } catch { /* ignore */ }
    setTimeout(() => setLoading(false), 2000);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await api.stopExplorer();
    } catch { /* ignore */ }
    setTimeout(() => setLoading(false), 2000);
  };

  const port = config.explorerPort || 8090;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Globe className="w-5 h-5 text-indigo-400" />
        {t('explorer.title')}
      </h2>

      {/* ── Status indicator ── */}
      <div className="flex items-center gap-3">
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            status === 'running'
              ? 'bg-emerald-400 animate-pulse'
              : status === 'building'
                ? 'bg-amber-400 animate-pulse'
                : status === 'stopped'
                  ? 'bg-zinc-500'
                  : status === 'error'
                    ? 'bg-red-400'
                    : 'bg-zinc-700'
          }`}
        />
        <span className="text-sm text-zinc-400">
          {t(`explorer.status.${status}`)}
        </span>
        {status === 'running' && (
          <a
            href={`http://localhost:${port}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('explorer.open')}
          </a>
        )}
      </div>

      {/* ── Building progress banner ── */}
      {status === 'building' && (
        <div className="flex items-center gap-3 bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-3">
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0" />
          <div>
            <div className="text-sm text-amber-300">{t('explorer.buildingTitle')}</div>
            <div className="text-xs text-zinc-500">{t('explorer.buildingHint')}</div>
          </div>
        </div>
      )}

      {/* ── Network config inputs ── */}
      {status !== 'building' && (
        <div className="space-y-3">
          <div className="text-xs text-zinc-500 font-medium">
            {t('explorer.networkConfig')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                {t('explorer.namespaceName')}
              </label>
              <input
                type="text"
                value={nsName}
                onChange={(e) => setNsName(e.target.value)}
                disabled={status === 'running'}
                className="w-full text-sm bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 disabled:opacity-50 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                {t('explorer.namespaceId')}
              </label>
              <input
                type="text"
                value={nsId}
                onChange={(e) => setNsId(e.target.value)}
                disabled={status === 'running'}
                placeholder="E74B99BA41F4AFEE"
                className="w-full text-sm bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 disabled:opacity-50 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                {t('explorer.divisibility')}
              </label>
              <input
                type="number"
                value={divisibility}
                onChange={(e) => setDivisibility(e.target.value)}
                disabled={status === 'running'}
                min={0}
                max={6}
                className="w-full text-sm bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 disabled:opacity-50 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap gap-3 pt-2">
        {/* Build (when not built or error) */}
        {(status === 'not-built' || status === 'error') && (
          <button
            onClick={handleBuild}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Hammer className="w-4 h-4" />
            )}
            {t('explorer.build')}
          </button>
        )}

        {/* Start + Rebuild (when stopped) */}
        {status === 'stopped' && (
          <>
            <button
              onClick={handleStart}
              disabled={loading || !nodeRunning}
              title={!nodeRunning ? t('explorer.nodeRequired') : ''}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {t('explorer.start')}
            </button>
            <button
              onClick={handleBuild}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-400 rounded-lg text-sm transition-colors border border-zinc-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('explorer.rebuild')}
            </button>
          </>
        )}

        {/* Stop (when running) */}
        {status === 'running' && (
          <button
            onClick={handleStop}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Square className="w-4 h-4 fill-current" />
            )}
            {t('explorer.stop')}
          </button>
        )}

        {/* Node not running hint */}
        {!nodeRunning && status === 'stopped' && (
          <span className="text-xs text-amber-400 self-center">
            {t('explorer.nodeRequired')}
          </span>
        )}
      </div>
    </div>
  );
}
