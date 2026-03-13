import React, { useState, useEffect } from 'react';
import {
  CATEGORIES,
  CATAPULT_VERSIONS,
  NODE_FIELDS,
  GATEWAY_FIELDS,
  DEFAULT_NODE,
  DEFAULT_GATEWAY,
  DEFAULT_INFLATION_ENTRY,
  DEFAULT_HARVEST_MOSAIC,
  NEMESIS_MOSAIC_FIELDS,
  PRESET_OVERRIDES,
  type PresetConfig,
  type FieldMeta,
  type NodeConfig,
  type GatewayConfig,
  type InflationEntry,
  type NemesisMosaic,
} from '../constants';
import {
  Network,
  Server,
  Router,
  Settings,
  Image as ImageIcon,
  Globe,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Code2,
  Info,
  Blocks,
  Coins,
  Sprout,
  Vote,
  Layers,
  Lock,
  KeyRound,
  FileText,
  Hexagon,
  Tag,
  Users,
  ShieldCheck,
  Send,
  TrendingDown,
  Gem,
  AlertTriangle,
} from 'lucide-react';
import { configToYaml } from '../lib/utils';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

// Icon mapping per category
const ICON_MAP: Record<string, React.ElementType> = {
  general: Settings,
  nemesisMosaics: Gem,
  images: ImageIcon,
  chain: Blocks,
  fees: Coins,
  harvesting: Sprout,
  voting: Vote,
  aggregate: Layers,
  hashlock: Lock,
  secretlock: KeyRound,
  metadata: FileText,
  mosaic: Hexagon,
  namespace: Tag,
  multisig: Users,
  restriction: ShieldCheck,
  transfer: Send,
  inflation: TrendingDown,
  nodes: Server,
  gateways: Router,
  explorer: Globe,
};

// ─── Generic field renderer ────────────────────────────────────────────────

function FieldRenderer({
  field,
  value,
  onChange,
  preset,
}: {
  field: FieldMeta;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  preset?: string;
}) {
  const { t } = useTranslation();
  const base =
    'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors';

  // Show auto-generation note for mosaic ID fields in bootstrap preset
  const showAutoGenNote = field.autoGenOnBootstrap && preset === 'bootstrap';

  switch (field.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-3 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="w-5 h-5 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
              {field.label}
            </span>
            <p className="text-xs text-zinc-500">{field.description}</p>
          </div>
        </label>
      );

    case 'select':
      return (
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">
            {field.label}
            <span className="ml-2 text-xs text-zinc-600" title={field.description}>
              <Info className="inline w-3 h-3" />
            </span>
          </label>
          <select
            value={String(value ?? '')}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={base}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'number':
      return (
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">
            {field.label}
            <span className="ml-2 text-xs text-zinc-600" title={field.description}>
              <Info className="inline w-3 h-3" />
            </span>
          </label>
          <input
            type="number"
            value={value as number}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
            className={base}
          />
        </div>
      );

    case 'textarea':
      return (
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">
            {field.label}
            <span className="ml-2 text-xs text-zinc-600" title={field.description}>
              <Info className="inline w-3 h-3" />
            </span>
          </label>
          <textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(field.key, e.target.value)}
            rows={4}
            className={base + ' resize-y'}
          />
        </div>
      );

    default:
      return (
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">
            {field.label}
            <span className="ml-2 text-xs text-zinc-600" title={field.description}>
              <Info className="inline w-3 h-3" />
            </span>
          </label>
          <input
            type="text"
            value={String(value ?? '')}
            placeholder={showAutoGenNote ? t('field.mosaicId.autoGenNote') : field.placeholder}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={base}
          />
          {showAutoGenNote && (
            <p className="mt-1 text-xs text-amber-400/80">
              {t('field.mosaicId.autoGenNote')}
            </p>
          )}
        </div>
      );
  }
}

// ─── Array item editor (nodes / gateways) ──────────────────────────────────

function ArrayItemEditor<T extends Record<string, unknown>>({
  item,
  index,
  fields,
  onChange,
  onRemove,
}: {
  item: T;
  index: number;
  fields: FieldMeta[];
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const title = (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).apiNodeName ?? `#${index}`;

  return (
    <div className="border border-zinc-700 rounded-xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(!open); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/60 hover:bg-zinc-800 transition-colors cursor-pointer"
      >
        <span className="text-sm font-medium text-zinc-200">{String(title)}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
        </div>
      </div>
      {open && (
        <div className="p-4 space-y-3 bg-zinc-900/50">
          {fields.map((f) => (
            <FieldRenderer
              key={f.key}
              field={f}
              value={item[f.key]}
              onChange={(_key, val) => onChange(index, f.key, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ConfigForm ───────────────────────────────────────────────────────

interface ConfigFormProps {
  config: PresetConfig;
  onChange: (newConfig: PresetConfig) => void;
}

export function ConfigForm({ config, onChange }: ConfigFormProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const [showYaml, setShowYaml] = useState(false);
  const [isDockerDesktop, setIsDockerDesktop] = useState(false);

  useEffect(() => {
    api.getDockerEnv().then((env) => setIsDockerDesktop(env.isDockerDesktop));
  }, []);

  // Scalar field change — with preset auto-switch & version auto-fill
  const handleFieldChange = (key: string, value: unknown) => {
    if (key === 'preset') {
      const overrides = PRESET_OVERRIDES[value as string];
      if (overrides) {
        onChange({ ...config, preset: value as string, ...overrides });
        return;
      }
    }
    // When catapult version changes, auto-fill image fields
    if (key === 'catapultVersion') {
      const ver = CATAPULT_VERSIONS.find((v) => v.id === value);
      if (ver) {
        onChange({
          ...config,
          catapultVersion: ver.id,
          symbolServerImage: ver.symbolServerImage,
          symbolRestImage: ver.symbolRestImage,
          symbolServerToolsImage: ver.symbolServerToolsImage,
        });
        return;
      }
    }
    // baseNamespace: keep reservedRootNamespaceNames in sync
    if (key === 'baseNamespace') {
      const oldBase = (config.baseNamespace ?? '').trim().toLowerCase();
      const newBase = (value as string ?? '').trim().toLowerCase();
      const reserved = (config.reservedRootNamespaceNames ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // Remove old value, then add new value (avoid duplicates)
      const withoutOld = oldBase ? reserved.filter((n) => n !== oldBase) : reserved;
      const withNew = newBase && !withoutOld.includes(newBase)
        ? [...withoutOld, newBase]
        : withoutOld;
      onChange({
        ...config,
        baseNamespace: value as string,
        reservedRootNamespaceNames: withNew.join(', '),
      });
      return;
    }
    // networkType and networkIdentifier are 1-to-1: auto-sync the numeric ID
    if (key === 'networkType') {
      const NETWORK_TYPE_TO_ID: Record<string, number> = {
        mainnet: 104, testnet: 152, private: 120, privateTest: 168,
      };
      const id = NETWORK_TYPE_TO_ID[value as string];
      if (id !== undefined) {
        onChange({ ...config, networkType: value as string, networkIdentifier: id });
        return;
      }
    }
    onChange({ ...config, [key]: value });
  };

  // Node helpers
  const handleNodeChange = (index: number, key: string, value: unknown) => {
    const oldName = config.nodes[index]?.name;
    const updated = config.nodes.map((n, i) => (i === index ? { ...n, [key]: value } : n));
    // When a node is renamed, auto-update any gateways that referenced the old name
    let updatedGateways = config.gateways;
    if (key === 'name' && oldName && value !== oldName) {
      updatedGateways = config.gateways.map((g) =>
        g.apiNodeName === oldName ? { ...g, apiNodeName: String(value), host: String(value) } : g,
      );
    }
    onChange({ ...config, nodes: updated, gateways: updatedGateways });
  };
  const addNode = () => {
    const idx = config.nodes.length;
    onChange({
      ...config,
      nodes: [...config.nodes, { ...DEFAULT_NODE, name: `api-node-${idx}`, friendlyName: `Node ${idx}` }],
    });
  };
  const removeNode = (index: number) => {
    onChange({ ...config, nodes: config.nodes.filter((_, i) => i !== index) });
  };

  // Gateway helpers
  const handleGatewayChange = (index: number, key: string, value: unknown) => {
    const updated = config.gateways.map((g, i) => {
      if (i !== index) return g;
      // apiNodeName is the Docker service name = host in rest.json: keep in sync
      if (key === 'apiNodeName') return { ...g, apiNodeName: String(value), host: String(value) };
      return { ...g, [key]: value };
    });
    onChange({ ...config, gateways: updated });
  };
  const addGateway = () => {
    const idx = config.gateways.length;
    const nodeName = config.nodes[0]?.name ?? 'api-node-0';
    onChange({
      ...config,
      gateways: [...config.gateways, { ...DEFAULT_GATEWAY, apiNodeName: nodeName, host: nodeName, databaseHost: `db-${idx}` }],
    });
  };
  const removeGateway = (index: number) => {
    onChange({ ...config, gateways: config.gateways.filter((_, i) => i !== index) });
  };

  // Inflation helpers
  const handleInflationChange = (index: number, key: string, value: unknown) => {
    const updated = config.inflation.map((e, i) =>
      i === index ? { ...e, [key]: key === 'startHeight' ? Number(value) : value } : e,
    );
    onChange({ ...config, inflation: updated });
  };
  const addInflation = () => {
    const last = config.inflation[config.inflation.length - 1];
    const nextHeight = last ? last.startHeight + 5760 : 2;
    onChange({
      ...config,
      inflation: [...config.inflation, { ...DEFAULT_INFLATION_ENTRY, startHeight: nextHeight }],
    });
  };
  const removeInflation = (index: number) => {
    onChange({ ...config, inflation: config.inflation.filter((_, i) => i !== index) });
  };

  // Nemesis mosaic helpers
  const handleNemesisMosaicChange = (index: number, key: string, value: unknown) => {
    const updated = config.nemesisMosaics.map((m, i) =>
      i === index ? { ...m, [key]: key === 'divisibility' || key === 'duration' ? Number(value) : value } : m,
    );
    onChange({ ...config, nemesisMosaics: updated });
  };
  const harvestMosaicEnabled = config.nemesisMosaics.length >= 2;
  const toggleHarvestMosaic = () => {
    if (harvestMosaicEnabled) {
      // Disabling harvest mosaic → single-currency mode
      // harvestingMosaicId will equal currencyMosaicId, so
      // totalChainImportance must equal the currency mosaic supply.
      const currencySupply = config.nemesisMosaics[0]?.supply ?? '8998999998000000';
      const supplyStr = String(currencySupply).replace(/'/g, '');
      onChange({
        ...config,
        nemesisMosaics: config.nemesisMosaics.slice(0, 1),
        totalChainImportance: supplyStr,
      });
    } else {
      // Enabling harvest mosaic → dual-currency mode
      // totalChainImportance should match the harvest mosaic supply.
      const harvestSupply = String(DEFAULT_HARVEST_MOSAIC.supply).replace(/'/g, '');
      onChange({
        ...config,
        nemesisMosaics: [...config.nemesisMosaics, { ...DEFAULT_HARVEST_MOSAIC }],
        totalChainImportance: harvestSupply,
      });
    }
  };

  // Current category
  const category = CATEGORIES.find((c) => c.id === activeTab)!;

  // Render content per category
  const renderContent = () => {
    // ── Nemesis Mosaics ──
    if (activeTab === 'nemesisMosaics') {
      const isBootstrap = config.preset === 'bootstrap';
      const inputBase =
        'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors';

      if (!isBootstrap) {
        return (
          <div className="space-y-5">
            <div>
              <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
              <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-5 text-sm text-blue-300 space-y-2">
              <p className="font-medium">{t('config.nemesisPublicNotice')}</p>
              <p className="text-blue-400/80">{t('config.nemesisPublicDesc')}</p>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-5">
          <div>
            <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
            <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
          </div>

          {/* Base Namespace */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              {t('config.nemesisBaseNamespace')}
              <span className="ml-2 text-xs text-zinc-600" title={t('field.baseNamespace.desc')}>
                <Info className="inline w-3 h-3" />
              </span>
            </label>
            <input
              type="text"
              value={config.baseNamespace ?? 'cat'}
              onChange={(e) => handleFieldChange('baseNamespace', e.target.value)}
              placeholder="cat"
              className={inputBase}
            />
            <p className="mt-1 text-xs text-zinc-500">{t('config.nemesisBaseNamespaceHelp')}</p>
          </div>

          {/* Currency Mosaic (required) */}
          <div className="border border-indigo-500/30 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-indigo-500/10 border-b border-indigo-500/20">
              <span className="text-sm font-semibold text-indigo-300">
                💰 {t('config.nemesisCurrencyTitle')}
              </span>
              <span className="ml-2 text-xs text-indigo-400/70">{t('config.nemesisCurrencyRequired')}</span>
            </div>
            <div className="p-4 space-y-3 bg-zinc-900/50">
              {NEMESIS_MOSAIC_FIELDS.map((f) => (
                <FieldRenderer
                  key={f.key}
                  field={f}
                  value={config.nemesisMosaics[0]?.[f.key as keyof NemesisMosaic]}
                  onChange={(_key, val) => handleNemesisMosaicChange(0, f.key, val)}
                />
              ))}
            </div>
          </div>

          {/* Harvest Mosaic (optional) */}
          <div className="border border-zinc-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-zinc-800/60 border-b border-zinc-700 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-200">
                🌾 {t('config.nemesisHarvestTitle')}
              </span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-xs text-zinc-400">{t('config.nemesisHarvestToggle')}</span>
                <input
                  type="checkbox"
                  checked={harvestMosaicEnabled}
                  onChange={toggleHarvestMosaic}
                  className="w-5 h-5 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                />
              </label>
            </div>
            {harvestMosaicEnabled && (
              <div className="p-4 space-y-3 bg-zinc-900/50">
                {NEMESIS_MOSAIC_FIELDS.map((f) => (
                  <FieldRenderer
                    key={f.key}
                    field={f}
                    value={config.nemesisMosaics[1]?.[f.key as keyof NemesisMosaic]}
                    onChange={(_key, val) => handleNemesisMosaicChange(1, f.key, val)}
                  />
                ))}
              </div>
            )}
            {!harvestMosaicEnabled && (
              <div className="p-4 text-sm text-zinc-500 italic">
                {t('config.nemesisHarvestDisabledNote')}
              </div>
            )}
          </div>

          {/* Help text */}
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 space-y-2 text-xs text-zinc-500">
            <p>
              <span className="text-zinc-400 font-medium">{t('config.nemesisHelp')}</span>{' '}
              {t('config.nemesisHelpDesc')}
            </p>
            <p>
              <span className="text-zinc-400">{t('config.nemesisHelpMosaicId')}</span>{' '}
              {t('config.nemesisHelpMosaicIdDesc')}
            </p>
          </div>
        </div>
      );
    }

    if (activeTab === 'nodes') {
      const catBoolFields = category.fields.filter((f) => f.type === 'boolean');
      const catOtherFields = category.fields.filter((f) => f.type !== 'boolean');
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
              <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
            </div>
            <button
              onClick={addNode}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> {t('config.addNode')}
            </button>
          </div>

          {/* Category-level settings (Docker Host Mode, nodeEqualityStrategy) */}
          {category.fields.length > 0 && (
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-3">
              {catOtherFields.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {catOtherFields.map((f) => (
                    <FieldRenderer key={f.key} field={f} value={config[f.key]} onChange={handleFieldChange} preset={config.preset} />
                  ))}
                </div>
              )}
              {catBoolFields.length > 0 && catBoolFields.map((f) => (
                <React.Fragment key={f.key}>
                  <FieldRenderer field={f} value={config[f.key]} onChange={handleFieldChange} preset={config.preset} />
                  {f.key === 'dockerHostMode' && isDockerDesktop && !!config[f.key] && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-900/40 border border-red-700/60 rounded-lg text-red-300 text-xs">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{t('config.dockerDesktopWarning')}</span>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {config.nodes.map((node, i) => (
              <div key={i}>
                {(!node.host || node.host.trim() === '' || node.host === '0.0.0.0') && (
                  <div className="mb-1 flex items-center gap-2 px-3 py-1.5 bg-amber-900/40 border border-amber-700/60 rounded-lg text-amber-300 text-xs">
                    <span>⚠️</span>
                    <span>{t('config.nodeHostRequired')}</span>
                  </div>
                )}
                <ArrayItemEditor<NodeConfig>
                  item={node}
                  index={i}
                  fields={NODE_FIELDS}
                  onChange={handleNodeChange}
                  onRemove={removeNode}
                />
              </div>
            ))}
            {config.nodes.length === 0 && (
              <p className="text-zinc-600 text-sm italic text-center py-8">{t('config.noNodes')}</p>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'gateways') {
      const gwInputBase =
        'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors';
      const nodeNames = config.nodes.map((n) => n.name).filter(Boolean);
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
              <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
            </div>
            <button
              onClick={addGateway}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> {t('config.addGateway')}
            </button>
          </div>
          <div className="space-y-3">
            {config.gateways.map((gw, i) => (
              <div key={i} className="border border-zinc-700 rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/60">
                  <span className="text-sm font-medium text-zinc-200">
                    {gw.apiNodeName || `gateway-${i}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGateway(i)}
                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 space-y-3 bg-zinc-900/50">
                  {/* API Node Name — select from existing nodes (read-only source) */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      {t('config.gatewayApiNodeName')}
                    </label>
                    <select
                      value={gw.apiNodeName}
                      onChange={(e) => handleGatewayChange(i, 'apiNodeName', e.target.value)}
                      className={gwInputBase}
                    >
                      {nodeNames.length === 0 && (
                        <option value="">{t('config.gatewayNoNodes')}</option>
                      )}
                      {nodeNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      {/* Keep current value even if node was removed */}
                      {gw.apiNodeName && !nodeNames.includes(gw.apiNodeName) && (
                        <option value={gw.apiNodeName}>⚠️ {gw.apiNodeName} ({t('config.gatewayNodeMissing')})</option>
                      )}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500">{t('config.gatewayApiNodeNameHint')}</p>
                  </div>
                  {/* Remaining gateway fields */}
                  {GATEWAY_FIELDS.filter((f) => f.key !== 'apiNodeName').map((f) => (
                    <FieldRenderer
                      key={f.key}
                      field={f}
                      value={gw[f.key]}
                      onChange={(_key, val) => handleGatewayChange(i, f.key, val)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {config.gateways.length === 0 && (
              <p className="text-zinc-600 text-sm italic text-center py-8">{t('config.noGateways')}</p>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'inflation') {
      const isPublic = config.preset === 'testnet' || config.preset === 'mainnet';
      const inputBase =
        'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors';

      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
              <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
            </div>
            {!isPublic && (
              <button
                onClick={addInflation}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> {t('config.addEntry')}
              </button>
            )}
          </div>

          {isPublic ? (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-5 text-sm text-blue-300 space-y-2">
              <p className="font-medium">{t('config.publicNetworkNotice')}</p>
              <p className="text-blue-400/80">
                {t('config.publicNetworkInflation')}
              </p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1.5fr_auto] gap-3 px-1">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('config.startingHeight')}</span>
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('config.amount')}</span>
                <span className="w-9" />
              </div>

              {/* Entries */}
              <div className="space-y-2">
                {config.inflation.map((entry, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.5fr_auto] gap-3 items-center">
                    <input
                      type="number"
                      value={entry.startHeight}
                      min={2}
                      onChange={(e) => handleInflationChange(i, 'startHeight', e.target.value)}
                      className={inputBase}
                      placeholder="2"
                    />
                    <input
                      type="text"
                      value={entry.amount}
                      onChange={(e) => handleInflationChange(i, 'amount', e.target.value)}
                      className={inputBase}
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => removeInflation(i)}
                      className="p-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
                      title={t('config.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {config.inflation.length === 0 && (
                <p className="text-zinc-600 text-sm italic text-center py-8">
                  {t('config.noInflation')}
                </p>
              )}

              {/* Help text */}
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 space-y-2 text-xs text-zinc-500">
                <p>
                  <span className="text-zinc-400 font-medium">{t('config.inflationHelp')}</span>{' '}
                  {t('config.inflationDesc')}
                </p>
                <p>
                  <span className="text-zinc-400">{t('config.inflationExample')}</span> {t('config.inflationExLine1')}
                </p>
                <p>
                  <span className="text-zinc-400">{t('config.inflationZero')}</span> {t('config.inflationZeroDesc')}
                </p>
              </div>
            </>
          )}
        </div>
      );
    }

    // Generic category (general, images, network, explorer)
    // Split boolean fields from the rest for cleaner layout
    const boolFields = category.fields.filter((f) => f.type === 'boolean');
    const otherFields = category.fields.filter((f) => f.type !== 'boolean');

    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-semibold text-indigo-300">{t(`cat.${category.id}.label`, category.label)}</h3>
          <p className="text-xs text-zinc-500 mt-1">{t(`cat.${category.id}.desc`, category.description)}</p>
        </div>
        {category.requiresFullReset && (
          <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">{t('config.fullResetRequired')}</span>
              <span className="text-amber-400/70 ml-1">{t('config.fullResetDesc')}</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {otherFields.map((f) => (
            <FieldRenderer key={f.key} field={f} value={config[f.key]} onChange={handleFieldChange} preset={config.preset} />
          ))}
        </div>
        {boolFields.length > 0 && (
          <div className="border-t border-zinc-800 pt-4 space-y-3">
            {boolFields.map((f) => (
              <FieldRenderer key={f.key} field={f} value={config[f.key]} onChange={handleFieldChange} preset={config.preset} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-6">
        {/* ── Sidebar Tabs ── */}
        <div className="w-full md:w-56 shrink-0">

          {/* 🟢 Group: 再起動のみで反映 */}
          <div className="mb-2">
            <div className="px-3 py-1.5 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400/80 shrink-0" />
              <span className="text-[10px] font-semibold tracking-widest text-emerald-500 uppercase">
                {t('config.sidebarGroupRestart')}
              </span>
            </div>
            <div className="space-y-1">
              {CATEGORIES.filter((c) => !c.requiresFullReset).map((cat) => {
                const Icon = ICON_MAP[cat.id] ?? Settings;
                const isActive = activeTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveTab(cat.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 text-sm ${
                      isActive
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                    <span className="truncate">{t(`cat.${cat.id}.label`, cat.label)}</span>
                    {cat.id === 'nodes' && (
                      <span className="ml-auto text-xs bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{config.nodes.length}</span>
                    )}
                    {cat.id === 'gateways' && (
                      <span className="ml-auto text-xs bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{config.gateways.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-zinc-700/60" />

          {/* 🔴 Group: Full Reset 必要 */}
          <div className="mb-2">
            <div className="px-3 py-1.5 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/80 shrink-0" />
              <span className="text-[10px] font-semibold tracking-widest text-amber-500 uppercase">
                {t('config.sidebarGroupFullReset')}
              </span>
            </div>
            <div className="space-y-1">
              {CATEGORIES.filter((c) => c.requiresFullReset).map((cat) => {
                const Icon = ICON_MAP[cat.id] ?? Settings;
                const isActive = activeTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveTab(cat.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 text-sm ${
                      isActive
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                    <span className="truncate">{t(`cat.${cat.id}.label`, cat.label)}</span>
                    {cat.id === 'nemesisMosaics' && config.preset === 'bootstrap' && (
                      <span className="ml-auto text-xs bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{config.nemesisMosaics.length}</span>
                    )}
                    {cat.id === 'inflation' && (
                      <span className="ml-auto text-xs bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{config.inflation.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* YAML Preview toggle */}
          <div className="pt-2 border-t border-zinc-800 mt-1">
            <button
              onClick={() => setShowYaml(!showYaml)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
                showYaml
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Code2 className={`w-5 h-5 ${showYaml ? 'text-emerald-400' : 'text-zinc-500'}`} />
              {t('config.yamlPreview')}
            </button>
          </div>
        </div>

        {/* ── Main Content Area ── */}
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 md:p-8 min-h-[400px] max-h-[75vh] overflow-y-auto">
          {renderContent()}
        </div>
      </div>

      {/* ── YAML Preview Panel ── */}
      {showYaml && (
        <div className="bg-black/80 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
            <span className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-emerald-400" />
              custom-preset.yml
            </span>
            <button
              onClick={() => {
                const yaml = configToYaml(config);
                navigator.clipboard.writeText(yaml);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {t('config.copy')}
            </button>
          </div>
          <pre className="p-4 text-xs text-emerald-400 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
            {configToYaml(config)}
          </pre>
        </div>
      )}
    </div>
  );
}
