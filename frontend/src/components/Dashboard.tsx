import React from 'react';
import { useTranslation } from '../i18n';
import { BarChart3 } from 'lucide-react';
import { NodeStats } from './NodeStats';

export function Dashboard() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          {t('dashboard.overviewTitle')}
        </h2>
        <p className="text-zinc-400 text-sm">{t('dashboard.overviewDescription')}</p>
      </div>

      <NodeStats />
    </div>
  );
}
