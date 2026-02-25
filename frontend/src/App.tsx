import React, { useState, useEffect } from 'react';
import { Server, RotateCcw, Globe, HelpCircle, Share2 } from 'lucide-react';
import { ConfigForm } from './components/ConfigForm';
import { Dashboard } from './components/Dashboard';
import { JoinNetwork } from './components/JoinNetwork';
import { ShareNetwork } from './components/ShareNetwork';
import { HelpPage } from './components/HelpPage';
import { NodeHealthIndicator } from './components/NodeHealthIndicator';
import { DEFAULT_PRESET, type PresetConfig } from './constants';
import { api } from './lib/api';

function App() {
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_PRESET);
  const [activePanel, setActivePanel] = useState<'config' | 'dashboard' | 'join' | 'share' | 'help'>('config');

  // Load saved preset from backend on mount
  useEffect(() => {
    api
      .loadPreset()
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setConfig((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(console.error);
  }, []);

  const handleConfigChange = (newConfig: PresetConfig) => {
    setConfig(newConfig);
  };

  const handleConfigImport = (imported: PresetConfig) => {
    setConfig({ ...DEFAULT_PRESET, ...imported });
  };

  /** Import from Join Network — apply and switch to Configuration tab */
  const handleJoinImport = (imported: PresetConfig) => {
    setConfig({ ...DEFAULT_PRESET, ...imported });
    setActivePanel('config');
  };

  /** Import from Share Network — apply and switch to Configuration tab */
  const handleShareImport = (imported: PresetConfig) => {
    setConfig({ ...DEFAULT_PRESET, ...imported });
    setActivePanel('config');
  };

  const handleResetDefaults = () => {
    if (confirm('全ての設定をデフォルト値にリセットしますか？')) {
      setConfig(DEFAULT_PRESET);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="w-7 h-7 text-indigo-400" />
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent leading-tight">
                Symbol Network Manager
              </h1>
              <p className="text-zinc-600 text-xs">Catapult v1.0.3.1 · Aggregate V3</p>
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
                Configuration
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
                Join Network
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
                Share
              </button>
              <button
                onClick={() => setActivePanel('dashboard')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activePanel === 'dashboard'
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Dashboard
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
                Help
              </button>
            </div>

            <button
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
              title="Reset to defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-8">
        {/* Desktop: side-by-side / Mobile: toggle */}
        {activePanel === 'help' ? (
          <div className="hidden xl:block">
            <HelpPage />
          </div>
        ) : activePanel === 'share' ? (
          <div className="hidden xl:grid xl:grid-cols-2 xl:gap-8">
            <div>
              <ShareNetwork onConfigImport={handleShareImport} />
            </div>
            <div className="sticky top-24 self-start">
              <Dashboard config={config} onConfigImport={handleConfigImport} />
            </div>
          </div>
        ) : (
        <div className="hidden xl:grid xl:grid-cols-2 xl:gap-8">
          <div>
            {activePanel === 'join' ? (
              <JoinNetwork onConfigImport={handleJoinImport} />
            ) : (
              <ConfigForm config={config} onChange={handleConfigChange} />
            )}
          </div>
          <div className="sticky top-24 self-start">
            <Dashboard config={config} onConfigImport={handleConfigImport} />
          </div>
        </div>
        )}

        {/* Mobile / Tablet: single panel */}
        <div className="xl:hidden">
          {activePanel === 'config' ? (
            <ConfigForm config={config} onChange={handleConfigChange} />
          ) : activePanel === 'join' ? (
            <JoinNetwork onConfigImport={handleJoinImport} />
          ) : activePanel === 'share' ? (
            <ShareNetwork onConfigImport={handleShareImport} />
          ) : activePanel === 'help' ? (
            <HelpPage />
          ) : (
            <Dashboard config={config} onConfigImport={handleConfigImport} />
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-zinc-800 py-4 text-center text-xs text-zinc-600 space-y-1">
        <p>Symbol Custom Network Manager · Docker-in-Docker · symbol-bootstrap</p>
        <p>
          Powered by{' '}
          <a href="https://symbolplatform.com" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-indigo-400 transition-colors">
            Symbol / NEM
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
