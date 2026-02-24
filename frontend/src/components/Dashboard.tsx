import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import { api } from '../lib/api';
import { configToYaml, yamlToConfig } from '../lib/utils';
import type { PresetConfig } from '../constants';
import { TerminalLogs } from './TerminalLogs';
import { NodeStats } from './NodeStats';
import { ImageManager } from './ImageManager';

type CommandStatus = 'idle' | 'running' | 'success' | 'error';

interface DashboardProps {
  config: PresetConfig;
  onConfigImport: (newConfig: PresetConfig) => void;
}

export function Dashboard({ config, onConfigImport }: DashboardProps) {
  const [addresses, setAddresses] = useState<unknown>(null);
  const [password, setPassword] = useState('');
  const [cmdStatus, setCmdStatus] = useState<Record<string, CommandStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Command helpers ────────────────────────────────────────────────────

  const runCommand = async (cmd: string, payload?: Record<string, unknown>) => {
    setCmdStatus((s) => ({ ...s, [cmd]: 'running' }));
    try {
      const res = await api.sendCommand(cmd, payload);
      if (res.error) {
        setCmdStatus((s) => ({ ...s, [cmd]: 'error' }));
        alert(res.error);
      } else {
        setCmdStatus((s) => ({ ...s, [cmd]: 'success' }));
        setTimeout(() => setCmdStatus((s) => ({ ...s, [cmd]: 'idle' })), 3000);
      }
    } catch {
      setCmdStatus((s) => ({ ...s, [cmd]: 'error' }));
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
      alert('ネットワーク暗号化パスワードを入力してください。');
      return;
    }
    await api.savePreset(config);
    await runCommand('start', { password });
  };

  const handleStop = () => runCommand('stop');
  const handleHealthCheck = () => runCommand('healthCheck');

  const handleReset = () => {
    if (confirm('全てのネットワークデータをリセットしますか？')) {
      runCommand('resetData');
    }
  };

  const handleFullReset = () => {
    if (confirm('⚠️ 完全初期化：全ての設定・データ・証明書を削除して初期状態に戻します。\n\nこの操作は取り消せません。続行しますか？')) {
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
        alert('プリセットを正常にインポートしました。');
      } catch (err) {
        alert('ファイルの解析に失敗しました: ' + (err as Error).message);
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
      alert('addresses.yml がまだ生成されていないか、取得に失敗しました。');
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

      {/* ── Node Statistics ── */}
      <NodeStats />

      {/* ── Network Controls ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-5 text-zinc-100">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          Network Controls
        </h2>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            Network Encryption Password
          </label>
          <input
            type="password"
            placeholder="Enter secure password..."
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
            Save
            <StatusIcon cmd="save" />
          </button>

          <button
            onClick={handleStart}
            disabled={cmdStatus.start === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            Start
            <StatusIcon cmd="start" />
          </button>

          <button
            onClick={handleStop}
            disabled={cmdStatus.stop === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Square className="w-4 h-4 fill-current" />
            Stop
            <StatusIcon cmd="stop" />
          </button>

          <button
            onClick={handleHealthCheck}
            disabled={cmdStatus.healthCheck === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Activity className="w-4 h-4" />
            Health Check
            <StatusIcon cmd="healthCheck" />
          </button>

          <button
            onClick={handleReset}
            disabled={cmdStatus.resetData === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-lg font-medium transition-colors ml-auto border border-zinc-600"
          >
            <Trash2 className="w-4 h-4" />
            Reset
            <StatusIcon cmd="resetData" />
          </button>

          <button
            onClick={handleFullReset}
            disabled={cmdStatus.fullReset === 'running'}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded-lg font-medium transition-colors border border-red-700"
          >
            <Trash2 className="w-4 h-4" />
            完全初期化
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
            Export YAML
          </button>

          <button
            onClick={exportJson}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <FileDown className="w-4 h-4" />
            Export JSON
          </button>

          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <Upload className="w-4 h-4" />
            Import (JSON / YAML)
          </button>

          <button
            onClick={fetchAddresses}
            className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-900/50 text-indigo-300 rounded-lg text-sm transition-colors border border-indigo-500/30 ml-auto"
          >
            <FileText className="w-4 h-4" />
            View Addresses
          </button>
        </div>
      </div>

      {/* ── Addresses viewer ── */}
      {addresses && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-indigo-300">target/addresses.yml</h3>
            <div className="flex gap-3">
              <button
                onClick={downloadAddresses}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Download
              </button>
              <button
                onClick={() => setAddresses(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="text-xs text-green-400 bg-black/50 p-4 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(addresses, null, 2)}
          </pre>
        </div>
      )}

      {/* ── Docker Images ── */}
      <ImageManager />

      {/* ── Terminal ── */}
      <TerminalLogs />
    </div>
  );
}
