import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, RefreshCw, Server, Database, Wifi, WifiOff } from 'lucide-react';
import { api, getAuthToken } from '../lib/api';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

// In production the backend serves the frontend on the same port -> same host.
// In dev mode Vite proxies /manager-ws -> ws://localhost:4000 (see vite.config.ts).
const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export interface NodeHealth {
  status: 'unknown' | 'up' | 'down';
  statusCode: number | null;
  apiNode: string;
  db: string;
  lastCheck: string;
}

export function NodeHealthIndicator() {
  const [health, setHealth] = useState<NodeHealth>({
    status: 'unknown',
    statusCode: null,
    apiNode: '',
    db: '',
    lastCheck: '',
  });
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // ── Close dropdown on outside click ────────────────────────────────────
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  // ── WebSocket subscription for NODE_HEALTH ────────────────────────────
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let retryDelay = 3000; // start at 3s, exponential backoff up to 30s

    const connect = () => {
      if (disposed) return;
      // In dev mode, Vite proxies /manager-ws -> ws://localhost:4000
      // In production, the backend handles the upgrade on the same port
      const token = getAuthToken();
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const wsTarget = import.meta.env.DEV ? `${WS_URL}/manager-ws${tokenParam}` : `${WS_URL}${tokenParam}`;
      ws = new WebSocket(wsTarget);

      ws.onopen = () => {
        retryDelay = 3000; // reset on successful connection
      };
      ws.onclose = () => {
        if (disposed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000); // backoff: 3→6→12→24→30s
      };
      ws.onerror = () => {
        // Suppress console noise — onclose will handle reconnection
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'NODE_HEALTH') {
            setHealth(msg.data);
          }
        } catch {
          // ignore
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  // ── Initial fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    api.getNodeHealth().then(setHealth).catch(() => {});
  }, []);

  // ── Manual refresh ─────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.refreshNodeHealth();
      setHealth(data);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  }, []);

  const statusColor =
    health.status === 'up'
      ? 'bg-emerald-500'
      : health.status === 'down'
        ? 'bg-red-500'
        : 'bg-zinc-600';

  const statusBorder =
    health.status === 'up'
      ? 'border-emerald-700'
      : health.status === 'down'
        ? 'border-red-700'
        : 'border-zinc-700';

  const statusText =
    health.status === 'up'
      ? t('health.nodeRunning')
      : health.status === 'down'
        ? t('health.nodeOffline')
        : t('health.checking');

  const statusTextColor =
    health.status === 'up'
      ? 'text-emerald-400'
      : health.status === 'down'
        ? 'text-red-400'
        : 'text-zinc-500';

  const lastCheckStr = health.lastCheck
    ? new Date(health.lastCheck).toLocaleTimeString('ja-JP')
    : '—';

  return (
    <div className="relative" ref={containerRef}>
      {/* ── Compact indicator ── */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs',
          'hover:bg-zinc-800/80',
          statusBorder,
          expanded ? 'bg-zinc-800/60' : 'bg-zinc-900/60'
        )}
        title={t('health.clickDetails', { status: statusText })}
      >
        {/* Pulsing dot */}
        <span className="relative flex h-2.5 w-2.5">
          {health.status === 'up' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          )}
          <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', statusColor)} />
        </span>

        <span className={cn('font-medium', statusTextColor)}>{statusText}</span>

        {health.status === 'up' ? (
          <Wifi className="w-3.5 h-3.5 text-emerald-500" />
        ) : health.status === 'down' ? (
          <WifiOff className="w-3.5 h-3.5 text-red-500" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-zinc-600" />
        )}
      </button>

      {/* ── Expanded dropdown ── */}
      {expanded && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              {t('health.title')}
            </h3>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              title={t('health.refreshNow')}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* API Node */}
            <div className={cn(
              'rounded-lg border p-2.5',
              health.apiNode === 'up'
                ? 'border-emerald-800/60 bg-emerald-950/30'
                : 'border-zinc-800 bg-zinc-950/50'
            )}>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1">
                <Server className="w-3 h-3" />
                {t('health.apiNode')}
              </div>
              <p className={cn(
                'text-sm font-semibold',
                health.apiNode === 'up' ? 'text-emerald-400' : 'text-red-400'
              )}>
                {health.apiNode || '—'}
              </p>
            </div>

            {/* Database */}
            <div className={cn(
              'rounded-lg border p-2.5',
              health.db === 'up'
                ? 'border-emerald-800/60 bg-emerald-950/30'
                : 'border-zinc-800 bg-zinc-950/50'
            )}>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1">
                <Database className="w-3 h-3" />
                {t('health.database')}
              </div>
              <p className={cn(
                'text-sm font-semibold',
                health.db === 'up' ? 'text-emerald-400' : 'text-red-400'
              )}>
                {health.db || '—'}
              </p>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-1 text-xs text-zinc-500 border-t border-zinc-800 pt-2">
            <div className="flex justify-between">
              <span>{t('health.httpStatus')}</span>
              <span className="text-zinc-400 font-mono">
                {health.statusCode ?? '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t('health.lastCheck')}</span>
              <span className="text-zinc-400">{lastCheckStr}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('health.polling')}</span>
              <span className="text-zinc-400">{t('health.every10s')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
