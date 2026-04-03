import React, { useState, useEffect } from 'react';
import { Server, RotateCcw, Globe, HelpCircle, Share2, ShieldCheck, Languages, Sun, Moon, LogOut } from 'lucide-react';
import { ConfigForm } from './components/ConfigForm';
import { Dashboard } from './components/Dashboard';
import { JoinNetwork } from './components/JoinNetwork';
import { ShareNetwork } from './components/ShareNetwork';
import { BackupRestore } from './components/BackupRestore';
import { HelpPage } from './components/HelpPage';
import { LoginPage } from './components/LoginPage';
import { NodeHealthIndicator } from './components/NodeHealthIndicator';
import { DEFAULT_PRESET, DEFAULT_NODE, DEFAULT_GATEWAY, type PresetConfig, type NodeConfig, type GatewayConfig } from './constants';
import { api } from './lib/api';
import { setAuthToken, clearAuthToken } from './lib/api';
import { useTranslation } from './i18n';
import { useTheme } from './theme';

function App() {
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_PRESET);
  const [activePanel, setActivePanel] = useState<'config' | 'dashboard' | 'join' | 'share' | 'backup' | 'help'>('config');
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
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="w-7 h-7 text-indigo-400" />
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent leading-tight">
                {t('app.title')}
              </h1>
              <p className="text-zinc-600 text-xs">{t('app.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Node health indicator */}
            <NodeHealthIndicator />

            {/* Panel toggle (mobile-friendly) */}
            <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setActivePanel('config')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activePanel === 'config'
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('tabs.config')}
              </button>
              <button
                onClick={() => setActivePanel('join')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activePanel === 'join'
                    ? 'bg-emerald-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                {t('tabs.join')}
              </button>
              <button
                onClick={() => setActivePanel('share')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activePanel === 'share'
                    ? 'bg-sky-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Share2 className="w-3.5 h-3.5" />
                {t('tabs.share')}
              </button>
              <button
                onClick={() => setActivePanel('dashboard')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activePanel === 'dashboard'
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('tabs.dashboard')}
              </button>
              <button
                onClick={() => setActivePanel('backup')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activePanel === 'backup'
                    ? 'bg-teal-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {t('tabs.backup')}
              </button>
              <button
                onClick={() => setActivePanel('help')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activePanel === 'help'
                    ? 'bg-amber-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {t('tabs.help')}
              </button>
            </div>

            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
              title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
              title={lang === 'ja' ? 'Switch to English' : '日本語に切り替え'}
            >
              <Languages className="w-3.5 h-3.5" />
              {lang === 'ja' ? 'EN' : 'JA'}
            </button>

            <button
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
              title={t('app.resetToDefaults')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('app.reset')}
            </button>

            {authRequired && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800 rounded-lg transition-colors border border-red-800/50"
                title={t('login.logout')}
              >
                <LogOut className="w-3.5 h-3.5" />
                {t('login.logout')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
        {activePanel === 'config' ? (
          <ConfigForm config={config} onChange={handleConfigChange} />
        ) : activePanel === 'join' ? (
          <JoinNetwork onConfigImport={handleJoinImport} />
        ) : activePanel === 'share' ? (
          <ShareNetwork onConfigImport={handleShareImport} />
        ) : activePanel === 'backup' ? (
          <BackupRestore />
        ) : activePanel === 'help' ? (
          <HelpPage />
        ) : (
          <Dashboard config={config} onConfigImport={handleConfigImport} />
        )}
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
  );
}

export default App;
