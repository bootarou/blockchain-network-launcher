import React, { useState, useEffect } from 'react';
import { Server, RotateCcw, Globe, HelpCircle, Share2, ShieldCheck, Languages, Sun, Moon, LogOut, Cloud, Wrench, Play } from 'lucide-react';
import { ConfigForm } from './components/ConfigForm';
import { Dashboard } from './components/Dashboard';
import { JoinNetwork } from './components/JoinNetwork';
import { ShareNetwork } from './components/ShareNetwork';
import { BackupRestore } from './components/BackupRestore';
import { HelpPage } from './components/HelpPage';
import { ManagementPage } from './components/ManagementPage';
import { ExplorerPage } from './components/ExplorerPage';
import { OperationsPage } from './components/OperationsPage';
import { PublishNetwork } from './components/PublishNetwork';
import { SidebarNav } from './components/SidebarNav';
import { LoginPage } from './components/LoginPage';
import { NodeHealthIndicator } from './components/NodeHealthIndicator';
import { DEFAULT_PRESET, DEFAULT_NODE, DEFAULT_GATEWAY, type PresetConfig, type NodeConfig, type GatewayConfig } from './constants';
import { api } from './lib/api';
import { setAuthToken, clearAuthToken } from './lib/api';
import { useTranslation } from './i18n';
import { useTheme } from './theme';

function App() {
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_PRESET);
  const [activePanel, setActivePanel] = useState<'config' | 'dashboard' | 'operations' | 'manage' | 'explorer' | 'join' | 'share' | 'publish' | 'backup' | 'help'>('config');
  const { t, lang, setLang } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  // ── Auth state ──
  const [authRequired, setAuthRequired] = useState<boolean | null>(null); // null = loading
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    api.getAuthStatus().then(({ authRequired: required }) => {
      setAuthRequired(required);
      if (!required) {
        setAuthenticated(true);
      } else {
        // Check if existing token is still valid
        api.verifyToken().then((valid) => {
          setAuthenticated(valid);
        });
      }
    });
  }, []);

  const handleLogin = (token: string) => {
    setAuthToken(token);
    setAuthenticated(true);
  };

  const handleLogout = () => {
    clearAuthToken();
    setAuthenticated(false);
  };

  // Load saved preset from backend on mount
  useEffect(() => {
    if (!authenticated) return;
    api
      .loadPreset()
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          // Shallow-merge over DEFAULT_PRESET so all scalar fields are updated.
          const merged = { ...DEFAULT_PRESET, ...data } as PresetConfig;
          // Deep-merge each node/gateway with its default template so that
          // fields not stored in custom-preset.yml (e.g. enableTransactionSpamThrottling)
          // still show their correct defaults instead of appearing blank/false.
          if (Array.isArray(data.nodes)) {
            merged.nodes = (data.nodes as NodeConfig[]).map((n) => ({ ...DEFAULT_NODE, ...n }));
          }
          if (Array.isArray(data.gateways)) {
            merged.gateways = (data.gateways as GatewayConfig[]).map((g) => ({ ...DEFAULT_GATEWAY, ...g }));
          }
          // Auto-fill empty node host with browser hostname (skip localhost/127.0.0.1)
          const browserHost = window.location.hostname;
          const isLocal = !browserHost || browserHost === 'localhost' || browserHost === '127.0.0.1' || browserHost === '::1';
          if (!isLocal) {
            merged.nodes = merged.nodes.map((n) =>
              !n.host ? { ...n, host: browserHost } : n
            );
          }
          setConfig(merged);
        }
      })
      .catch(() => {}); // Silently ignore when backend is not running
  }, [authenticated]);

  const handleConfigChange = (newConfig: PresetConfig) => {
    setConfig(newConfig);
  };

  const handleConfigImport = (imported: PresetConfig) => {
    setConfig({ ...DEFAULT_PRESET, ...imported });
  };

  /** Merge helper: if _joinMinFeeMultiplier is present, apply it to nodes[] */
  const applyJoinDefaults = (imported: PresetConfig): PresetConfig => {
    const raw = imported as Record<string, unknown>;
    const minFee = raw._joinMinFeeMultiplier;
    const base = { ...DEFAULT_PRESET, ...imported };
    // Remove temporary key
    delete (base as Record<string, unknown>)._joinMinFeeMultiplier;
    if (typeof minFee === 'number') {
      base.nodes = (base.nodes ?? DEFAULT_PRESET.nodes).map((n) => ({
        ...DEFAULT_NODE,
        ...n,
        minFeeMultiplier: minFee,
      }));
    }
    return base;
  };

  /** Import from Join Network — apply and switch to Configuration tab */
  const handleJoinImport = (imported: PresetConfig) => {
    setConfig(applyJoinDefaults(imported));
    setActivePanel('config');
  };

  /** Import from Share Network — apply and switch to Configuration tab */
  const handleShareImport = (imported: PresetConfig) => {
    setConfig({ ...DEFAULT_PRESET, ...imported });
    setActivePanel('config');
  };

  const handleResetDefaults = () => {
    if (confirm(t('app.resetConfirm'))) {
      setConfig(DEFAULT_PRESET);
    }
  };

  // ── Auth early returns (MUST be after all hooks) ──
  if (authRequired === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <Server className="w-8 h-8 text-indigo-400 animate-pulse" />
      </div>
    );
  }
  if (authRequired && !authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 lg:flex">
      <SidebarNav activePanel={activePanel} onNavigate={setActivePanel} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* ── Header ── */}
        <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Workspace</p>
              <h2 className="truncate text-sm font-medium text-zinc-200">
                {t('app.subtitle')}
              </h2>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={toggleTheme}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>

              <button
                onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                title={lang === 'ja' ? 'Switch to English' : '日本語に切り替え'}
              >
                <Languages className="w-3.5 h-3.5" />
                {lang === 'ja' ? 'EN' : 'JA'}
              </button>

              <button
                onClick={handleResetDefaults}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                title={t('app.resetToDefaults')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('app.reset')}
              </button>

              {authRequired && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-zinc-800 hover:text-red-300"
                  title={t('login.logout')}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('login.logout')}</span>
                </button>
              )}
            </div>
          </div>
        </header>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-6xl">
        {activePanel === 'config' ? (
          <ConfigForm config={config} onChange={handleConfigChange} />
        ) : activePanel === 'join' ? (
          <JoinNetwork onConfigImport={handleJoinImport} />
        ) : activePanel === 'share' ? (
          <ShareNetwork onConfigImport={handleShareImport} />
        ) : activePanel === 'operations' ? (
          <OperationsPage config={config} onConfigImport={handleConfigImport} />
        ) : activePanel === 'manage' ? (
          <ManagementPage />
        ) : activePanel === 'explorer' ? (
          <ExplorerPage config={config} />
        ) : activePanel === 'publish' ? (
          <PublishNetwork />
        ) : activePanel === 'backup' ? (
          <BackupRestore />
        ) : activePanel === 'help' ? (
          <HelpPage />
        ) : (
          <Dashboard />
        )}
        </div>
      </main>

      {/* ── Footer ── */}
        <footer className="border-t border-zinc-800 py-4 text-center text-xs text-zinc-600 space-y-1">
          <p>{t('app.footer')}</p>
          <p>
            {t('app.poweredBy')}{' '}
            <a href="https://symbolplatform.com" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-indigo-400 transition-colors">
              Symbol / NEM
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
