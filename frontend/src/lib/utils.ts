import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { PresetConfig } from '../constants';
import {
  DEFAULT_PRESET,
  CATAPULT_VERSIONS,
  OFFICIAL_MAINNET_GENERATION_HASH,
  OFFICIAL_TESTNET_GENERATION_HASH,
} from '../constants';

// ─── Tailwind merge helper ──────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── YAML serialization (simple, no external dependency) ────────────────────
// A lightweight YAML serializer that covers the data shapes we use
// (primitives, flat objects, arrays of objects). For importing, we also
// provide a basic parser. For anything more complex the backend handles it.

function indent(level: number): string {
  return '  '.repeat(level);
}

function yamlValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Quote strings that could be misinterpreted
    if (
      v === '' ||
      v === 'true' ||
      v === 'false' ||
      v === 'null' ||
      /^\d/.test(v) ||
      /[:#\[\]{}&*!|>'"`,@]/.test(v)
    ) {
      return `'${v.replace(/'/g, "''")}'`;
    }
    return v;
  }
  return String(v);
}

function objectToYaml(obj: Record<string, unknown>, level: number): string {
  let out = '';
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;

    if (Array.isArray(val)) {
      out += `${indent(level)}${key}:\n`;
      for (const item of val) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item as Record<string, unknown>);
          entries.forEach(([k, v], idx) => {
            const prefix = idx === 0 ? `${indent(level + 1)}- ` : `${indent(level + 2)}`;
            out += `${prefix}${k}: ${yamlValue(v)}\n`;
          });
        } else {
          out += `${indent(level + 1)}- ${yamlValue(item)}\n`;
        }
      }
    } else if (typeof val === 'object') {
      out += `${indent(level)}${key}:\n`;
      out += objectToYaml(val as Record<string, unknown>, level + 1);
    } else {
      out += `${indent(level)}${key}: ${yamlValue(val)}\n`;
    }
  }
  return out;
}

/**
 * Convert a PresetConfig to symbol-bootstrap compatible YAML.
 * Groups properties into the expected nested structure.
 */
export function configToYaml(config: PresetConfig): string {
  // Build the YAML-friendly object in symbol-bootstrap's expected structure
  // NOTE: preset and assembly are used as CLI args (-p / -a) by the backend.
  // We still include them in the YAML for reference and re-import.
  const doc: Record<string, unknown> = {};

  // Top-level identity (used by backend to construct CLI args)
  doc.preset = config.preset;
  doc.assembly = config.assembly;
  doc.privateKeySecurityMode = config.privateKeySecurityMode;

  // Certificate expiration
  doc.caCertificateExpirationInDays = config.caCertificateExpirationInDays;
  doc.nodeCertificateExpirationInDays = config.nodeCertificateExpirationInDays;
  doc.certificateExpirationWarningInDays = config.certificateExpirationWarningInDays;

  // Docker images
  doc.symbolServerImage = config.symbolServerImage;
  doc.symbolRestImage = config.symbolRestImage;
  doc.symbolServerToolsImage = config.symbolServerToolsImage;
  if (config.explorerEnabled) doc.symbolExplorerImage = config.symbolExplorerImage;
  if (config.faucetEnabled) doc.symbolFaucetImage = config.symbolFaucetImage;
  doc.symbolAgentImage = config.symbolAgentImage;

  // Nodes
  doc.nodes = config.nodes;

  // Gateways
  doc.gateways = config.gateways;

  // Network properties (chain-level)
  const networkProps: Record<string, unknown> = {
    identifier: config.networkType,
    networkIdentifier: config.networkIdentifier,
    networkName: config.networkName,
    friendlyName: config.friendlyName,
    nemesisGenerationHashSeed: config.nemesisGenerationHashSeed || undefined,
    nemesisSignerPublicKey: config.nemesisSignerPublicKey || undefined,
    nodeEqualityStrategy: config.nodeEqualityStrategy || undefined,
    epochAdjustment: config.epochAdjustment,
  };

  // Chain sub-section
  const chain: Record<string, unknown> = {
    enableVerifiableState: config.enableVerifiableState,
    enableVerifiableReceipts: config.enableVerifiableReceipts,
    currencyMosaicId: config.currencyMosaicId,
    harvestingMosaicId: config.harvestingMosaicId,
    blockGenerationTargetTime: config.blockGenerationTargetTime,
    blockTimeSmoothingFactor: config.blockTimeSmoothingFactor,
    maxBlockFutureTime: config.maxBlockFutureTime,
    importanceGrouping: config.importanceGrouping,
    importanceActivityPercentage: config.importanceActivityPercentage,
    maxRollbackBlocks: config.maxRollbackBlocks,
    maxDifficultyBlocks: config.maxDifficultyBlocks,
    defaultDynamicFeeMultiplier: config.defaultDynamicFeeMultiplier,
    maxTransactionLifetime: config.maxTransactionLifetime,
    maxTransactionsPerBlock: config.maxTransactionsPerBlock,
    maxBlockCacheSize: config.maxBlockCacheSize,
    maxMosaicAtomicUnits: config.maxMosaicAtomicUnits,
    totalChainImportance: config.totalChainImportance,
    minHarvesterBalance: config.minHarvesterBalance,
    maxHarvesterBalance: config.maxHarvesterBalance,
    minVoterBalance: config.minVoterBalance,
    votingSetGrouping: config.votingSetGrouping,
    maxVotingKeysPerAccount: config.maxVotingKeysPerAccount,
    minVotingKeyLifetime: config.minVotingKeyLifetime,
    maxVotingKeyLifetime: config.maxVotingKeyLifetime,
    harvestBeneficiaryPercentage: config.harvestBeneficiaryPercentage,
    harvestNetworkPercentage: config.harvestNetworkPercentage,
    harvestNetworkFeeSinkAddress: config.harvestNetworkFeeSinkAddress || undefined,
    harvestNetworkFeeSinkAddressV1: config.harvestNetworkFeeSinkAddressV1 || undefined,
    initialCurrencyAtomicUnits: config.initialCurrencyAtomicUnits,
  };
  networkProps.chain = chain;

  // Plugin sub-section — organized by plugin type
  const plugin: Record<string, unknown> = {
    // Aggregate
    maxTransactionsPerAggregate: config.maxTransactionsPerAggregate,
    maxCosignaturesPerAggregate: config.maxCosignaturesPerAggregate,
    enableStrictCosignatureCheck: config.enableStrictCosignatureCheck,
    enableBondedAggregateSupport: config.enableBondedAggregateSupport,
    maxBondedTransactionLifetime: config.maxBondedTransactionLifetime,
    // Hash Lock
    lockedFundsPerAggregate: config.lockedFundsPerAggregate,
    maxHashLockDuration: config.maxHashLockDuration,
    // Secret Lock
    maxSecretLockDuration: config.maxSecretLockDuration,
    minProofSize: config.minProofSize,
    maxProofSize: config.maxProofSize,
    // Metadata
    maxValueSize: config.maxValueSize,
    // Mosaic
    maxMosaicsPerAccount: config.maxMosaicsPerAccount,
    maxMosaicDuration: config.maxMosaicDuration,
    maxMosaicDivisibility: config.maxMosaicDivisibility,
    mosaicRentalFeeSinkAddress: config.mosaicRentalFeeSinkAddress || undefined,
    mosaicRentalFeeSinkAddressV1: config.mosaicRentalFeeSinkAddressV1 || undefined,
    mosaicRentalFee: config.mosaicRentalFee,
    // Namespace
    maxNamespacesPerAccount: config.maxNamespacesPerAccount,
    maxNameSize: config.maxNameSize,
    maxNamespaceDepth: config.maxNamespaceDepth,
    maxChildNamespaces: config.maxChildNamespaces,
    minNamespaceDuration: config.minNamespaceDuration,
    maxNamespaceDuration: config.maxNamespaceDuration,
    namespaceGracePeriodDuration: config.namespaceGracePeriodDuration,
    reservedRootNamespaceNames: config.reservedRootNamespaceNames,
    namespaceRentalFeeSinkAddress: config.namespaceRentalFeeSinkAddress || undefined,
    namespaceRentalFeeSinkAddressV1: config.namespaceRentalFeeSinkAddressV1 || undefined,
    rootNamespaceRentalFeePerBlock: config.rootNamespaceRentalFeePerBlock,
    childNamespaceRentalFee: config.childNamespaceRentalFee,
    // Multisig
    maxMultisigDepth: config.maxMultisigDepth,
    maxCosignatoriesPerAccount: config.maxCosignatoriesPerAccount,
    maxCosignedAccountsPerAccount: config.maxCosignedAccountsPerAccount,
    // Restriction
    maxAccountRestrictionValues: config.maxAccountRestrictionValues,
    maxMosaicRestrictionValues: config.maxMosaicRestrictionValues,
    // Transfer
    maxMessageSize: config.maxMessageSize,
  };
  networkProps.plugin = plugin;

  doc.networkProperties = networkProps;

  // Nemesis mosaics (bootstrap only)
  if (config.baseNamespace) {
    doc.baseNamespace = config.baseNamespace;
  }
  if (config.nemesisMosaics && config.nemesisMosaics.length > 0) {
    // Ensure supply values are plain numbers (strip apostrophe formatting)
    const sanitizedMosaics = config.nemesisMosaics.map((m: any) => {
      const copy = { ...m };
      if (typeof copy.supply === 'string') {
        const stripped = copy.supply.replace(/'/g, '');
        if (/^\d+$/.test(stripped)) {
          copy.supply = parseInt(stripped, 10);
        }
      }
      return copy;
    });
    doc.nemesis = { mosaics: sanitizedMosaics };
  }

  // Explorer / Faucet
  if (config.explorerEnabled) {
    doc.explorer = { port: config.explorerPort };
  }
  if (config.faucetEnabled) {
    doc.faucet = { port: config.faucetPort, amount: config.faucetAmount };
  }

  // Inflation schedule (for custom/private networks)
  if (config.inflation && config.inflation.length > 0) {
    const inflObj: Record<string, unknown> = {};
    for (const entry of config.inflation) {
      inflObj[`starting-at-height-${entry.startHeight}`] = entry.amount;
    }
    doc.inflation = inflObj;
  }

  // ── Top-level field overrides ──
  // symbol-bootstrap's mustache templates read fields from the top level of the
  // merged preset. Setting them only under networkProperties.chain does NOT
  // override the base preset values. Duplicate critical fields at the root.
  const topLevelKeys: (keyof typeof config)[] = [
    'enableVerifiableState', 'enableVerifiableReceipts',
    'blockGenerationTargetTime', 'blockTimeSmoothingFactor',
    'maxBlockFutureTime',
    'importanceGrouping', 'importanceActivityPercentage',
    'maxRollbackBlocks', 'maxDifficultyBlocks',
    'defaultDynamicFeeMultiplier', 'maxTransactionLifetime',
    'maxTransactionsPerBlock', 'maxBlockCacheSize',
    'maxMosaicAtomicUnits', 'totalChainImportance',
    'initialCurrencyAtomicUnits',
    'minHarvesterBalance', 'maxHarvesterBalance',
    'minVoterBalance', 'votingSetGrouping',
    'maxVotingKeysPerAccount', 'minVotingKeyLifetime', 'maxVotingKeyLifetime',
    'harvestBeneficiaryPercentage', 'harvestNetworkPercentage',
    'maxTransactionsPerAggregate', 'maxCosignaturesPerAggregate',
    'enableStrictCosignatureCheck', 'enableBondedAggregateSupport',
    'maxBondedTransactionLifetime',
    'lockedFundsPerAggregate', 'maxHashLockDuration',
    'maxSecretLockDuration', 'minProofSize', 'maxProofSize',
    'maxValueSize',
    'maxMosaicsPerAccount', 'maxMosaicDuration', 'maxMosaicDivisibility',
    'mosaicRentalFee',
    'maxNamespacesPerAccount', 'maxNameSize', 'maxNamespaceDepth',
    'maxChildNamespaces', 'minNamespaceDuration', 'maxNamespaceDuration',
    'namespaceGracePeriodDuration', 'reservedRootNamespaceNames',
    'rootNamespaceRentalFeePerBlock', 'childNamespaceRentalFee',
    'maxMultisigDepth', 'maxCosignatoriesPerAccount', 'maxCosignedAccountsPerAccount',
    'maxAccountRestrictionValues', 'maxMosaicRestrictionValues',
    'maxMessageSize',
  ];
  for (const k of topLevelKeys) {
    const v = config[k];
    if (v !== undefined && v !== null && v !== '') {
      // Strip apostrophe formatting from numeric strings so symbol-bootstrap
      // can use them directly in arithmetic (Math.min etc.).
      if (typeof v === 'string' && /^\d[\d']*$/.test(v)) {
        const num = Number(v.replace(/'/g, ''));
        doc[k] = isNaN(num) ? v : num;
      } else {
        doc[k] = v;
      }
    }
  }

  return objectToYaml(doc, 0);
}

// ─── YAML → Config (basic parser / flattener) ──────────────────────────────

/**
 * Parse an imported YAML or JSON string back into our flat PresetConfig.
 * This is intentionally lenient — unknown keys are ignored, missing keys
 * get defaults.
 */
export function yamlToConfig(text: string): PresetConfig {
  // Attempt JSON parse first
  try {
    const json = JSON.parse(text);
    return mergeWithDefaults(json);
  } catch {
    // not JSON — fall through to YAML parse
  }

  // Minimal YAML parser (handles our output format)
  const parsed = simpleYamlParse(text);
  return mergeWithDefaults(flattenParsed(parsed));
}

function mergeWithDefaults(partial: Record<string, unknown>): PresetConfig {
  const merged = { ...DEFAULT_PRESET } as Record<string, unknown>;

  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined && v !== null) {
      merged[k] = v;
    }
  }

  // Ensure arrays are proper
  if (!Array.isArray(merged.nodes)) merged.nodes = DEFAULT_PRESET.nodes;
  if (!Array.isArray(merged.gateways)) merged.gateways = DEFAULT_PRESET.gateways;
  if (!Array.isArray(merged.inflation)) merged.inflation = DEFAULT_PRESET.inflation;
  if (!Array.isArray(merged.nemesisMosaics)) merged.nemesisMosaics = DEFAULT_PRESET.nemesisMosaics;

  return merged as PresetConfig;
}

/**
 * Flatten the nested symbol-bootstrap YAML structure back to our flat config.
 */
function flattenParsed(obj: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...obj };

  // Flatten networkProperties
  const np = obj.networkProperties as Record<string, unknown> | undefined;
  if (np) {
    if (np.identifier) flat.networkType = np.identifier;
    if (np.networkIdentifier) flat.networkIdentifier = np.networkIdentifier;
    if (np.networkName) flat.networkName = np.networkName;
    if (np.friendlyName) flat.friendlyName = np.friendlyName;
    if (np.nemesisGenerationHashSeed) flat.nemesisGenerationHashSeed = np.nemesisGenerationHashSeed;
    if (np.nemesisSignerPublicKey) flat.nemesisSignerPublicKey = np.nemesisSignerPublicKey;
    if (np.nodeEqualityStrategy) flat.nodeEqualityStrategy = np.nodeEqualityStrategy;
    if (np.epochAdjustment) flat.epochAdjustment = np.epochAdjustment;

    const chain = np.chain as Record<string, unknown> | undefined;
    if (chain) Object.assign(flat, chain);

    const plugin = np.plugin as Record<string, unknown> | undefined;
    if (plugin) Object.assign(flat, plugin);

    delete flat.networkProperties;
  }

  // Flatten explorer / faucet
  const exp = obj.explorer as Record<string, unknown> | undefined;
  if (exp) {
    flat.explorerEnabled = true;
    if (exp.port) flat.explorerPort = exp.port;
    delete flat.explorer;
  }
  const fau = obj.faucet as Record<string, unknown> | undefined;
  if (fau) {
    flat.faucetEnabled = true;
    if (fau.port) flat.faucetPort = fau.port;
    if (fau.amount) flat.faucetAmount = fau.amount;
    delete flat.faucet;
  }

  // Flatten inflation
  const infl = obj.inflation as Record<string, unknown> | undefined;
  if (infl && typeof infl === 'object' && !Array.isArray(infl)) {
    // Convert { 'starting-at-height-2': '95000000', ... } → InflationEntry[]
    const entries = Object.entries(infl)
      .map(([k, v]) => {
        const m = k.match(/starting-at-height-(\d+)/);
        return m ? { startHeight: Number(m[1]), amount: String(v) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a!.startHeight - b!.startHeight);
    flat.inflation = entries;
  }

  // Flatten nemesis
  const nemesis = obj.nemesis as Record<string, unknown> | undefined;
  if (nemesis?.mosaics && Array.isArray(nemesis.mosaics)) {
    flat.nemesisMosaics = nemesis.mosaics;
    delete flat.nemesis;
  }

  return flat;
}

// ─── Minimal YAML parser ────────────────────────────────────────────────────
// Handles flat key: value, simple nested objects, and arrays of objects.
// Not a full YAML spec — only covers our own output format.

function simpleYamlParse(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return parseBlock(lines, 0, 0).value as Record<string, unknown>;
}

function parseBlock(
  lines: string[],
  start: number,
  baseIndent: number
): { value: Record<string, unknown>; nextLine: number } {
  const obj: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const lineIndent = line.search(/\S/);
    if (lineIndent < baseIndent) break;

    // Array item
    if (line.trimStart().startsWith('- ')) {
      break; // arrays handled by caller
    }

    const match = line.match(/^(\s*)(\S+?):\s*(.*)/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[2];
    const inlineValue = match[3].trim();

    if (inlineValue === '') {
      // Check if next line is array or nested object
      const nextNonEmpty = findNextNonEmpty(lines, i + 1);
      if (nextNonEmpty < lines.length && lines[nextNonEmpty].trimStart().startsWith('- ')) {
        const arr = parseArray(lines, nextNonEmpty, lineIndent + 2);
        obj[key] = arr.value;
        i = arr.nextLine;
      } else {
        const nested = parseBlock(lines, i + 1, lineIndent + 2);
        obj[key] = nested.value;
        i = nested.nextLine;
      }
    } else {
      obj[key] = parseScalar(inlineValue);
      i++;
    }
  }

  return { value: obj, nextLine: i };
}

function parseArray(
  lines: string[],
  start: number,
  baseIndent: number
): { value: unknown[]; nextLine: number } {
  const arr: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const lineIndent = line.search(/\S/);
    if (lineIndent < baseIndent) break;
    if (!line.trimStart().startsWith('- ')) break;

    // Parse array item (object or scalar)
    const after = line.replace(/^\s*-\s*/, '');
    if (after.includes(':')) {
      // Object item — first key on this line
      const item: Record<string, unknown> = {};
      const m = after.match(/^(\S+?):\s*(.*)/);
      if (m) {
        item[m[1]] = parseScalar(m[2].trim());
      }
      i++;
      // Remaining keys at deeper indent
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine.trim() === '') { i++; continue; }
        const ni = nextLine.search(/\S/);
        if (ni <= baseIndent || nextLine.trimStart().startsWith('- ')) break;
        const km = nextLine.match(/^\s*(\S+?):\s*(.*)/);
        if (km) {
          item[km[1]] = parseScalar(km[2].trim());
        }
        i++;
      }
      arr.push(item);
    } else {
      arr.push(parseScalar(after));
      i++;
    }
  }

  return { value: arr, nextLine: i };
}

function findNextNonEmpty(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() !== '') return i;
  }
  return lines.length;
}

function parseScalar(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  // Quoted string
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  // Number
  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;
  return s;
}

// ─── Symbol REST → PresetConfig mapping ────────────────────────────────────
// /network/properties returns values as strings with apostrophe separators
// (e.g. "7'842'928'625'000'000") and duration units (e.g. "30s", "365d").
// This helper converts the REST response into our flat PresetConfig.

/** Remove apostrophe grouping separators from numeric strings: "7'842'928" → "7842928" */
function stripApostrophes(v: string): string {
  return v.replace(/'/g, '');
}

/** Parse a REST value — strip apostrophes, try to convert to number */
function restVal(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  const clean = stripApostrophes(s);
  // Keep duration strings (30s, 365d, 24h, 300ms) as-is
  if (/^\d+[a-z]+$/i.test(clean)) return clean;
  // Keep hex strings as-is
  if (/^0x/i.test(s)) return s;
  // Boolean
  if (clean === 'true') return true;
  if (clean === 'false') return false;
  // Number
  const n = Number(clean);
  if (!isNaN(n) && clean !== '') return n;
  return s;
}

/**
 * Map a Symbol REST API response ({networkProperties, nodeInfo, peers})
 * into a partial PresetConfig that can be merged with defaults.
 */
export function networkPropertiesToConfig(
  networkProperties: Record<string, unknown>,
  nodeInfo: Record<string, unknown>,
  peers: Record<string, unknown>[],
  minFeeMultiplier: number | null = null,
  mosaicInfo: Record<string, unknown>[] = [],
  mosaicNames: { mosaicId: string; names: string[] }[] = [],
): Partial<PresetConfig> {
  const np = networkProperties as {
    network?: Record<string, unknown>;
    chain?: Record<string, unknown>;
    plugins?: Record<string, Record<string, unknown>>;
  };

  const network = np.network ?? {};
  const chain = np.chain ?? {};
  const plugins = np.plugins ?? {};

  // Aggregate plugins into a flat map
  const pluginFlat: Record<string, unknown> = {};
  for (const section of Object.values(plugins)) {
    if (section && typeof section === 'object') {
      Object.assign(pluginFlat, section);
    }
  }

  // Determine preset name from the genesis generation hash seed.
  // networkIdentifier alone is ambiguous — a bootstrap custom network can
  // reuse 152 (testnet address prefix) without being Symbol's official testnet.
  // The generation hash seed is unique to each genesis block and is the
  // only reliable way to identify the official networks.
  const ni = Number(nodeInfo.networkIdentifier ?? network.identifier ?? 0);
  const genHash = String(
    nodeInfo.networkGenerationHashSeed ?? network.generationHashSeed ?? ''
  ).toUpperCase();
  const presetFromId =
    genHash === OFFICIAL_MAINNET_GENERATION_HASH
      ? 'mainnet'
      : genHash === OFFICIAL_TESTNET_GENERATION_HASH
        ? 'testnet'
        : 'bootstrap';

  // Detect catapult version from node server version
  // nodeInfo.version is a packed uint32: 0xMMmmPPBB → major.minor.patch.build
  // e.g. 16777993 = 0x01000309 → 1.0.3.9 (V3), 16777990 = 0x01000306 → 1.0.3.6 (V2)
  const serverVersion = Number(nodeInfo.version ?? 0);
  const patchBuild = serverVersion & 0xFFFF; // lower 16 bits = patch.build
  // For mainnet/testnet, always use V3 as the official networks have upgraded.
  // For custom networks: V3 if build >= 0x0309 (1.0.3.9+), V2 if build < 0x0309 (1.0.3.6).
  // IMPORTANT: if nodeInfo.version is 0 (not returned / REST unavailable), serverVersion=0
  // and patchBuild=0, which would incorrectly detect V2.  We default to V3 in that case
  // because 1.0.3.9 is the current standard and V2 (1.0.3.6) is only for legacy networks.
  const isV3 = (ni === 104 || ni === 152)
    ? true                         // official networks: always V3
    : serverVersion === 0
      ? true                       // version unknown → safe default = V3
      : (patchBuild >= 0x0309);    // custom network: check actual build number
  const catapultVersion = isV3 ? 'v3' : 'v2';

  // Import CATAPULT_VERSIONS to set correct Docker images
  const versionPreset = CATAPULT_VERSIONS.find(v => v.id === catapultVersion) ?? CATAPULT_VERSIONS[0];

  const partial: Record<string, unknown> = {
    preset: presetFromId,
    assembly: 'dual',
    catapultVersion,
    symbolServerImage: versionPreset.symbolServerImage,
    symbolRestImage: versionPreset.symbolRestImage,
    symbolServerToolsImage: versionPreset.symbolServerToolsImage,

    // From /network/properties → network
    networkType:
      ni === 104
        ? 'mainnet'
        : ni === 152
          ? 'testnet'
          : ni === 120
            ? 'private'
            : 'privateTest',
    networkIdentifier: ni,
    networkName: network.networkName ?? network.identifier ?? '',
    nemesisGenerationHashSeed:
      nodeInfo.networkGenerationHashSeed ??
      network.generationHashSeed ??
      '',
    nemesisSignerPublicKey: network.nemesisSignerPublicKey ?? '',
    nodeEqualityStrategy: network.nodeEqualityStrategy ?? 'host',
    epochAdjustment: network.epochAdjustment ?? '',

    // From /network/properties → chain
    enableVerifiableState: restVal(chain.enableVerifiableState),
    enableVerifiableReceipts: restVal(chain.enableVerifiableReceipts),
    currencyMosaicId: chain.currencyMosaicId,
    harvestingMosaicId: chain.harvestingMosaicId,
    blockGenerationTargetTime: chain.blockGenerationTargetTime,
    blockTimeSmoothingFactor: restVal(chain.blockTimeSmoothingFactor),
    maxBlockFutureTime: chain.maxBlockFutureTime,
    importanceGrouping: restVal(chain.importanceGrouping),
    importanceActivityPercentage: restVal(chain.importanceActivityPercentage),
    maxRollbackBlocks: restVal(chain.maxRollbackBlocks),
    maxDifficultyBlocks: restVal(chain.maxDifficultyBlocks),
    defaultDynamicFeeMultiplier: restVal(chain.defaultDynamicFeeMultiplier),
    maxTransactionLifetime: chain.maxTransactionLifetime,
    maxTransactionsPerBlock: restVal(chain.maxTransactionsPerBlock),
    maxBlockCacheSize: chain.maxBlockCacheSize
      ? stripApostrophes(String(chain.maxBlockCacheSize))
      : undefined,
    maxMosaicAtomicUnits: chain.maxMosaicAtomicUnits
      ? stripApostrophes(String(chain.maxMosaicAtomicUnits))
      : undefined,
    totalChainImportance: chain.totalChainImportance
      ? stripApostrophes(String(chain.totalChainImportance))
      : undefined,
    minHarvesterBalance: chain.minHarvesterBalance
      ? stripApostrophes(String(chain.minHarvesterBalance))
      : undefined,
    maxHarvesterBalance: chain.maxHarvesterBalance
      ? stripApostrophes(String(chain.maxHarvesterBalance))
      : undefined,
    minVoterBalance: chain.minVoterBalance
      ? stripApostrophes(String(chain.minVoterBalance))
      : undefined,
    votingSetGrouping: restVal(chain.votingSetGrouping),
    maxVotingKeysPerAccount: restVal(chain.maxVotingKeysPerAccount),
    minVotingKeyLifetime: restVal(chain.minVotingKeyLifetime),
    maxVotingKeyLifetime: restVal(chain.maxVotingKeyLifetime),
    harvestBeneficiaryPercentage: restVal(chain.harvestBeneficiaryPercentage),
    harvestNetworkPercentage: restVal(chain.harvestNetworkPercentage),
    harvestNetworkFeeSinkAddress: chain.harvestNetworkFeeSinkAddress ?? '',
    harvestNetworkFeeSinkAddressV1: chain.harvestNetworkFeeSinkAddressV1 ?? '',
    initialCurrencyAtomicUnits: chain.initialCurrencyAtomicUnits
      ? stripApostrophes(String(chain.initialCurrencyAtomicUnits))
      : undefined,

    // From plugins — Aggregate
    maxTransactionsPerAggregate: restVal(pluginFlat.maxTransactionsPerAggregate),
    maxCosignaturesPerAggregate: restVal(pluginFlat.maxCosignaturesPerAggregate),
    enableStrictCosignatureCheck: restVal(pluginFlat.enableStrictCosignatureCheck),
    enableBondedAggregateSupport: restVal(pluginFlat.enableBondedAggregateSupport),
    maxBondedTransactionLifetime: pluginFlat.maxBondedTransactionLifetime,

    // From plugins — Hash Lock
    lockedFundsPerAggregate: pluginFlat.lockedFundsPerAggregate
      ? stripApostrophes(String(pluginFlat.lockedFundsPerAggregate))
      : undefined,
    maxHashLockDuration: pluginFlat.maxHashLockDuration,

    // From plugins — Secret Lock
    maxSecretLockDuration: pluginFlat.maxSecretLockDuration,
    minProofSize: restVal(pluginFlat.minProofSize),
    maxProofSize: restVal(pluginFlat.maxProofSize),

    // From plugins — Metadata
    maxValueSize: restVal(pluginFlat.maxValueSize),

    // From plugins — Mosaic
    maxMosaicsPerAccount: restVal(pluginFlat.maxMosaicsPerAccount),
    maxMosaicDuration: pluginFlat.maxMosaicDuration,
    maxMosaicDivisibility: restVal(pluginFlat.maxMosaicDivisibility),
    mosaicRentalFeeSinkAddress: pluginFlat.mosaicRentalFeeSinkAddress ?? '',
    mosaicRentalFeeSinkAddressV1: pluginFlat.mosaicRentalFeeSinkAddressV1 ?? '',
    mosaicRentalFee: pluginFlat.mosaicRentalFee
      ? stripApostrophes(String(pluginFlat.mosaicRentalFee))
      : undefined,

    // From plugins — Namespace
    maxNamespacesPerAccount: restVal(pluginFlat.maxNamespacesPerAccount),
    maxNameSize: restVal(pluginFlat.maxNameSize),
    maxNamespaceDepth: restVal(pluginFlat.maxNamespaceDepth),
    maxChildNamespaces: restVal(pluginFlat.maxChildNamespaces),
    minNamespaceDuration: pluginFlat.minNamespaceDuration,
    maxNamespaceDuration: pluginFlat.maxNamespaceDuration,
    namespaceGracePeriodDuration: pluginFlat.namespaceGracePeriodDuration,
    reservedRootNamespaceNames: pluginFlat.reservedRootNamespaceNames ?? '',
    namespaceRentalFeeSinkAddress: pluginFlat.namespaceRentalFeeSinkAddress ?? '',
    namespaceRentalFeeSinkAddressV1: pluginFlat.namespaceRentalFeeSinkAddressV1 ?? '',
    rootNamespaceRentalFeePerBlock: pluginFlat.rootNamespaceRentalFeePerBlock
      ? stripApostrophes(String(pluginFlat.rootNamespaceRentalFeePerBlock))
      : undefined,
    childNamespaceRentalFee: pluginFlat.childNamespaceRentalFee
      ? stripApostrophes(String(pluginFlat.childNamespaceRentalFee))
      : undefined,

    // From plugins — Multisig
    maxMultisigDepth: restVal(pluginFlat.maxMultisigDepth),
    maxCosignatoriesPerAccount: restVal(pluginFlat.maxCosignatoriesPerAccount),
    maxCosignedAccountsPerAccount: restVal(pluginFlat.maxCosignedAccountsPerAccount),

    // From plugins — Restriction
    maxAccountRestrictionValues: restVal(pluginFlat.maxAccountRestrictionValues),
    maxMosaicRestrictionValues: restVal(pluginFlat.maxMosaicRestrictionValues),

    // From plugins — Transfer
    maxMessageSize: restVal(pluginFlat.maxMessageSize),
  };

  // Build nemesisMosaics from /mosaics REST data (bootstrap custom networks only).
  // For official mainnet/testnet the preset handles mosaic config internally so
  // we skip this.  For bootstrap networks the default supply values are wrong
  // (8998999998000000 / 15000000) and must be replaced with the real values.
  if (presetFromId === 'bootstrap' && mosaicInfo.length > 0) {
    // Helper: clean mosaic ID to 16-char uppercase hex
    const cleanId = (id: unknown): string =>
      String(id ?? '').replace(/0x/gi, '').replace(/'/g, '').toUpperCase();

    const rawCurrId = cleanId(chain.currencyMosaicId);
    const rawHarvId = cleanId(chain.harvestingMosaicId);

    // Build map: mosaicId → REST mosaic object.
    // Only include mosaics with startHeight === 1 (nemesis block).
    // In a live network /mosaics returns many entries; only block-1 mosaics
    // are the original nemesis mosaics (currency / harvest).
    const mosaicMap = new Map<string, Record<string, unknown>>();
    for (const item of mosaicInfo) {
      const m = (item as Record<string, unknown>).mosaic as Record<string, unknown> | undefined;
      if (!m?.id) continue;
      const sh = Number(m.startHeight ?? 0);
      if (sh !== 1) continue; // skip non-nemesis mosaics
      mosaicMap.set(String(m.id).toUpperCase(), m);
    }

    // Build map: mosaicId → first namespace alias (e.g. "cat.currency")
    // REST POST /mosaics/names returns [{mosaicId, names:["cat.currency"]}, ...]
    const nameAliasMap = new Map<string, string>();
    for (const entry of mosaicNames) {
      const id = String(entry.mosaicId ?? '').toUpperCase();
      const alias = entry.names?.[0] ?? '';
      if (id && alias) nameAliasMap.set(id, alias);
    }

    // Derive baseNamespace from the currency mosaic alias.
    // e.g. "cat.currency" → rootNs="cat", leafName="currency"
    const currAlias = nameAliasMap.get(rawCurrId) ?? nameAliasMap.get(rawHarvId) ?? '';
    if (currAlias) {
      const parts = currAlias.split('.');
      const rootNs = parts[0];
      if (rootNs) partial.baseNamespace = rootNs;
    }

    const leafName = (alias: string): string => {
      if (!alias) return '';
      const parts = alias.split('.');
      return parts[parts.length - 1];
    };

    const currMosaic = mosaicMap.get(rawCurrId);
    const harvMosaic = mosaicMap.get(rawHarvId);

    if (currMosaic || harvMosaic) {
      const builtMosaics: Record<string, unknown>[] = [];

      // Currency mosaic entry
      const cm = currMosaic ?? harvMosaic!;
      const cFlags = Number(cm.flags ?? 2);
      // Use alias leaf name if available, otherwise fall back to 'currency'
      const currName = leafName(nameAliasMap.get(rawCurrId) ?? '') || 'currency';
      builtMosaics.push({
        name: currName,
        divisibility: Number(cm.divisibility ?? 6),
        duration: Number(cm.duration ?? 0),
        supply: String(cm.supply ?? '0'),
        isTransferable: (cFlags & 0x02) !== 0,
        isSupplyMutable: (cFlags & 0x01) !== 0,
        isRestrictable: (cFlags & 0x04) !== 0,
      });

      // Harvest mosaic entry — only when it differs from currency
      if (harvMosaic && rawHarvId !== rawCurrId) {
        const hFlags = Number(harvMosaic.flags ?? 6);
        const harvName = leafName(nameAliasMap.get(rawHarvId) ?? '') || 'harvest';
        builtMosaics.push({
          name: harvName,
          divisibility: Number(harvMosaic.divisibility ?? 3),
          duration: Number(harvMosaic.duration ?? 0),
          supply: String(harvMosaic.supply ?? '0'),
          isTransferable: (hFlags & 0x02) !== 0,
          isSupplyMutable: (hFlags & 0x01) !== 0,
          isRestrictable: (hFlags & 0x04) !== 0,
        });
      }

      partial.nemesisMosaics = builtMosaics;
    }
  }

  // NOTE: Do NOT add remote peers as nodes[] entries here.
  // Each entry in nodes[] creates a LOCAL docker container — remote peers
  // should not be instantiated locally.  The backend's fetchAndWritePeerFiles()
  // will fetch peers from the source node and write them into the
  // peers-p2p.json / peers-api.json files inside api-node-0's config.
  // By omitting partial.nodes, DEFAULT_PRESET.nodes (which contains
  // api-node-0 with api/database/harvesting enabled) is preserved during
  // the merge in handleApply().

  // Apply minFeeMultiplier to local node defaults if fetched from /network/fees/transaction
  // This is a per-node setting, so we store it in nodes[0] via DEFAULT_NODE merge in App.tsx.
  // We surface it as a top-level key here so it flows into the config correctly.
  if (minFeeMultiplier !== null) {
    (partial as Record<string, unknown>)._joinMinFeeMultiplier = minFeeMultiplier;
  }

  // Strip undefined values
  for (const k of Object.keys(partial)) {
    if (partial[k] === undefined) delete partial[k];
  }

  return partial as Partial<PresetConfig>;
}
