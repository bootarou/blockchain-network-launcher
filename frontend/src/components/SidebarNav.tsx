import React from 'react';
import {
  Globe,
  LayoutDashboard,
  Settings,
  Share2,
  ShieldCheck,
  HelpCircle,
  Cloud,
  Wrench,
  Play,
  BookOpen,
  Monitor,
  X,
} from 'lucide-react';
import { NodeHealthIndicator } from './NodeHealthIndicator';
import { useTranslation } from '../i18n';

type ActivePanel =
  | 'config'
  | 'dashboard'
  | 'operations'
  | 'manage'
  | 'explorer'
  | 'join'
  | 'share'
  | 'publish'
  | 'backup'
  | 'help';

interface SidebarNavProps {
  activePanel: ActivePanel;
  onNavigate: (panel: ActivePanel) => void;
  /** Mobile drawer state — controlled by the hamburger button in the App header. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

type NavItem = {
  id: ActivePanel;
  labelKey: string;
  icon: React.ElementType;
  tone: 'indigo' | 'emerald' | 'sky' | 'blue' | 'cyan' | 'violet' | 'teal' | 'amber';
  group: 'core' | 'tools' | 'support';
};

const toneClasses: Record<NavItem['tone'], { active: string; icon: string }> = {
  indigo: { active: 'bg-indigo-600 text-white', icon: 'text-indigo-300' },
  emerald: { active: 'bg-emerald-600 text-white', icon: 'text-emerald-300' },
  sky: { active: 'bg-sky-600 text-white', icon: 'text-sky-300' },
  blue: { active: 'bg-blue-600 text-white', icon: 'text-blue-300' },
  cyan: { active: 'bg-cyan-600 text-white', icon: 'text-cyan-300' },
  violet: { active: 'bg-violet-600 text-white', icon: 'text-violet-300' },
  teal: { active: 'bg-teal-600 text-white', icon: 'text-teal-300' },
  amber: { active: 'bg-amber-600 text-white', icon: 'text-amber-300' },
};

export function SidebarNav({ activePanel, onNavigate, mobileOpen = false, onMobileClose }: SidebarNavProps) {
  const { t } = useTranslation();

  const items: NavItem[] = [
    { id: 'dashboard', labelKey: 'tabs.dashboard', icon: LayoutDashboard, tone: 'indigo', group: 'core' },
    { id: 'operations', labelKey: 'tabs.operations', icon: Play, tone: 'blue', group: 'core' },
    { id: 'config', labelKey: 'tabs.config', icon: Settings, tone: 'indigo', group: 'tools' },
    { id: 'join', labelKey: 'tabs.join', icon: Globe, tone: 'emerald', group: 'tools' },
    { id: 'share', labelKey: 'tabs.share', icon: Share2, tone: 'sky', group: 'tools' },
    { id: 'manage', labelKey: 'tabs.manage', icon: Wrench, tone: 'cyan', group: 'tools' },
    { id: 'explorer', labelKey: 'tabs.explorer', icon: Monitor, tone: 'indigo', group: 'tools' },
    { id: 'publish', labelKey: 'tabs.publish', icon: Cloud, tone: 'violet', group: 'tools' },
    { id: 'backup', labelKey: 'tabs.backup', icon: ShieldCheck, tone: 'teal', group: 'tools' },
    { id: 'help', labelKey: 'tabs.help', icon: HelpCircle, tone: 'amber', group: 'support' },
  ];

  const renderGroup = (group: NavItem['group'], title: string, description: string) => {
    const groupItems = items.filter((item) => item.group === group);
    return (
      <div className="space-y-2">
        <div className="px-2">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">{title}</p>
          <p className="text-xs text-zinc-600 mt-1">{description}</p>
        </div>
        <div className="space-y-1">
          {groupItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePanel === item.id;
            const palette = toneClasses[item.tone];
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all border ${
                  isActive
                    ? `${palette.active} border-transparent shadow-lg shadow-black/20`
                    : 'bg-zinc-950/40 text-zinc-300 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                  isActive
                    ? 'border-white/15 bg-white/10'
                    : 'border-zinc-700 bg-zinc-900'
                }`}>
                  <Icon className={`w-4.5 h-4.5 ${isActive ? 'text-white' : palette.icon}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-tight">{t(item.labelKey)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const navContent = (
    <div className="p-4 lg:p-5 space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <h1 className="text-lg font-bold leading-tight bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">
                {t('app.title')}
              </h1>
            </div>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{t('app.subtitle')}</p>
          </div>
          <div className="hidden lg:block">
            <NodeHealthIndicator />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {renderGroup('core', t('sidebar.groupCore'), t('sidebar.groupCoreDesc'))}
        {renderGroup('tools', t('sidebar.groupTools'), t('sidebar.groupToolsDesc'))}
        {renderGroup('support', t('sidebar.groupSupport'), t('sidebar.groupSupportDesc'))}
      </div>

      <div className="lg:hidden pt-2">
        <NodeHealthIndicator />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed sidebar (unchanged behaviour) */}
      <aside className="hidden lg:block lg:w-80 xl:w-84 shrink-0 border-r border-zinc-800 bg-zinc-950/95 backdrop-blur-sm lg:sticky lg:top-0 lg:h-screen overflow-y-auto">
        {navContent}
      </aside>

      {/* Mobile: slide-over drawer opened from the header hamburger */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-80 max-w-[85vw] overflow-y-auto border-r border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex justify-end px-4 pt-3 -mb-2">
              <button
                onClick={onMobileClose}
                aria-label="Close menu"
                className="rounded-lg border border-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}