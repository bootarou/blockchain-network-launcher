import React, { useCallback, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import type { PresetConfig } from '../constants';
import { ExplorerManager } from './ExplorerManager';

interface ExplorerPageProps {
  config: PresetConfig;
}

export function ExplorerPage({ config }: ExplorerPageProps) {
  const { t } = useTranslation();
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

  const nodeRunning = networkState === 'running';

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-bold">{t('explorer.title')}</h2>
        </div>
        <p className="text-zinc-400 text-sm">{t('explorer.pageDescription')}</p>
      </div>

      <ExplorerManager config={config} nodeRunning={nodeRunning} />
    </div>
  );
}