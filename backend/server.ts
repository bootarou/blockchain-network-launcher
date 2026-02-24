import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Setup
// =============================================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const SHARED_DIR = path.resolve(__dirname, '../shared');
const PRESET_PATH = path.join(SHARED_DIR, 'custom-preset.yml');
const UI_META_PATH = path.join(SHARED_DIR, '.ui-meta.json');  // UI-only metadata (preset, assembly)

// Docker-in-Docker fix: symbol-bootstrap internally runs
//   docker run -v <resolved_target_path>/…:/data …
// The Docker daemon (on the host / Docker Desktop VM) must be able to find
// that path.  By mounting /opt/symbol-target at the SAME path in both the
// container AND the VM we guarantee the bind-mount paths match.
const TARGET_DIR = process.env.TARGET_DIR || '/opt/symbol-target';
const SEED_DIR = path.join(SHARED_DIR, 'seed');  // imported seed files from network admin

// Ensure shared directory exists
if (!fs.existsSync(SHARED_DIR)) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
}

// =============================================================================
// Network status tracking
// =============================================================================

interface NetworkStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  lastCommand: string;
  lastCommandTime: string;
  pid: number | null;
}

let networkStatus: NetworkStatus = {
  state: 'stopped',
  lastCommand: '',
  lastCommandTime: '',
  pid: null,
};

let activeProcess: ChildProcess | null = null;

// =============================================================================
// Node health polling (GET /node/health on the local Symbol REST gateway)
// =============================================================================

interface NodeHealth {
  status: 'unknown' | 'up' | 'down';
  statusCode: number | null;
  apiNode: string;   // from response
  db: string;        // from response
  lastCheck: string; // ISO timestamp
}

let nodeHealth: NodeHealth = {
  status: 'unknown',
  statusCode: null,
  apiNode: '',
  db: '',
  lastCheck: '',
};

// The Symbol REST gateway runs inside Docker at port 3000 by default
const NODE_REST_PORT = process.env.NODE_REST_PORT || '3000';
let NODE_REST_HOST = process.env.NODE_REST_HOST || 'localhost';

async function pollNodeHealth() {
  const url = `http://${NODE_REST_HOST}:${NODE_REST_PORT}/node/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const prev = nodeHealth.status;
    nodeHealth.statusCode = res.status;
    nodeHealth.lastCheck = new Date().toISOString();

    if (res.ok) {
      const body = await res.json() as { status?: { apiNode?: string; db?: string } };
      nodeHealth.apiNode = body.status?.apiNode ?? '';
      nodeHealth.db = body.status?.db ?? '';
      nodeHealth.status = (nodeHealth.apiNode === 'up' && nodeHealth.db === 'up') ? 'up' : 'down';
    } else {
      nodeHealth.status = 'down';
      nodeHealth.apiNode = '';
      nodeHealth.db = '';
    }

    // Only broadcast when status changes or first check
    if (prev !== nodeHealth.status) {
      broadcast('NODE_HEALTH', nodeHealth);
    }
  } catch {
    const prev = nodeHealth.status;
    nodeHealth.status = 'down';
    nodeHealth.statusCode = null;
    nodeHealth.apiNode = '';
    nodeHealth.db = '';
    nodeHealth.lastCheck = new Date().toISOString();
    if (prev !== 'down') {
      broadcast('NODE_HEALTH', nodeHealth);
    }
  }
}

// ---------------------------------------------------------------------------
// waitForNodeHealth – poll /node/health until apiNode=up & db=up or timeout
// ---------------------------------------------------------------------------
async function waitForNodeHealth(timeoutSec: number): Promise<void> {
  const url = `http://${NODE_REST_HOST}:${NODE_REST_PORT}/node/health`;
  const start = Date.now();
  const deadline = start + timeoutSec * 1000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        const body = await res.json() as { status?: { apiNode?: string; db?: string } };
        const apiNode = body.status?.apiNode ?? 'unknown';
        const db = body.status?.db ?? 'unknown';
        broadcastLog(`[HealthCheck] #${attempt}  apiNode=${apiNode}  db=${db}\n`);

        // Update shared state
        nodeHealth.status = (apiNode === 'up' && db === 'up') ? 'up' : 'down';
        nodeHealth.apiNode = apiNode;
        nodeHealth.db = db;
        nodeHealth.statusCode = res.status;
        nodeHealth.lastCheck = new Date().toISOString();
        broadcast('NODE_HEALTH', nodeHealth);

        if (apiNode === 'up' && db === 'up') {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          broadcastLog(`[HealthCheck] ✅ Node is UP (${elapsed}s elapsed)\n`);
          return;
        }
      } else {
        broadcastLog(`[HealthCheck] #${attempt}  HTTP ${res.status}\n`);
      }
    } catch {
      broadcastLog(`[HealthCheck] #${attempt}  not reachable yet...\n`);
    }

    // Wait 5 seconds before next attempt
    await new Promise((r) => setTimeout(r, 5000));
  }

  broadcastLog(`[HealthCheck] ⚠️  Timed out after ${timeoutSec}s – node may still be starting.\n`);
  broadcastLog(`[HealthCheck] Check manually: http://localhost:${NODE_REST_PORT}/node/health\n`);
}

// Poll every 10 seconds
setInterval(pollNodeHealth, 10_000);
// Initial check after 3 seconds (give the server time to start)
setTimeout(pollNodeHealth, 3000);

// =============================================================================
// WebSocket — real-time log broadcast
// =============================================================================

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: 'LOG',
      data: `[System] Connected to Symbol Network Manager (${new Date().toISOString()})`,
    })
  );
  // Send current status immediately
  ws.send(JSON.stringify({ type: 'STATUS', data: networkStatus }));
  ws.send(JSON.stringify({ type: 'NODE_HEALTH', data: nodeHealth }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastLog(message: string) {
  process.stdout.write(message);
  broadcast('LOG', message);
}

function broadcastStatus() {
  broadcast('STATUS', networkStatus);
}

// =============================================================================
// Preset endpoints
// =============================================================================

/**
 * Convert our flat PresetConfig JSON to the nested structure that
 * symbol-bootstrap expects in a custom preset YAML file.
 *
 * symbol-bootstrap start -p <base> -a <assembly> -c custom-preset.yml
 *   ↑ base preset & assembly are CLI args, NOT in the file.
 *   The file only contains override properties.
 */
function flatConfigToBootstrapPreset(flat: Record<string, unknown>): Record<string, unknown> {
  const doc: Record<string, unknown> = {};

  // preset and assembly are saved separately in .ui-meta.json
  // and passed as CLI args (-p / -a), NOT included in the YAML.

  doc.privateKeySecurityMode = flat.privateKeySecurityMode;

  // ── Docker images ──
  if (flat.symbolServerImage) doc.symbolServerImage = flat.symbolServerImage;
  if (flat.symbolRestImage) doc.symbolRestImage = flat.symbolRestImage;
  if (flat.symbolServerToolsImage) doc.symbolServerToolsImage = flat.symbolServerToolsImage;
  if (flat.symbolExplorerImage) doc.symbolExplorerImage = flat.symbolExplorerImage;
  if (flat.symbolFaucetImage) doc.symbolFaucetImage = flat.symbolFaucetImage;
  if (flat.symbolAgentImage) doc.symbolAgentImage = flat.symbolAgentImage;

  // ── Nodes / Gateways ──
  if (flat.nodes) doc.nodes = flat.nodes;
  if (flat.gateways) {
    // Strip databaseHost — symbol-bootstrap resolves the correct DB service
    // name internally; overriding it in the custom preset causes a mismatch
    // between the generated service name and the depends_on reference.
    const cleanGateways = (flat.gateways as Record<string, unknown>[]).map((gw) => {
      const { databaseHost, ...rest } = gw;
      return rest;
    });
    doc.gateways = cleanGateways;
  }

  // ── networkProperties (nested structure) ──
  const networkProps: Record<string, unknown> = {};

  // Top-level network identity
  if (flat.nemesisGenerationHashSeed) networkProps.nemesisGenerationHashSeed = flat.nemesisGenerationHashSeed;
  if (flat.nemesisSignerPublicKey) networkProps.nemesisSignerPublicKey = flat.nemesisSignerPublicKey;
  if (flat.nodeEqualityStrategy) networkProps.nodeEqualityStrategy = flat.nodeEqualityStrategy;
  if (flat.epochAdjustment) networkProps.epochAdjustment = flat.epochAdjustment;

  // Chain sub-section
  const chain: Record<string, unknown> = {};
  const chainKeys = [
    'enableVerifiableState', 'enableVerifiableReceipts',
    'currencyMosaicId', 'harvestingMosaicId',
    'blockGenerationTargetTime', 'blockTimeSmoothingFactor',
    'maxBlockFutureTime',
    'importanceGrouping', 'importanceActivityPercentage',
    'maxRollbackBlocks', 'maxDifficultyBlocks',
    'defaultDynamicFeeMultiplier', 'maxTransactionLifetime',
    'maxTransactionsPerBlock', 'maxBlockCacheSize',
    'maxMosaicAtomicUnits', 'totalChainImportance',
    'minHarvesterBalance', 'maxHarvesterBalance',
    'minVoterBalance', 'votingSetGrouping', 'maxVotingKeysPerAccount',
    'minVotingKeyLifetime', 'maxVotingKeyLifetime',
    'harvestBeneficiaryPercentage', 'harvestNetworkPercentage',
    'harvestNetworkFeeSinkAddress', 'harvestNetworkFeeSinkAddressV1',
    'initialCurrencyAtomicUnits',
  ];
  for (const k of chainKeys) {
    if (flat[k] !== undefined && flat[k] !== null && flat[k] !== '') {
      chain[k] = flat[k];
    }
  }
  if (Object.keys(chain).length > 0) networkProps.chain = chain;

  // Plugin sub-section
  const plugin: Record<string, unknown> = {};
  const pluginKeys = [
    // Aggregate
    'maxTransactionsPerAggregate', 'maxCosignaturesPerAggregate',
    'enableStrictCosignatureCheck', 'enableBondedAggregateSupport',
    'maxBondedTransactionLifetime',
    // Hash Lock
    'lockedFundsPerAggregate', 'maxHashLockDuration',
    // Secret Lock
    'maxSecretLockDuration', 'minProofSize', 'maxProofSize',
    // Metadata
    'maxValueSize',
    // Mosaic
    'maxMosaicsPerAccount', 'maxMosaicDuration', 'maxMosaicDivisibility',
    'mosaicRentalFeeSinkAddress', 'mosaicRentalFeeSinkAddressV1', 'mosaicRentalFee',
    // Namespace
    'maxNamespacesPerAccount', 'maxNameSize', 'maxNamespaceDepth',
    'maxChildNamespaces', 'minNamespaceDuration', 'maxNamespaceDuration',
    'namespaceGracePeriodDuration', 'reservedRootNamespaceNames',
    'namespaceRentalFeeSinkAddress', 'namespaceRentalFeeSinkAddressV1',
    'rootNamespaceRentalFeePerBlock', 'childNamespaceRentalFee',
    // Multisig
    'maxMultisigDepth', 'maxCosignatoriesPerAccount', 'maxCosignedAccountsPerAccount',
    // Restriction
    'maxAccountRestrictionValues', 'maxMosaicRestrictionValues',
    // Transfer
    'maxMessageSize',
  ];
  for (const k of pluginKeys) {
    if (flat[k] !== undefined && flat[k] !== null && flat[k] !== '') {
      plugin[k] = flat[k];
    }
  }
  if (Object.keys(plugin).length > 0) networkProps.plugin = plugin;

  if (Object.keys(networkProps).length > 0) doc.networkProperties = networkProps;

  // ── Explorer / Faucet ──
  if (flat.explorerEnabled) {
    doc.explorer = { port: flat.explorerPort ?? 8090 };
  }
  if (flat.faucetEnabled) {
    doc.faucet = { port: flat.faucetPort ?? 4000, amount: flat.faucetAmount ?? 500000000 };
  }

  return doc;
}

/**
 * Reverse: bootstrap preset YAML → our flat config (for re-import)
 */
function bootstrapPresetToFlat(doc: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  // preset/assembly come from .ui-meta.json, not from the YAML
  // Legacy support: if _preset/_assembly exist in old files, extract them
  if (doc._preset) { flat.preset = doc._preset; delete doc._preset; }
  if (doc._assembly) { flat.assembly = doc._assembly; delete doc._assembly; }

  // Top-level simple keys
  const topKeys = [
    'privateKeySecurityMode',
    'symbolServerImage', 'symbolRestImage', 'symbolServerToolsImage',
    'symbolExplorerImage', 'symbolFaucetImage', 'symbolAgentImage',
    'nodes', 'gateways',
  ];
  for (const k of topKeys) {
    if (doc[k] !== undefined) flat[k] = doc[k];
  }

  // Flatten networkProperties
  const np = doc.networkProperties as Record<string, unknown> | undefined;
  if (np) {
    if (np.nemesisGenerationHashSeed) flat.nemesisGenerationHashSeed = np.nemesisGenerationHashSeed;
    if (np.epochAdjustment) flat.epochAdjustment = np.epochAdjustment;

    const chain = np.chain as Record<string, unknown> | undefined;
    if (chain) Object.assign(flat, chain);

    const plugin = np.plugin as Record<string, unknown> | undefined;
    if (plugin) Object.assign(flat, plugin);
  }

  // Flatten explorer / faucet
  const exp = doc.explorer as Record<string, unknown> | undefined;
  if (exp) {
    flat.explorerEnabled = true;
    if (exp.port) flat.explorerPort = exp.port;
  }
  const fau = doc.faucet as Record<string, unknown> | undefined;
  if (fau) {
    flat.faucetEnabled = true;
    if (fau.port) flat.faucetPort = fau.port;
    if (fau.amount) flat.faucetAmount = fau.amount;
  }

  return flat;
}

// Save preset (accepts flat JSON body, writes nested YAML for symbol-bootstrap)
app.post('/api/preset', (req, res) => {
  try {
    const configData = req.body;
    if (!configData || typeof configData !== 'object') {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
    // Save UI metadata (preset, assembly, catapultVersion) separately
    const uiMeta: Record<string, unknown> = {
      preset: configData.preset ?? 'bootstrap',
      assembly: configData.assembly ?? 'dual',
      catapultVersion: configData.catapultVersion ?? 'v3',
      networkType: configData.networkType ?? 'privateTest',
      networkIdentifier: configData.networkIdentifier ?? 168,
      networkName: configData.networkName ?? '',
      friendlyName: configData.friendlyName ?? '',
    };
    // Persist source node URL for peer discovery on start
    if (configData.sourceNodeUrl) {
      uiMeta.sourceNodeUrl = String(configData.sourceNodeUrl);
    }
    fs.writeFileSync(UI_META_PATH, JSON.stringify(uiMeta, null, 2), 'utf8');

    const structured = flatConfigToBootstrapPreset(configData);
    const yamlStr = yaml.dump(structured, { lineWidth: 120, noRefs: true, quotingType: "'", forceQuotes: false });
    fs.writeFileSync(PRESET_PATH, yamlStr, 'utf8');
    res.json({ success: true, message: 'Preset saved successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Load preset (returns flat JSON for the UI)
app.get('/api/preset', (req, res) => {
  try {
    if (fs.existsSync(PRESET_PATH)) {
      const file = fs.readFileSync(PRESET_PATH, 'utf8');
      const data = yaml.load(file) as Record<string, unknown>;

      // If nested format (has networkProperties), flatten it
      let flat: Record<string, unknown>;
      if (data && data.networkProperties) {
        flat = bootstrapPresetToFlat(data);
      } else {
        // Already flat (legacy format) — return as-is
        flat = data ?? {};
      }

      // Merge in UI metadata (preset, assembly, etc.)
      if (fs.existsSync(UI_META_PATH)) {
        try {
          const meta = JSON.parse(fs.readFileSync(UI_META_PATH, 'utf8'));
          flat = { ...meta, ...flat };
        } catch { /* ignore corrupt meta */ }
      }

      res.json(flat);
    } else {
      res.json(null);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Download preset as raw YAML
app.get('/api/preset/download', (req, res) => {
  try {
    if (fs.existsSync(PRESET_PATH)) {
      res.setHeader('Content-Type', 'application/x-yaml');
      res.setHeader('Content-Disposition', 'attachment; filename="custom-preset.yml"');
      res.sendFile(PRESET_PATH);
    } else {
      res.status(404).json({ error: 'No preset file found.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Upload / import preset (YAML or JSON body)
app.post('/api/preset/import', (req, res) => {
  try {
    const { content, format } = req.body as { content: string; format: 'yaml' | 'json' };
    let parsed: unknown;

    if (format === 'json') {
      parsed = JSON.parse(content);
    } else {
      parsed = yaml.load(content);
    }

    // Write as YAML
    const yamlStr = yaml.dump(parsed, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(PRESET_PATH, yamlStr, 'utf8');

    res.json({ success: true, data: parsed });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to parse preset: ' + err.message });
  }
});

// =============================================================================
// Addresses endpoint
// =============================================================================

app.get('/api/addresses', (req, res) => {
  const addressPath = path.join(TARGET_DIR, 'addresses.yml');
  try {
    if (fs.existsSync(addressPath)) {
      const file = fs.readFileSync(addressPath, 'utf8');
      const data = yaml.load(file);
      res.json(data);
    } else {
      res.status(404).json({ error: 'Addresses file not found. Start the network first.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Download addresses as file
app.get('/api/addresses/download', (req, res) => {
  const addressPath = path.join(TARGET_DIR, 'addresses.yml');
  try {
    if (fs.existsSync(addressPath)) {
      res.setHeader('Content-Type', 'application/x-yaml');
      res.setHeader('Content-Disposition', 'attachment; filename="addresses.yml"');
      res.sendFile(addressPath);
    } else {
      res.status(404).json({ error: 'Addresses file not found.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Network status endpoint
// =============================================================================

app.get('/api/status', (_req, res) => {
  res.json(networkStatus);
});

// Node health endpoint (cached from periodic polling)
app.get('/api/node-health', (_req, res) => {
  res.json(nodeHealth);
});

// Force a health re-check
app.post('/api/node-health/refresh', async (_req, res) => {
  await pollNodeHealth();
  broadcast('NODE_HEALTH', nodeHealth);
  res.json(nodeHealth);
});

// =============================================================================
// Node statistics endpoint — aggregates chain/node/peers info from REST gateway
// =============================================================================
app.get('/api/node-stats', async (_req, res) => {
  const base = `http://${NODE_REST_HOST}:${NODE_REST_PORT}`;
  const timeout = 5000;

  const safeFetch = async (path: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const r = await fetch(`${base}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };

  const [chainInfo, nodeInfo, nodePeers, nodeHealth_, nodeServer] = await Promise.all([
    safeFetch('/chain/info'),
    safeFetch('/node/info'),
    safeFetch('/node/peers'),
    safeFetch('/node/health'),
    safeFetch('/node/server'),
  ]);

  const stats: Record<string, unknown> = {
    available: !!(chainInfo || nodeInfo),
    timestamp: new Date().toISOString(),
  };

  if (chainInfo) {
    stats.chain = {
      height: chainInfo.height ?? null,
      scoreHigh: chainInfo.scoreHigh ?? null,
      scoreLow: chainInfo.scoreLow ?? null,
      latestFinalizedBlock: chainInfo.latestFinalizedBlock ?? null,
    };
  }

  if (nodeInfo) {
    stats.node = {
      version: nodeInfo.version != null ? String(nodeInfo.version) : null,
      publicKey: nodeInfo.publicKey ?? null,
      networkGenerationHashSeed: nodeInfo.networkGenerationHashSeed ?? null,
      roles: nodeInfo.roles ?? null,
      port: nodeInfo.port ?? null,
      networkIdentifier: nodeInfo.networkIdentifier ?? null,
      friendlyName: nodeInfo.friendlyName ?? null,
      host: nodeInfo.host ?? null,
      nodePublicKey: nodeInfo.nodePublicKey ?? null,
    };
  }

  if (nodePeers) {
    const peers = Array.isArray(nodePeers) ? nodePeers : [];
    stats.peers = {
      count: peers.length,
      list: peers.map((p: Record<string, unknown>) => ({
        publicKey: p.publicKey ?? '',
        host: p.host ?? '',
        friendlyName: p.friendlyName ?? '',
        version: p.version != null ? String(p.version) : '',
        roles: p.roles ?? 0,
      })),
    };
  }

  if (nodeHealth_) {
    stats.health = {
      apiNode: nodeHealth_.status?.apiNode ?? 'unknown',
      db: nodeHealth_.status?.db ?? 'unknown',
    };
  }

  if (nodeServer) {
    stats.server = {
      serverInfo: nodeServer.serverInfo ?? null,
    };
  }

  res.json(stats);
});

// =============================================================================
// Storage usage endpoint — returns disk usage for TARGET_DIR
// =============================================================================
app.get('/api/storage', async (_req, res) => {
  try {
    const { execSync } = await import('child_process');

    // Get filesystem-level info via df
    let totalBytes = 0;
    let usedBytes = 0;
    let availBytes = 0;
    try {
      // df --output=size,used,avail -B1 gives bytes
      const dfOut = execSync(`df -B1 --output=size,used,avail "${TARGET_DIR}" 2>/dev/null | tail -1`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const parts = dfOut.split(/\s+/);
      if (parts.length >= 3) {
        totalBytes = Number(parts[0]) || 0;
        usedBytes = Number(parts[1]) || 0;
        availBytes = Number(parts[2]) || 0;
      }
    } catch {
      // fallback: try statvfs-style via Node
      const fsStat = fs.statfsSync(TARGET_DIR);
      totalBytes = fsStat.bsize * fsStat.blocks;
      availBytes = fsStat.bsize * fsStat.bavail;
      usedBytes = totalBytes - availBytes;
    }

    // Get per-directory breakdown via du
    const breakdown: Record<string, number> = {};
    let targetUsedBytes = 0;
    try {
      const duOut = execSync(`du -sb "${TARGET_DIR}"/* 2>/dev/null || true`, {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      for (const line of duOut.split('\n')) {
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (m) {
          const size = Number(m[1]);
          const dir = path.basename(m[2]);
          breakdown[dir] = size;
          targetUsedBytes += size;
        }
      }
    } catch {
      // du not available or empty dir — just report total
    }

    // If du didn't work, try du on the directory itself
    if (targetUsedBytes === 0) {
      try {
        const duTotal = execSync(`du -sb "${TARGET_DIR}" 2>/dev/null | head -1`, {
          encoding: 'utf-8',
          timeout: 10000,
        }).trim();
        const m = duTotal.match(/^(\d+)/);
        if (m) targetUsedBytes = Number(m[1]);
      } catch { /* ignore */ }
    }

    res.json({
      targetDir: TARGET_DIR,
      filesystem: { totalBytes, usedBytes, availBytes },
      target: { usedBytes: targetUsedBytes, breakdown },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Docker Image Management — list, export (docker save), import (docker load)
// =============================================================================

/**
 * GET /api/images — list Symbol-related Docker images on the host.
 */
app.get('/api/images', async (_req, res) => {
  try {
    const { execSync } = await import('child_process');
    const raw = execSync(
      `docker images --format '{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.ID}}\t{{.CreatedSince}}'`,
      { encoding: 'utf-8', timeout: 15_000 },
    ).trim();

    const images = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [repository, tag, size, id, created] = line.split('\t');
        return { repository, tag, size, id: id?.slice(0, 12), created, fullName: `${repository}:${tag}` };
      })
      .filter(
        (img) =>
          img.repository.includes('symbol') ||
          img.repository.includes('catapult') ||
          img.repository.includes('mongo'),
      );

    res.json({ images });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/images/export?image=repo:tag — stream `docker save` as a .tar download.
 * Images are 1-2 GB — streamed directly without temp files.
 */
app.get('/api/images/export', (req, res) => {
  const image = String(req.query.image || '');
  if (!image) { res.status(400).json({ error: 'image parameter required' }); return; }

  // Basic security: allow only reasonable Docker image names
  if (!/^[\w./_-]+:[\w./_-]+$/.test(image)) {
    res.status(400).json({ error: 'Invalid image name' }); return;
  }

  const safeName = image.replace(/[/:]/g, '_');
  res.setHeader('Content-Type', 'application/x-tar');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.tar"`);
  res.setHeader('Transfer-Encoding', 'chunked');

  broadcastLog(`[Images] Exporting ${image} ...\n`);

  const cp = spawn('docker', ['save', image], { shell: true });
  cp.stdout.pipe(res);

  cp.stderr.on('data', (d: Buffer) => {
    broadcastLog(`[Images] ${d.toString()}`);
  });

  cp.on('close', (code) => {
    if (code === 0) {
      broadcastLog(`[Images] ✅ Export complete: ${image}\n`);
    } else {
      broadcastLog(`[Images] ❌ Export failed (exit ${code})\n`);
      if (!res.headersSent) res.status(500).end();
    }
  });

  cp.on('error', (err) => {
    broadcastLog(`[Images] ❌ Export error: ${err.message}\n`);
    if (!res.headersSent) res.status(500).end();
  });

  // If client aborts the download, kill the docker save process
  req.on('close', () => { cp.kill(); });
});

/**
 * POST /api/images/import — stream request body (raw .tar) into `docker load`.
 * Send with Content-Type: application/octet-stream.
 * express.json() ignores non-JSON content-types, so req is still a readable stream.
 */
app.post('/api/images/import', (req, res) => {
  broadcastLog('[Images] Importing Docker image from tar...\n');

  const cp = spawn('docker', ['load'], { shell: true });
  let output = '';

  req.pipe(cp.stdin);

  cp.stdout.on('data', (d: Buffer) => {
    output += d.toString();
    broadcastLog(`[Images] ${d.toString()}`);
  });

  cp.stderr.on('data', (d: Buffer) => {
    output += d.toString();
    broadcastLog(`[Images] ${d.toString()}`);
  });

  cp.on('close', (code) => {
    if (code === 0) {
      broadcastLog(`[Images] ✅ Import complete\n`);
      res.json({ success: true, output: output.trim() });
    } else {
      broadcastLog(`[Images] ❌ Import failed\n`);
      res.status(500).json({ error: output.trim() || 'docker load failed' });
    }
  });

  cp.on('error', (err) => {
    broadcastLog(`[Images] ❌ Import error: ${err.message}\n`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// =============================================================================
// Patch: add missing properties that symbol-bootstrap 1.1.10 omits
// =============================================================================

/** Describes a set of missing properties to inject into a specific section of a .properties file. */
interface PropertiesPatch {
  file: string;            // e.g. 'config-node.properties'
  section: string;         // e.g. '[cache_database]'
  props: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Catapult version presets — mirrors frontend CATAPULT_VERSIONS
// ---------------------------------------------------------------------------
interface CatapultVersionDef {
  id: string;
  serverImage: string;
  needsOpenSslPatch: boolean;
  configPatches: PropertiesPatch[];
  /** Properties to REMOVE from config files (e.g. stale props from a previous version run). */
  removeProps?: { file: string; keys: string[] }[];
}

const CATAPULT_VERSIONS: CatapultVersionDef[] = [
  {
    id: 'v3',
    serverImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    needsOpenSslPatch: true,
    configPatches: [
      {
        file: 'config-node.properties',
        section: '[cache_database]',
        props: { maxLogFiles: '100', maxLogFileSize: '25MB' },
      },
      {
        file: 'config-network.properties',
        section: '[fork_heights]',
        props: {
          skipSecretLockUniquenessChecks: '',
          skipSecretLockExpirations: '',
          forceSecretLockExpirations: '',
          uniqueAggregateTransactionHash: '0',
        },
      },
    ],
  },
  {
    id: 'v2',
    serverImage: 'symbolplatform/symbol-server:gcc-1.0.3.6',
    needsOpenSslPatch: false,   // gcc-1.0.3.6 is Ubuntu 22.04 — OpenSSL 3 native
    configPatches: [],          // gcc-1.0.3.6 doesn't need any extra properties
    // Remove stale properties that may have been injected by a previous (1.0.3.7+) run.
    // gcc-1.0.3.6 only knows 3 fork_height props; the extra 3 from 1.0.3.7+ cause segfaults.
    // Also remove cache_database props added by 1.0.3.7+ templates (maxLogFiles, maxLogFileSize).
    removeProps: [
      {
        file: 'config-network.properties',
        keys: [
          'totalVotingBalance', 'treasuryReissuanceEpoch',
          'uniqueAggregateTransactionHash',
          'skipSecretLockUniquenessChecks', 'skipSecretLockExpirations', 'forceSecretLockExpirations',
        ],
      },
      {
        file: 'config-node.properties',
        keys: ['maxLogFiles', 'maxLogFileSize'],
      },
    ],
  },
];

/** Resolve which version def to use from the custom-preset YAML */
function resolveVersion(): CatapultVersionDef {
  // Try reading catapultVersion from ui-meta
  try {
    if (fs.existsSync(UI_META_PATH)) {
      const meta = JSON.parse(fs.readFileSync(UI_META_PATH, 'utf-8'));
      broadcastLog(`[resolveVersion] ui-meta catapultVersion=${meta.catapultVersion}\n`);
      const ver = CATAPULT_VERSIONS.find(v => v.id === meta.catapultVersion);
      if (ver) {
        broadcastLog(`[resolveVersion] Matched from ui-meta: ${ver.id}\n`);
        return ver;
      }
    }
  } catch { /* ignore */ }

  // Fallback: try to match by symbolServerImage in the preset YAML
  try {
    if (fs.existsSync(PRESET_PATH)) {
      const doc = yaml.load(fs.readFileSync(PRESET_PATH, 'utf-8')) as Record<string, unknown>;
      const img = String(doc.symbolServerImage ?? '');
      broadcastLog(`[resolveVersion] Fallback: YAML symbolServerImage=${img}\n`);
      for (const ver of CATAPULT_VERSIONS) {
        const tag = ver.serverImage.split(':')[1];
        if (img.includes(tag)) {
          broadcastLog(`[resolveVersion] Matched from YAML: ${ver.id} (tag=${tag})\n`);
          return ver;
        }
      }
    }
  } catch { /* ignore */ }

  // Default to V3
  broadcastLog(`[resolveVersion] No match — defaulting to V3\n`);
  return CATAPULT_VERSIONS[0];
}

// ---------------------------------------------------------------------------
// Build patched symbol-server image (OpenSSL symlink fix)
// Called dynamically before config step; reads the actual server image tag.
// ---------------------------------------------------------------------------
async function ensurePatchedImage(version: CatapultVersionDef): Promise<string> {
  if (!version.needsOpenSslPatch) {
    broadcastLog(`[Setup] Version ${version.id}: OpenSSL patch not needed\n`);
    return '';
  }

  // Read actual symbolServerImage from the preset YAML
  let baseImage = version.serverImage;
  try {
    if (fs.existsSync(PRESET_PATH)) {
      const doc = yaml.load(fs.readFileSync(PRESET_PATH, 'utf-8')) as Record<string, unknown>;
      if (doc.symbolServerImage) baseImage = String(doc.symbolServerImage);
    }
  } catch { /* use version default */ }

  // Derive patched tag: "symbolplatform/symbol-server:gcc-1.0.3.9" → "symbol-server-patched:gcc-1.0.3.9"
  const tag = baseImage.split(':')[1] ?? 'latest';
  const patchedTag = `symbol-server-patched:${tag}`;

  broadcastLog(`[Setup] Ensuring patched image: ${patchedTag} (from ${baseImage})\n`);

  // Check if it already exists
  const checkResult = await new Promise<number>((resolve) => {
    const cp = spawn('docker', ['image', 'inspect', patchedTag], { shell: true });
    cp.on('close', (code) => resolve(code ?? 1));
    cp.stdout?.on('data', () => {}); // drain
    cp.stderr?.on('data', () => {}); // drain
  });

  if (checkResult === 0) {
    broadcastLog(`[Setup] Patched image ${patchedTag} already exists\n`);
  } else {
    broadcastLog(`[Setup] Building patched image ${patchedTag} ...\n`);
    const dockerfile = `FROM ${baseImage}\nRUN ln -sf /etc/ssl/openssl.cnf /usr/catapult/deps/openssl.cnf\n`;

    await new Promise<void>((resolve, reject) => {
      const cp = spawn('docker', ['build', '-t', patchedTag, '-'], {
        shell: true,
      });
      cp.stdin?.write(dockerfile);
      cp.stdin?.end();
      cp.stdout?.on('data', (d: Buffer) => broadcastLog(d.toString()));
      cp.stderr?.on('data', (d: Buffer) => broadcastLog(d.toString()));
      cp.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker build exited with code ${code}`));
      });
      cp.on('error', reject);
    });
    broadcastLog(`[Setup] Patched image ${patchedTag} ready\n`);
  }

  // Now rewrite the preset YAML to use the patched image
  try {
    if (fs.existsSync(PRESET_PATH)) {
      const raw = fs.readFileSync(PRESET_PATH, 'utf-8');
      const doc = yaml.load(raw) as Record<string, unknown>;
      doc.symbolServerImage = patchedTag;
      // Also update tools image if it matches the base server image
      if (String(doc.symbolServerToolsImage ?? '') === baseImage) {
        doc.symbolServerToolsImage = patchedTag;
      }
      fs.writeFileSync(PRESET_PATH, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf-8');
      broadcastLog(`[Setup] Updated preset YAML to use ${patchedTag}\n`);
    }
  } catch (e: any) {
    broadcastLog(`[Setup] Warning: could not update preset YAML: ${e.message}\n`);
  }

  return patchedTag;
}

// ---------------------------------------------------------------------------
// Rewrite image names in the generated preset.yml inside the target dir
// so that the subsequent `compose` step picks up the patched image tag.
// ---------------------------------------------------------------------------
function rewriteGeneratedPresetImages(
  targetDir: string,
  version: CatapultVersionDef,
  patchedTag: string,
) {
  const generatedPreset = path.join(targetDir, 'preset.yml');
  if (!fs.existsSync(generatedPreset)) {
    broadcastLog('[Patch] No generated preset.yml found — skipping image rewrite\n');
    return;
  }
  try {
    const raw = fs.readFileSync(generatedPreset, 'utf-8');
    const doc = yaml.load(raw) as Record<string, unknown>;
    const baseImage = version.serverImage;
    let changed = false;

    // Top-level image keys — match both original and previously-patched names
    for (const key of ['symbolServerImage', 'symbolServerToolsImage']) {
      const cur = String(doc[key] ?? '');
      if (cur !== patchedTag && (
        cur === baseImage ||
        cur.startsWith('symbolplatform/symbol-server:') ||
        cur.startsWith('symbol-server-patched:')
      )) {
        doc[key] = patchedTag;
        changed = true;
      }
    }

    // Also patch node-level images inside nodes[].serverImage / brokerImage
    const nodes = doc.nodes as Record<string, unknown>[] | undefined;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        for (const imgKey of ['serverImage', 'brokerImage']) {
          const cur = String(node[imgKey] ?? '');
          if (cur !== patchedTag && (
            cur === baseImage ||
            cur.startsWith('symbolplatform/symbol-server:') ||
            cur.startsWith('symbol-server-patched:')
          )) {
            node[imgKey] = patchedTag;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      fs.writeFileSync(generatedPreset, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf-8');
      broadcastLog(`[Patch] Rewrote generated preset.yml images → ${patchedTag}\n`);
    }
  } catch (e: any) {
    broadcastLog(`[Patch] Warning: could not rewrite generated preset.yml: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Safety net: rewrite docker-compose.yml if compose still used the wrong image
// ---------------------------------------------------------------------------
function patchDockerComposeImages(
  targetDir: string,
  _version: CatapultVersionDef,
  patchedTag: string,
) {
  const composePath = path.join(targetDir, 'docker', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return;
  try {
    let content = fs.readFileSync(composePath, 'utf-8');
    let changed = false;

    // Replace ANY symbol-server image (patched or not) with the correct patched tag.
    // This catches both "symbolplatform/symbol-server:gcc-X.X.X.X"
    // and "symbol-server-patched:gcc-X.X.X.X" from previous runs.
    const imageRegex = /image:\s*(symbolplatform\/symbol-server:[^\s]+|symbol-server-patched:[^\s]+)/g;
    const newContent = content.replace(imageRegex, (_match, oldImage: string) => {
      if (oldImage !== patchedTag) {
        broadcastLog(`[Patch] docker-compose.yml: ${oldImage} → ${patchedTag}\n`);
        changed = true;
      }
      return `image: ${patchedTag}`;
    });

    // Also fix REST image if needed
    const restDoc = yaml.load(fs.readFileSync(path.join(SHARED_DIR, 'custom-preset.yml'), 'utf-8')) as Record<string, unknown>;
    const desiredRest = String(restDoc.symbolRestImage ?? '');
    if (desiredRest) {
      const restRegex = /image:\s*(symbolplatform\/symbol-rest:[^\s]+)/g;
      const finalContent = newContent.replace(restRegex, (_match, oldRest: string) => {
        if (oldRest !== desiredRest) {
          broadcastLog(`[Patch] docker-compose.yml: ${oldRest} → ${desiredRest}\n`);
          changed = true;
          return `image: ${desiredRest}`;
        }
        return _match;
      });
      if (changed) {
        fs.writeFileSync(composePath, finalContent, 'utf-8');
      }
    } else if (changed) {
      fs.writeFileSync(composePath, newContent, 'utf-8');
    }

    if (!changed) {
      broadcastLog(`[Patch] docker-compose.yml images already correct\n`);
    }
  } catch (e: any) {
    broadcastLog(`[Patch] Warning: could not patch docker-compose.yml: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Force-patch docker-compose.yml to match custom-preset.yml images.
// Reads the desired images directly from the user's custom-preset.yml and
// replaces ALL symbol-server / symbol-rest references in docker-compose.yml.
// This is the ultimate safety net — independent of version resolution.
// ---------------------------------------------------------------------------
function forceCorrectDockerComposeImages(targetDir: string) {
  const composePath = path.join(targetDir, 'docker', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    broadcastLog('[Patch] No docker-compose.yml found\n');
    return;
  }

  // Read desired images from custom-preset.yml
  let desiredServer = '';
  let desiredRest = '';
  try {
    const doc = yaml.load(fs.readFileSync(PRESET_PATH, 'utf-8')) as Record<string, unknown>;
    desiredServer = String(doc.symbolServerImage ?? '');
    desiredRest = String(doc.symbolRestImage ?? '');
  } catch {
    broadcastLog('[Patch] Cannot read custom-preset.yml for image names\n');
    return;
  }

  if (!desiredServer) {
    broadcastLog('[Patch] No symbolServerImage in custom-preset.yml\n');
    return;
  }

  broadcastLog(`[Patch] Desired server image: ${desiredServer}\n`);
  broadcastLog(`[Patch] Desired REST image: ${desiredRest}\n`);

  try {
    let content = fs.readFileSync(composePath, 'utf-8');
    let changed = false;

    // Replace any symbol-server image (patched or official) with the desired one
    const serverRegex = /image:\s*(symbolplatform\/symbol-server:[^\s]+|symbol-server-patched:[^\s]+)/g;
    content = content.replace(serverRegex, (_match, oldImage: string) => {
      if (oldImage !== desiredServer) {
        broadcastLog(`[Patch] docker-compose.yml: ${oldImage} → ${desiredServer}\n`);
        changed = true;
      }
      return `image: ${desiredServer}`;
    });

    // Replace REST image
    if (desiredRest) {
      const restRegex = /image:\s*(symbolplatform\/symbol-rest:[^\s]+)/g;
      content = content.replace(restRegex, (_match, oldRest: string) => {
        if (oldRest !== desiredRest) {
          broadcastLog(`[Patch] docker-compose.yml: ${oldRest} → ${desiredRest}\n`);
          changed = true;
        }
        return `image: ${desiredRest}`;
      });
    }

    if (changed) {
      fs.writeFileSync(composePath, content, 'utf-8');
      broadcastLog(`[Patch] docker-compose.yml images corrected ✓\n`);
    } else {
      broadcastLog(`[Patch] docker-compose.yml images already correct ✓\n`);
    }
  } catch (e: any) {
    broadcastLog(`[Patch] Warning: could not patch docker-compose.yml: ${e.message}\n`);
  }
}

function patchGeneratedConfigs(targetDir: string, version: CatapultVersionDef) {
  const patches = version.configPatches;
  const removePropsSet = version.removeProps ?? [];
  const nodesDir = path.join(targetDir, 'nodes');
  if (!fs.existsSync(nodesDir)) return;

  for (const nodeName of fs.readdirSync(nodesDir)) {
    for (const configDir of ['server-config', 'broker-config']) {

      // --- Add missing properties ---
      for (const patch of patches) {
        const configPath = path.join(
          nodesDir, nodeName,
          configDir, 'resources', patch.file,
        );
        if (!fs.existsSync(configPath)) continue;

        let content = fs.readFileSync(configPath, 'utf-8');
        let patched = false;

        for (const [key, defaultValue] of Object.entries(patch.props)) {
          const regex = new RegExp(`^\\s*${key}\\s*=`, 'm');
          if (!regex.test(content)) {
            const sectionIdx = content.indexOf(patch.section);
            if (sectionIdx === -1) continue;

            const afterSection = content.slice(sectionIdx);
            const nextSection = afterSection.search(/\n\[(?!\s*$)/);
            const insertPos = nextSection !== -1
              ? sectionIdx + nextSection
              : content.length;

            content =
              content.slice(0, insertPos).trimEnd() +
              `\n${key} = ${defaultValue}\n` +
              (nextSection !== -1 ? '\n' : '') +
              content.slice(insertPos).trimStart();
            patched = true;
          }
        }

        if (patched) {
          fs.writeFileSync(configPath, content, 'utf-8');
          broadcastLog(`[Patch] Fixed ${patch.section} in ${nodeName}/${configDir}/${patch.file}\n`);
        }
      }

      // --- Remove stale properties from a previous version ---
      for (const rmSet of removePropsSet) {
        const configPath = path.join(
          nodesDir, nodeName,
          configDir, 'resources', rmSet.file,
        );
        if (!fs.existsSync(configPath)) continue;

        let content = fs.readFileSync(configPath, 'utf-8');
        let removed = false;
        for (const key of rmSet.keys) {
          const regex = new RegExp(`^\\s*${key}\\s*=.*\\r?\\n?`, 'gm');
          if (regex.test(content)) {
            content = content.replace(regex, '');
            removed = true;
            broadcastLog(`[Patch] Removed stale property '${key}' from ${nodeName}/${configDir}/${rmSet.file}\n`);
          }
        }
        if (removed) {
          fs.writeFileSync(configPath, content, 'utf-8');
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Patch rest.json: apiNode.host "node" → "api-node-0"
  // symbol-bootstrap sets host to "node" but docker-compose uses the actual
  // service name "api-node-0".  We also need to add an alias in docker-compose.
  // The simpler fix is to patch rest.json so it matches the service name.
  // -----------------------------------------------------------------------
  const gatewaysDir = path.join(targetDir, 'gateways');
  if (fs.existsSync(gatewaysDir)) {
    for (const gwName of fs.readdirSync(gatewaysDir)) {
      const restJsonPath = path.join(gatewaysDir, gwName, 'rest.json');
      if (!fs.existsSync(restJsonPath)) continue;
      try {
        const restConfig = JSON.parse(fs.readFileSync(restJsonPath, 'utf-8'));
        if (restConfig.apiNode?.host && restConfig.apiNode.host !== 'api-node-0') {
          const oldHost = restConfig.apiNode.host;
          restConfig.apiNode.host = 'api-node-0';
          fs.writeFileSync(restJsonPath, JSON.stringify(restConfig, null, 2), 'utf-8');
          broadcastLog(`[Patch] rest.json apiNode.host: "${oldHost}" → "api-node-0"\n`);
        }
      } catch (e: any) {
        broadcastLog(`[Patch] Warning: could not patch ${restJsonPath}: ${e.message}\n`);
      }
    }
  }
}

// =============================================================================
// Peer discovery — fetch peers from the source node and write peers-*.json
// =============================================================================

/** Convert numeric roles bitmask to a comma-separated string */
function rolesToString(roles: number): string {
  const parts: string[] = [];
  if (roles & 1) parts.push('Peer');
  if (roles & 2) parts.push('Api');
  if (roles & 4) parts.push('Voting');
  return parts.length > 0 ? parts.join(',') : 'Peer';
}

interface PeerEntry {
  publicKey: string;
  endpoint: { host: string; port: number };
  metadata: { name: string; roles: string };
}

/**
 * Fetch /node/info and /node/peers from the source node URL, then build and
 * overwrite peers-p2p.json and peers-api.json for every node in the target.
 */
async function fetchAndWritePeerFiles(targetDir: string, sourceNodeUrl: string): Promise<void> {
  const base = sourceNodeUrl.replace(/\/+$/, '');
  broadcastLog(`[Peers] Fetching peer info from ${base} ...\n`);

  const fetchJson = async (urlPath: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await fetch(`${base}${urlPath}`, { signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${urlPath}`);
      return r.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  // Fetch source node info, peers, and network properties
  let nodeInfo: Record<string, any>;
  let remotePeers: Record<string, any>[];
  let networkProps: Record<string, any>;
  try {
    [nodeInfo, remotePeers, networkProps] = await Promise.all([
      fetchJson('/node/info'),
      fetchJson('/node/peers').catch(() => []),
      fetchJson('/network/properties').catch(() => ({})),
    ]);
    if (!Array.isArray(remotePeers)) remotePeers = [];
  } catch (err: any) {
    broadcastLog(`[Peers] ⚠️  Could not fetch from source node: ${err.message}\n`);
    return;
  }

  // Derive the host of the source node from the URL
  let sourceHost: string;
  try {
    const parsed = new URL(base);
    sourceHost = parsed.hostname;
  } catch {
    broadcastLog(`[Peers] ⚠️  Could not parse source URL hostname\n`);
    return;
  }

  // Build the source node as a peer entry
  const sourceEntry: PeerEntry = {
    publicKey: String(nodeInfo.publicKey ?? ''),
    endpoint: {
      host: sourceHost,
      port: Number(nodeInfo.port ?? 7900),
    },
    metadata: {
      name: String(nodeInfo.friendlyName || sourceHost),
      roles: rolesToString(Number(nodeInfo.roles ?? 1)),
    },
  };

  // Build entries from /node/peers
  const peerEntries: PeerEntry[] = remotePeers
    .filter((p: any) => p.publicKey && (p.host || p.endpoint?.host))
    .map((p: any) => ({
      publicKey: String(p.publicKey),
      endpoint: {
        host: String(p.host ?? p.endpoint?.host ?? ''),
        port: Number(p.port ?? p.endpoint?.port ?? 7900),
      },
      metadata: {
        name: String(p.friendlyName ?? p.metadata?.name ?? ''),
        roles: typeof p.roles === 'number'
          ? rolesToString(p.roles)
          : String(p.metadata?.roles ?? 'Peer'),
      },
    }))
    .filter((e: PeerEntry) => e.endpoint.host && e.publicKey);

  // Deduplicate by publicKey — source node first
  const seen = new Set<string>();
  const allPeers: PeerEntry[] = [];
  for (const entry of [sourceEntry, ...peerEntries]) {
    if (!entry.publicKey || seen.has(entry.publicKey)) continue;
    seen.add(entry.publicKey);
    allPeers.push(entry);
  }

  broadcastLog(`[Peers] Source node: ${sourceHost}:${sourceEntry.endpoint.port} (${sourceEntry.metadata.roles})\n`);
  broadcastLog(`[Peers] Discovered ${peerEntries.length} additional peers, total unique: ${allPeers.length}\n`);

  // Split into p2p peers (has Peer role) and api peers (has Api role)
  const p2pPeers = allPeers.filter(p => p.metadata.roles.includes('Peer'));
  const apiPeers = allPeers.filter(p => p.metadata.roles.includes('Api'));

  const p2pJson = JSON.stringify({
    _info: 'this file contains a list of peers — auto-generated from source node',
    knownPeers: p2pPeers,
  }, null, 2);

  const apiJson = JSON.stringify({
    _info: 'this file contains a list of api peers — auto-generated from source node',
    knownPeers: apiPeers,
  }, null, 2);

  // Overwrite peers files for every node (server-config and broker-config)
  const nodesDir = path.join(targetDir, 'nodes');
  if (!fs.existsSync(nodesDir)) {
    broadcastLog(`[Peers] ⚠️  No nodes directory found at ${nodesDir}\n`);
    return;
  }

  let filesWritten = 0;
  for (const nodeName of fs.readdirSync(nodesDir)) {
    for (const configDir of ['server-config', 'broker-config']) {
      const resourcesDir = path.join(nodesDir, nodeName, configDir, 'resources');
      if (!fs.existsSync(resourcesDir)) continue;

      const p2pPath = path.join(resourcesDir, 'peers-p2p.json');
      const apiPath = path.join(resourcesDir, 'peers-api.json');

      if (fs.existsSync(p2pPath)) {
        fs.writeFileSync(p2pPath, p2pJson, 'utf-8');
        filesWritten++;
      }
      if (fs.existsSync(apiPath)) {
        fs.writeFileSync(apiPath, apiJson, 'utf-8');
        filesWritten++;
      }
    }
  }

  broadcastLog(`[Peers] ✅ Wrote ${filesWritten} peer files (${p2pPeers.length} p2p, ${apiPeers.length} api peers)\n`);

  // -----------------------------------------------------------------------
  // Patch config-network.properties with ALL values from the source node.
  // symbol-bootstrap -p testnet uses the public testnet defaults; we need
  // to overwrite [network], [chain], and every [plugin:*] section with the
  // custom network's actual values so that the nemesis block validation
  // computes the correct AccountStateCache / importance statistics.
  // -----------------------------------------------------------------------
  const networkOverrides: Record<string, string> = {};

  // Helper: strip Symbol thousands-separator ticks (e.g. "8'998'999" → "8'998'999")
  // The REST API returns values with Unicode tick (\u0027) that we keep as-is
  // because the config file uses the same format.
  const addOverrides = (section: Record<string, any>) => {
    for (const [key, value] of Object.entries(section)) {
      if (key === 'dummy') continue; // skip dummy plugin triggers
      const strVal = String(value).trim();
      if (strVal) networkOverrides[key] = strVal;
    }
  };

  // [network] section
  const srcNetwork = (networkProps.network ?? {}) as Record<string, string>;
  addOverrides(srcNetwork);

  // [chain] section – critical for harvestingMosaicId, currencyMosaicId,
  // minHarvesterBalance, totalChainImportance, etc.
  const srcChain = (networkProps.chain ?? {}) as Record<string, string>;
  addOverrides(srcChain);

  // [plugin:*] sections
  const srcPlugins = (networkProps.plugins ?? {}) as Record<string, Record<string, string>>;
  for (const [, pluginProps] of Object.entries(srcPlugins)) {
    if (pluginProps && typeof pluginProps === 'object') {
      addOverrides(pluginProps);
    }
  }

  // [fork_heights] section — e.g. strictAggregateTransactionHash
  const srcForkHeights = (networkProps.forkHeights ?? {}) as Record<string, string>;
  addOverrides(srcForkHeights);

  if (Object.keys(networkOverrides).length > 0) {
    broadcastLog(`[Network] Patching ${Object.keys(networkOverrides).length} properties from source node...\n`);

    // Helper: patch a single config-network.properties file
    const patchFile = (filePath: string, label: string): boolean => {
      if (!fs.existsSync(filePath)) return false;
      let content = fs.readFileSync(filePath, 'utf-8');
      let changed = false;
      for (const [key, value] of Object.entries(networkOverrides)) {
        const regex = new RegExp(`^(${key}\\s*=\\s*).*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `$1${value}`);
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(filePath, content, 'utf-8');
        broadcastLog(`[Network] ✅ Patched ${label}\n`);
      }
      return changed;
    };

    let propsPatched = 0;

    // 1) Patch nodes/*/server-config & broker-config
    for (const nodeName of fs.readdirSync(nodesDir)) {
      for (const configDir of ['server-config', 'broker-config']) {
        const configPath = path.join(nodesDir, nodeName, configDir, 'resources', 'config-network.properties');
        if (patchFile(configPath, `${nodeName}/${configDir}/config-network.properties`)) propsPatched++;
      }
    }

    // 2) Patch gateways/*/api-node-config  (REST gateway also needs matching identity)
    const gatewaysDir = path.join(targetDir, 'gateways');
    if (fs.existsSync(gatewaysDir)) {
      for (const gwName of fs.readdirSync(gatewaysDir)) {
        const gwConfig = path.join(gatewaysDir, gwName, 'api-node-config', 'config-network.properties');
        if (patchFile(gwConfig, `gateways/${gwName}/api-node-config/config-network.properties`)) propsPatched++;
      }
    }

    if (propsPatched === 0) {
      broadcastLog(`[Network] ⚠️  No config-network.properties files were patched\n`);
    }
  }

  // -----------------------------------------------------------------------
  // Patch config-inflation.properties:
  //   - For public networks (testnet/mainnet): KEEP the inflation schedule
  //     generated by symbol-bootstrap because it contains hundreds of entries
  //     that define harvesting rewards.  Without these, importance calculation
  //     at the first importanceGrouping boundary block (e.g. block 5760)
  //     will produce a hash mismatch (Failure_Core_Importance_Block_Mismatch).
  //   - For custom/private networks: replace with zero-inflation because the
  //     public preset's inflation schedule may be incompatible with the
  //     custom network's initialCurrencyAtomicUnits / maxMosaicAtomicUnits.
  // -----------------------------------------------------------------------
  let isPublicNetwork = false;
  try {
    if (fs.existsSync(UI_META_PATH)) {
      const meta = JSON.parse(fs.readFileSync(UI_META_PATH, 'utf-8'));
      const preset = (meta.preset ?? '').toLowerCase();
      if (preset === 'testnet' || preset === 'mainnet') {
        isPublicNetwork = true;
      }
    }
  } catch { /* ignore */ }

  if (isPublicNetwork) {
    broadcastLog(`[Network] ℹ️  Public network detected – keeping original config-inflation.properties\n`);
  } else {
    const zeroInflation = '[inflation]\n\nstarting-at-height-2 = 0\n';
    let inflationPatched = 0;

    for (const nodeName of fs.readdirSync(nodesDir)) {
      for (const configDir of ['server-config', 'broker-config']) {
        const inflPath = path.join(nodesDir, nodeName, configDir, 'resources', 'config-inflation.properties');
        if (fs.existsSync(inflPath)) {
          fs.writeFileSync(inflPath, zeroInflation, 'utf-8');
          inflationPatched++;
        }
      }
    }

    if (inflationPatched > 0) {
      broadcastLog(`[Network] ✅ Reset config-inflation.properties to zero-inflation (${inflationPatched} files)\n`);
    }
  }
}

// =============================================================================
// Patch config-node.properties: trustedHosts & localNetworks must include the
// Docker network subnet so the REST gateway (running in a sibling container)
// is treated as a local/trusted connection.  symbol-bootstrap only sets
// "127.0.0.1" by default — the REST container connects from 172.20.0.x.
// =============================================================================
function patchLocalNetworks(targetDir: string) {
  const nodesDir = path.join(targetDir, 'nodes');
  if (!fs.existsSync(nodesDir)) return;

  // Read the Docker subnet from docker-compose.yml (default 172.20.0.0/24)
  let subnet = '172.20.0.0/24';
  const composePath = path.join(targetDir, 'docker', 'docker-compose.yml');
  if (fs.existsSync(composePath)) {
    const composeContent = fs.readFileSync(composePath, 'utf-8');
    const subnetMatch = composeContent.match(/subnet:\s*(\S+)/);
    if (subnetMatch) subnet = subnetMatch[1];
  }

  let patched = 0;
  for (const nodeName of fs.readdirSync(nodesDir)) {
    for (const configDir of ['server-config', 'broker-config']) {
      const configPath = path.join(nodesDir, nodeName, configDir, 'resources', 'config-node.properties');
      if (!fs.existsSync(configPath)) continue;

      let content = fs.readFileSync(configPath, 'utf-8');
      let changed = false;

      for (const key of ['trustedHosts', 'localNetworks']) {
        const regex = new RegExp(`^(${key}\\s*=\\s*)(.*)$`, 'm');
        const match = content.match(regex);
        if (match && !match[2].includes(subnet)) {
          const oldVal = match[2].trim();
          const newVal = oldVal ? `${oldVal}, ${subnet}` : subnet;
          content = content.replace(regex, `$1${newVal}`);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(configPath, content, 'utf-8');
        patched++;
        broadcastLog(`[Patch] Added Docker subnet ${subnet} to trustedHosts/localNetworks in ${nodeName}/${configDir}\n`);
      }
    }
  }
  if (patched > 0) {
    broadcastLog(`[Patch] ✅ localNetworks patched in ${patched} config files\n`);
  }
}

// =============================================================================
// Generate a separate TLS certificate for the REST gateway so its identity
// (CA public key) differs from the api-node's.  Without this, the api-node
// rejects the connection with "rejecting new host ... with in use identity key".
// Uses child_process to call openssl (available in the DinD node:20 image).
// =============================================================================
function generateRestGatewayCert(targetDir: string) {
  const { execSync } = require('child_process') as typeof import('child_process');
  const gatewaysDir = path.join(targetDir, 'gateways');
  if (!fs.existsSync(gatewaysDir)) return;

  for (const gwName of fs.readdirSync(gatewaysDir)) {
    const certDir = path.join(gatewaysDir, gwName, 'api-node-config', 'cert');
    if (!fs.existsSync(certDir)) continue;

    // Find the api-node's CA cert to keep it as `ca.cert.pem` (server verification)
    const apiCaCertPath = path.join(targetDir, 'nodes', 'api-node-0', 'cert', 'ca.cert.pem');
    if (!fs.existsSync(apiCaCertPath)) {
      broadcastLog(`[Cert] ⚠️  API-node CA cert not found, skipping REST cert generation\n`);
      continue;
    }

    // Check if REST already has a different cert (no need to regenerate)
    const restKeyPath = path.join(certDir, 'node.key.pem');
    const apiKeyPath = path.join(targetDir, 'nodes', 'api-node-0', 'cert', 'node.key.pem');
    if (fs.existsSync(restKeyPath) && fs.existsSync(apiKeyPath)) {
      const restKey = fs.readFileSync(restKeyPath);
      const apiKey = fs.readFileSync(apiKeyPath);
      if (!restKey.equals(apiKey)) {
        broadcastLog(`[Cert] REST gateway already has a distinct certificate — skipping\n`);
        continue;
      }
    }

    broadcastLog(`[Cert] Generating separate TLS certificate for ${gwName}...\n`);

    try {
      const caKeyPath = path.join(certDir, 'ca.key.pem');
      const restCaCertPath = path.join(certDir, 'rest-ca.cert.pem');
      const csrPath = path.join(certDir, 'node.csr.pem');

      // Read certificate expiration days from preset (default: CA=7300, node=375)
      let caCertDays = 7300;
      let nodeCertDays = 375;
      try {
        if (fs.existsSync(PRESET_PATH)) {
          const presetDoc = yaml.load(fs.readFileSync(PRESET_PATH, 'utf-8')) as Record<string, unknown>;
          if (presetDoc.caCertificateExpirationInDays) caCertDays = Number(presetDoc.caCertificateExpirationInDays);
          if (presetDoc.nodeCertificateExpirationInDays) nodeCertDays = Number(presetDoc.nodeCertificateExpirationInDays);
        }
      } catch { /* use defaults */ }

      // Generate new CA key + self-signed cert for REST
      execSync(`openssl genpkey -algorithm ED25519 -out "${caKeyPath}"`, { stdio: 'pipe' });
      execSync(`openssl req -new -x509 -key "${caKeyPath}" -out "${restCaCertPath}" -days ${caCertDays} -subj "/CN=${gwName}-account"`, { stdio: 'pipe' });

      // Generate new node key + cert signed by REST CA
      execSync(`openssl genpkey -algorithm ED25519 -out "${restKeyPath}"`, { stdio: 'pipe' });
      execSync(`openssl req -new -key "${restKeyPath}" -out "${csrPath}" -subj "/CN=${gwName}"`, { stdio: 'pipe' });
      execSync(`openssl x509 -req -in "${csrPath}" -CA "${restCaCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${path.join(certDir, 'node.crt.pem')}" -days ${nodeCertDays}`, { stdio: 'pipe' });

      // node.crt.pem = REST node cert + REST CA cert (full chain for TLS client)
      const nodeCert = fs.readFileSync(path.join(certDir, 'node.crt.pem'), 'utf-8');
      const restCaCert = fs.readFileSync(restCaCertPath, 'utf-8');
      fs.writeFileSync(path.join(certDir, 'node.crt.pem'), nodeCert.trimEnd() + '\n' + restCaCert, 'utf-8');

      // ca.cert.pem = API-NODE's CA cert (for verifying the server's TLS cert)
      fs.copyFileSync(apiCaCertPath, path.join(certDir, 'ca.cert.pem'));

      // Clean up temporary files
      for (const tmp of [csrPath, path.join(certDir, 'rest-ca.cert.srl')]) {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }

      broadcastLog(`[Cert] ✅ REST gateway certificate generated for ${gwName}\n`);
    } catch (e: any) {
      broadcastLog(`[Cert] ⚠️  Failed to generate REST cert: ${e.message}\n`);
    }
  }
}

// =============================================================================
// Nemesis block reconstruction from source node REST API
// =============================================================================

function writeUint64LE(value: string | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}
function writeUint32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}
function writeUint16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}
function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}
/**
 * Build a proper proof.index.dat (48 bytes) = FinalizationStatistics:
 *   Epoch (uint32) + Point (uint32) + Height (uint64) + Hash (32 bytes)
 * The catapult FinalizationIndexFile::get() requires exactly 48 bytes;
 * if the file is any other size it returns all-zero statistics (Height=0)
 * which causes LoadHashAtHeight to crash with a NULL-pointer dereference.
 */
function buildProofIndexDat(nemesisEntityHash: Buffer | string): Buffer {
  const hash = typeof nemesisEntityHash === 'string'
    ? Buffer.from(nemesisEntityHash, 'hex')
    : nemesisEntityHash;
  return Buffer.concat([
    writeUint32LE(1),   // Epoch = 1
    writeUint32LE(1),   // Point = 1
    writeUint64LE(1),   // Height = 1
    hash,               // 32-byte nemesis block EntityHash
  ]);
}
/** Convert a hex-encoded uint64 (big-endian display) → little-endian Buffer */
function hexUint64ToLE(hex: string): Buffer {
  const buf = Buffer.from(hex.padStart(16, '0'), 'hex');
  return Buffer.from([...buf].reverse());
}
/** Pad buffer to next 8-byte boundary with zeros */
function padTo8(buf: Buffer): Buffer {
  const r = buf.length % 8;
  return r === 0 ? buf : Buffer.concat([buf, Buffer.alloc(8 - r)]);
}

function serializeBlockHeader(b: Record<string, any>): Buffer {
  return Buffer.concat([
    writeUint32LE(b.size), writeUint32LE(0),                           // size + reserved
    hexToBuffer(b.signature),                                           // 64
    hexToBuffer(b.signerPublicKey), writeUint32LE(0),                   // 32 + reserved
    Buffer.from([b.version, b.network]),                                // 1+1
    writeUint16LE(b.type),                                              // 2
    writeUint64LE(b.height), writeUint64LE(b.timestamp),                // 8+8
    writeUint64LE(b.difficulty),                                        // 8
    hexToBuffer(b.proofGamma),                                          // 32
    hexToBuffer(b.proofVerificationHash),                               // 16
    hexToBuffer(b.proofScalar),                                         // 32
    hexToBuffer(b.previousBlockHash),                                   // 32
    hexToBuffer(b.transactionsHash),                                    // 32
    hexToBuffer(b.receiptsHash),                                        // 32
    hexToBuffer(b.stateHash),                                           // 32
    hexToBuffer(b.beneficiaryAddress),                                  // 24
    writeUint32LE(b.feeMultiplier),                                     // 4
    // ImportanceBlock additional fields
    writeUint32LE(b.votingEligibleAccountsCount),                       // 4
    writeUint64LE(b.harvestingEligibleAccountsCount),                   // 8
    writeUint64LE(b.totalVotingBalance),                                // 8
    hexToBuffer(b.previousImportanceBlockHash),                         // 32
  ]);
}

function serializeTransaction(tx: Record<string, any>): Buffer {
  // Common outer header (128 bytes)
  const hdr = Buffer.concat([
    writeUint32LE(tx.size), writeUint32LE(0),
    hexToBuffer(tx.signature),
    hexToBuffer(tx.signerPublicKey), writeUint32LE(0),
    Buffer.from([tx.version, tx.network]),
    writeUint16LE(tx.type),
    writeUint64LE(tx.maxFee), writeUint64LE(tx.deadline),
  ]);

  let body: Buffer;
  switch (tx.type) {
    case 16718: { // NamespaceRegistration
      const nm = Buffer.from(tx.name, 'utf-8');
      body = Buffer.concat([
        tx.registrationType === 0 ? writeUint64LE(tx.duration) : hexUint64ToLE(tx.parentId),
        hexUint64ToLE(tx.id),
        Buffer.from([tx.registrationType, nm.length]),
        nm,
      ]);
      break;
    }
    case 16717: // MosaicDefinition
      body = Buffer.concat([
        hexUint64ToLE(tx.id), writeUint64LE(tx.duration),
        writeUint32LE(tx.nonce), Buffer.from([tx.flags, tx.divisibility]),
      ]);
      break;
    case 17230: // MosaicAlias
      body = Buffer.concat([hexUint64ToLE(tx.namespaceId), hexUint64ToLE(tx.mosaicId), Buffer.from([tx.aliasAction])]);
      break;
    case 16973: // MosaicSupplyChange
      body = Buffer.concat([hexUint64ToLE(tx.mosaicId), writeUint64LE(tx.delta), Buffer.from([tx.action])]);
      break;
    case 16724: { // Transfer
      const mosaics: any[] = tx.mosaics || [];
      const msg = tx.message ? hexToBuffer(tx.message) : Buffer.alloc(0);
      body = Buffer.concat([
        hexToBuffer(tx.recipientAddress),           // 24
        writeUint16LE(msg.length),                  // 2
        Buffer.from([mosaics.length]),              // 1
        writeUint32LE(0), Buffer.from([0]),         // 4+1 reserved
        ...mosaics.map((m: any) => Buffer.concat([hexUint64ToLE(m.id), writeUint64LE(m.amount)])),
        msg,
      ]);
      break;
    }
    case 16716: // AccountKeyLink
    case 16963: // VrfKeyLink
      body = Buffer.concat([hexToBuffer(tx.linkedPublicKey), Buffer.from([tx.linkAction])]);
      break;
    default:
      throw new Error(`Unknown transaction type: ${tx.type}`);
  }

  const result = Buffer.concat([hdr, body]);
  if (result.length !== tx.size) {
    throw new Error(`Tx serialization size mismatch: type=${tx.type} expected=${tx.size} got=${result.length}`);
  }
  return result;
}

/**
 * Serialize the nemesis block's receipt statements to binary for the .stmt file.
 *
 * Binary format (V2/catapult-server 1.0.3.x):
 *   uint32  numTransactionStatements
 *   uint32  numAddressResolutionStatements
 *   uint32  numMosaicResolutionStatements
 *   [TransactionStatement ...]
 *   [AddressResolution ...]
 *   [MosaicResolution ...]
 *
 * TransactionStatement:
 *   ReceiptSource { uint32 primaryId, uint32 secondaryId }
 *   uint32 numReceipts
 *   Receipt[] receipts
 *
 * Receipt:
 *   uint32 size, uint16 version, uint16 type, <body>
 *   body for type 0x2143 (Harvest_Fee / BalanceCredit):
 *     24-byte targetAddress, 8-byte mosaicId, 8-byte amount
 *
 * MosaicResolution:
 *   uint64 unresolved
 *   uint32 numEntries
 *   ResolutionEntry[] { ReceiptSource(8), uint64 resolved }
 */
function serializeNemesisStatements(txStmts: any[], mosaicResolutions: any[]): Buffer {
  const parts: Buffer[] = [];

  // Format: ReadStatements reads each group sequentially:
  //   numTxStatements(4) | txStatement1 | txStatement2 | ...
  //   numAddrResolutions(4) | addrResolution1 | ...
  //   numMosaicResolutions(4) | mosaicResolution1 | ...

  // --- Transaction statements ---
  parts.push(writeUint32LE(txStmts.length));
  for (const s of txStmts) {
    const src = s.statement.source;
    parts.push(writeUint32LE(src.primaryId));
    parts.push(writeUint32LE(src.secondaryId));
    const receipts: any[] = s.statement.receipts || [];
    parts.push(writeUint32LE(receipts.length));

    for (const r of receipts) {
      const receiptType = r.type;
      let body: Buffer;
      if (receiptType === 8515 || receiptType === 8516) {
        // BalanceCredit (0x2143) or BalanceDebit (0x2144)
        // body: targetAddress(24) + mosaicId(8) + amount(8)
        body = Buffer.concat([
          hexToBuffer(r.targetAddress),
          hexUint64ToLE(r.mosaicId),
          writeUint64LE(r.amount),
        ]);
      } else if (receiptType === 57667 || receiptType === 57603) {
        // ArtifactExpiry mosaic/namespace
        body = hexUint64ToLE(r.artifactId);
      } else {
        // Fallback: empty body
        body = Buffer.alloc(0);
      }
      const receiptSize = 4 + 2 + 2 + body.length;
      parts.push(writeUint32LE(receiptSize));
      parts.push(writeUint16LE(r.version));
      parts.push(writeUint16LE(receiptType));
      parts.push(body);
    }
  }

  // --- Address resolution statements (none for nemesis) ---
  parts.push(writeUint32LE(0));

  // --- Mosaic resolution statements ---
  parts.push(writeUint32LE(mosaicResolutions.length));
  for (const res of mosaicResolutions) {
    parts.push(hexUint64ToLE(res.statement.unresolved));
    const entries: any[] = res.statement.resolutionEntries || [];
    parts.push(writeUint32LE(entries.length));
    for (const e of entries) {
      const src = typeof e.source === 'string' ? JSON.parse(e.source.replace(/@/g, '')) : e.source;
      parts.push(writeUint32LE(src.primaryId));
      parts.push(writeUint32LE(src.secondaryId));
      parts.push(hexUint64ToLE(e.resolved));
    }
  }

  return Buffer.concat(parts);
}

/**
 * Install imported seed files from shared/seed/ into the target directory.
 * The network administrator provides these files (00001.dat, 00001.stmt,
 * hashes.dat, etc.) which are the authoritative nemesis block data.
 *
 * Expected layout in SEED_DIR:
 *   seed/
 *     index.dat            (optional – will generate if missing)
 *     proof.index.dat      (optional – will generate if missing)
 *     00000/
 *       00001.dat          (REQUIRED – nemesis block element)
 *       00001.stmt         (REQUIRED – nemesis receipt statements)
 *       hashes.dat         (REQUIRED – entityHash + generationHash)
 *       00001.proof        (optional)
 *       proof.heights.dat  (optional)
 */
async function installImportedSeed(targetDir: string): Promise<void> {
  const seedSrc = path.join(SEED_DIR, '00000');
  const requiredFiles = ['00001.dat', '00001.stmt', 'hashes.dat'];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(seedSrc, f))) {
      throw new Error(`Missing required seed file: 00000/${f}`);
    }
  }

  const elementBuf = fs.readFileSync(path.join(seedSrc, '00001.dat'));
  const stmtBuf = fs.readFileSync(path.join(seedSrc, '00001.stmt'));
  const hashesBuf = fs.readFileSync(path.join(seedSrc, 'hashes.dat'));

  broadcastLog(`[Nemesis] Imported seed: 00001.dat=${elementBuf.length}B, 00001.stmt=${stmtBuf.length}B, hashes.dat=${hashesBuf.length}B\n`);

  // --- Write seed files ---
  const seedBase = path.join(targetDir, 'nemesis', 'seed');
  const seedDir  = path.join(seedBase, '00000');
  fs.mkdirSync(seedDir, { recursive: true });

  fs.writeFileSync(path.join(seedDir, '00001.dat'), elementBuf);
  fs.writeFileSync(path.join(seedDir, '00001.stmt'), stmtBuf);
  fs.writeFileSync(path.join(seedDir, 'hashes.dat'), hashesBuf);

  // Copy optional files if present
  for (const opt of ['00001.proof', 'proof.heights.dat']) {
    const src = path.join(seedSrc, opt);
    if (fs.existsSync(src)) fs.writeFileSync(path.join(seedDir, opt), fs.readFileSync(src));
  }

  // index.dat
  const indexSrc = path.join(SEED_DIR, 'index.dat');
  fs.writeFileSync(path.join(seedBase, 'index.dat'),
    fs.existsSync(indexSrc) ? fs.readFileSync(indexSrc) : writeUint64LE(1));

  // proof.index.dat — must be exactly 48 bytes (FinalizationStatistics)
  // hashes.dat layout: [NullHash(32) | EntityHash(32) | ...]
  const nemesisEntityHash = hashesBuf.subarray(32, 64);
  fs.writeFileSync(path.join(seedBase, 'proof.index.dat'), buildProofIndexDat(nemesisEntityHash));

  // --- Patch data/00000/ inside each node directory ---
  const dataHeader = Buffer.alloc(800);
  dataHeader.writeBigUInt64LE(BigInt(0), 0);
  dataHeader.writeBigUInt64LE(BigInt(800), 8);

  const nodesDir = path.join(targetDir, 'nodes');
  if (fs.existsSync(nodesDir)) {
    for (const nodeName of fs.readdirSync(nodesDir)) {
      const dataDir = path.join(nodesDir, nodeName, 'data');
      const dataDir00 = path.join(dataDir, '00000');
      fs.mkdirSync(dataDir00, { recursive: true });

      // Wipe stale state
      for (const staleDir of ['statedb', 'supplemental_data', 'state_hash_cache', 'commit_step']) {
        const p = path.join(dataDir, staleDir);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      }
      for (const lockFile of ['server.lock', 'broker.lock', 'recovery.lock']) {
        const p = path.join(dataDir, lockFile);
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }

      // Write block storage files (800-byte header + payload)
      fs.writeFileSync(path.join(dataDir00, '00000.dat'), Buffer.concat([dataHeader, elementBuf]));
      fs.writeFileSync(path.join(dataDir00, '00000.stmt'), Buffer.concat([dataHeader, stmtBuf]));
      fs.writeFileSync(path.join(dataDir00, 'hashes.dat'), hashesBuf);

      // Optional proof
      const proofSrc = path.join(seedSrc, '00001.proof');
      if (fs.existsSync(proofSrc)) {
        fs.writeFileSync(path.join(dataDir00, '00000.proof'),
          Buffer.concat([dataHeader, fs.readFileSync(proofSrc)]));
      }
      const phSrc = path.join(seedSrc, 'proof.heights.dat');
      if (fs.existsSync(phSrc)) {
        fs.writeFileSync(path.join(dataDir00, 'proof.heights.dat'), fs.readFileSync(phSrc));
      }

      // data/index.dat
      fs.writeFileSync(path.join(dataDir, 'index.dat'), writeUint64LE(1));
      // data/proof.index.dat — must be exactly 48 bytes (FinalizationStatistics)
      fs.writeFileSync(path.join(dataDir, 'proof.index.dat'), buildProofIndexDat(nemesisEntityHash));

      // Create spool directories
      for (const sDir of ['block_change', 'block_recover', 'finalization',
        'partial_transactions_change', 'state_change',
        'transaction_status', 'unconfirmed_transactions_change']) {
        fs.mkdirSync(path.join(dataDir, 'spool', sDir), { recursive: true });
      }
      fs.mkdirSync(path.join(dataDir, 'importance', 'wip'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'statedb'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'supplemental_data'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'state_hash_cache'), { recursive: true });

      broadcastLog(`[Nemesis] ✅ Installed imported seed to ${nodeName}/data/00000/\n`);
    }
  }
}

/**
 * Fetch the nemesis block (block 1) from the source node and rebuild the
 * nemesis seed directory so the local node starts with the correct genesis.
 */
async function fetchAndBuildNemesisSeed(targetDir: string, sourceNodeUrl: string): Promise<void> {
  const base = sourceNodeUrl.replace(/\/+$/, '');
  const fj = async (ep: string) => {
    const r = await fetch(`${base}${ep}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}${ep}`);
    return r.json() as any;
  };

  broadcastLog(`[Nemesis] Fetching nemesis block from ${base}...\n`);

  const [blockResp, txResp, txStmtsResp, mosaicResResp] = await Promise.all([
    fj('/blocks/1'),
    fj('/transactions/confirmed?height=1&pageSize=100'),
    fj('/statements/transaction?height=1&pageSize=100'),
    fj('/statements/resolutions/mosaic?height=1&pageSize=100').catch(() => ({ data: [] })),
  ]);

  const blk = blockResp.block;
  const meta = blockResp.meta;
  const txList: any[] = (txResp.data || []).sort((a: any, b: any) => a.meta.index - b.meta.index);
  const txStmts: any[] = txStmtsResp.data || [];
  const mosaicResolutions: any[] = mosaicResResp.data || [];

  broadcastLog(`[Nemesis] Block 1: size=${blk.size}, txs=${txList.length}\n`);

  // --- Serialize block binary ---
  const headerBuf = serializeBlockHeader(blk);      // 424 bytes (ImportanceBlock)
  const txBufs: Buffer[] = [];
  for (let i = 0; i < txList.length; i++) {
    const txBuf = serializeTransaction(txList[i].transaction);
    txBufs.push(i < txList.length - 1 ? padTo8(txBuf) : txBuf);
  }
  const blockBin = Buffer.concat([headerBuf, ...txBufs]);
  if (blockBin.length !== blk.size) {
    throw new Error(`Block size mismatch: expected ${blk.size}, got ${blockBin.length}`);
  }
  broadcastLog(`[Nemesis] Block binary OK: ${blockBin.length} bytes\n`);

  // --- Assemble 00001.dat  (BlockElement format) ---
  //   block binary | entityHash(32) | generationHash(32) | uint32 numTx | (entityHash + merkleHash)*N | uint32 numRoots | roots*M
  const merkleRoots: string[] = meta.stateHashSubCacheMerkleRoots || [];
  const elemParts: Buffer[] = [
    blockBin,
    hexToBuffer(meta.hash),                   // EntityHash   (32 bytes)
    hexToBuffer(meta.generationHash),         // GenerationHash (32 bytes)
    writeUint32LE(txList.length),
  ];
  for (const t of txList) {
    elemParts.push(hexToBuffer(t.meta.hash));
    elemParts.push(hexToBuffer(t.meta.merkleComponentHash));
  }
  elemParts.push(writeUint32LE(merkleRoots.length));
  for (const r of merkleRoots) elemParts.push(hexToBuffer(r));
  const elementBuf = Buffer.concat(elemParts);

  // --- Write seed files ---
  const seedBase = path.join(targetDir, 'nemesis', 'seed');
  const seedDir  = path.join(seedBase, '00000');
  fs.mkdirSync(seedDir, { recursive: true });

  // 00001.dat
  fs.writeFileSync(path.join(seedDir, '00001.dat'), elementBuf);

  // hashes.dat  (entityHash 32 + generationHash 32 = 64)
  fs.writeFileSync(path.join(seedDir, 'hashes.dat'),
    Buffer.concat([hexToBuffer(meta.hash), hexToBuffer(meta.generationHash)]));

  // index.dat  (uint64 height = 1)
  fs.writeFileSync(path.join(seedBase, 'index.dat'), writeUint64LE(1));

  // proof.index.dat — must be exactly 48 bytes (FinalizationStatistics)
  fs.writeFileSync(path.join(seedBase, 'proof.index.dat'), buildProofIndexDat(meta.hash));

  // proof.heights.dat  (epoch4 + point4 + height8 + hash32 = 48)
  fs.writeFileSync(path.join(seedDir, 'proof.heights.dat'),
    Buffer.concat([writeUint32LE(1), writeUint32LE(1), writeUint64LE(1), hexToBuffer(meta.hash)]));

  // 00001.proof  (version4 + epoch4 + point4 + height8 + hash32 + voteCount4 = 56)
  fs.writeFileSync(path.join(seedDir, '00001.proof'),
    Buffer.concat([writeUint32LE(1), writeUint32LE(1), writeUint32LE(1),
                   writeUint64LE(1), hexToBuffer(meta.hash), writeUint32LE(0)]));

  // 00001.stmt  (empty statement: 3 × uint32(0) = 12 bytes)
  fs.writeFileSync(path.join(seedDir, '00001.stmt'),
    Buffer.concat([writeUint32LE(0), writeUint32LE(0), writeUint32LE(0)]));

  broadcastLog(`[Nemesis] ✅ Seed rebuilt: 00001.dat=${elementBuf.length}B, hashes.dat=64B\n`);

  // --- Also patch data/00000/ inside each node directory ---
  //   The block storage format: 800-byte offset header + block element data
  //   symbol-bootstrap 'config' already populated data/ from the (old) seed,
  //   so we must overwrite data/00000/00000.dat with our new block element.
  const dataHeader = Buffer.alloc(800);
  dataHeader.writeBigUInt64LE(BigInt(0), 0);     // slot 0 unused
  dataHeader.writeBigUInt64LE(BigInt(800), 8);   // offset of block-1 data

  const datBlock = Buffer.concat([dataHeader, elementBuf]);
  const datHashes = Buffer.concat([hexToBuffer(meta.hash), hexToBuffer(meta.generationHash)]);

  const nodesDataDir = path.join(targetDir, 'nodes');
  broadcastLog(`[Nemesis] Checking nodesDataDir: ${nodesDataDir} exists=${fs.existsSync(nodesDataDir)}\n`);
  if (fs.existsSync(nodesDataDir)) {
    for (const nodeName of fs.readdirSync(nodesDataDir)) {
      const nodeDir = path.join(nodesDataDir, nodeName);
      const dataDir = path.join(nodeDir, 'data');
      const dataDir00 = path.join(dataDir, '00000');
      broadcastLog(`[Nemesis] Checking ${dataDir00} exists=${fs.existsSync(dataDir00)}\n`);

      // Create the full data directory structure if missing
      fs.mkdirSync(dataDir00, { recursive: true });

      const datPath = path.join(dataDir00, '00000.dat');
      const hashPath = path.join(dataDir00, 'hashes.dat');

      // ── Wipe stale state that was seeded from the base-preset nemesis ──
      // symbol-bootstrap config (without --upgrade) populated data/ with
      // public-testnet nemesis state.  We are about to overwrite 00000.dat
      // with the custom-network nemesis, so any RocksDB / supplemental state
      // generated from the old nemesis must be removed.  catapult.recovery
      // will recreate them on first boot from the correct nemesis block.
      for (const staleDir of ['statedb', 'supplemental_data', 'state_hash_cache', 'commit_step']) {
        const p = path.join(dataDir, staleDir);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      }
      // Also remove any lock files that may linger
      for (const lockFile of ['server.lock', 'broker.lock', 'recovery.lock']) {
        const p = path.join(dataDir, lockFile);
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }

      fs.writeFileSync(datPath, datBlock);
      fs.writeFileSync(hashPath, datHashes);

      // 00000.stmt – block storage format: 800-byte header + statement payload
      // The statement for the nemesis block contains receipt data.  We build a
      // minimal valid statement from the REST /statements API.
      const stmtPayload = serializeNemesisStatements(txStmts, mosaicResolutions);
      const stmtBuf = Buffer.concat([dataHeader, stmtPayload]);
      fs.writeFileSync(path.join(dataDir00, '00000.stmt'), stmtBuf);

      // 00000.proof – block storage format proof
      // Minimal proof entry: version(4) + round(epoch4+point4) + height(8) + hash(32) = 52
      const proofPayload = Buffer.concat([
        writeUint32LE(52),            // entry size
        writeUint32LE(1),             // finalization epoch
        writeUint32LE(1),             // finalization point
        writeUint64LE(1),             // height
        hexToBuffer(meta.hash),       // block hash
      ]);
      fs.writeFileSync(path.join(dataDir00, '00000.proof'), Buffer.concat([dataHeader, proofPayload]));

      // proof.heights.dat (no 800-byte header in this file)
      fs.writeFileSync(path.join(dataDir00, 'proof.heights.dat'),
        Buffer.concat([writeUint32LE(1), writeUint32LE(1), writeUint64LE(1), hexToBuffer(meta.hash)]));

      // data/index.dat  (uint64 = 1 = current chain height)
      fs.writeFileSync(path.join(dataDir, 'index.dat'), writeUint64LE(1));
      // data/proof.index.dat — must be exactly 48 bytes (FinalizationStatistics)
      fs.writeFileSync(path.join(dataDir, 'proof.index.dat'), buildProofIndexDat(meta.hash));

      // Create spool directories (needed by broker)
      for (const sDir of ['block_change', 'block_recover', 'finalization',
        'partial_transactions_change', 'state_change',
        'transaction_status', 'unconfirmed_transactions_change']) {
        fs.mkdirSync(path.join(dataDir, 'spool', sDir), { recursive: true });
      }

      // Create importance directory
      fs.mkdirSync(path.join(dataDir, 'importance', 'wip'), { recursive: true });

      // Create statedb directory (RocksDB – catapult.recovery populates it from nemesis)
      fs.mkdirSync(path.join(dataDir, 'statedb'), { recursive: true });

      // Create supplemental_data directory
      fs.mkdirSync(path.join(dataDir, 'supplemental_data'), { recursive: true });

      // Create state_hash_cache directory
      fs.mkdirSync(path.join(dataDir, 'state_hash_cache'), { recursive: true });

      broadcastLog(`[Nemesis] ✅ Patched ${nodeName}/data/00000/ (dat=${datBlock.length}B, stmt=${stmtBuf.length}B)\n`);
    }
  }
}

// =============================================================================
// Command execution engine
// =============================================================================

function runBootstrapCommand(
  command: string,
  args: string[],
  options?: { stateWhileRunning?: NetworkStatus['state']; stateOnSuccess?: NetworkStatus['state'] }
) {
  return new Promise<number>((resolve, reject) => {
    const fullCmd = `symbol-bootstrap ${command} ${args.join(' ')}`;
    broadcastLog(`\n[CMD] > ${fullCmd}\n`);
    broadcastLog(`[CMD] (target: ${TARGET_DIR})\n`);

    networkStatus.lastCommand = fullCmd;
    networkStatus.lastCommandTime = new Date().toISOString();
    networkStatus.state = options?.stateWhileRunning ?? 'starting';
    broadcastStatus();

    // Always inject --target so every sub-command (config / compose / run / stop)
    // uses the DinD-safe path.  Also rewrite relative -c paths to absolute.
    const resolvedArgs = [...args];
    if (!resolvedArgs.includes('-t') && !resolvedArgs.includes('--target')) {
      resolvedArgs.push('-t', TARGET_DIR);
    }
    // Convert relative custom-preset path to absolute so it works from any CWD
    const cIdx = resolvedArgs.indexOf('-c');
    if (cIdx !== -1 && cIdx + 1 < resolvedArgs.length) {
      const cVal = resolvedArgs[cIdx + 1];
      if (!path.isAbsolute(cVal)) {
        resolvedArgs[cIdx + 1] = path.join(SHARED_DIR, cVal);
      }
    }

    // CWD must be '/' because symbol-bootstrap internally does
    //   path.join(process.cwd(), target)  — in ComposeService
    // but also uses `target` directly     — in RunService.
    // If CWD were '/app/shared', join('/app/shared', '/opt/symbol-target')
    // becomes '/app/shared/opt/symbol-target' (wrong).
    // With CWD='/', join('/', '/opt/symbol-target') = '/opt/symbol-target' (correct).
    const cp = spawn('npx', ['-y', 'symbol-bootstrap', command, ...resolvedArgs], {
      cwd: '/',
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: true,
    });

    activeProcess = cp;
    networkStatus.pid = cp.pid ?? null;

    cp.stdout?.on('data', (data: Buffer) => {
      broadcastLog(data.toString());
    });

    cp.stderr?.on('data', (data: Buffer) => {
      broadcastLog(data.toString());
    });

    cp.on('close', (code) => {
      activeProcess = null;
      networkStatus.pid = null;

      if (code === 0) {
        networkStatus.state = options?.stateOnSuccess ?? 'running';
        broadcastLog(`[CMD] Process exited successfully (code 0)\n`);
      } else {
        networkStatus.state = 'error';
        broadcastLog(`[CMD] Process exited with code ${code}\n`);
      }
      broadcastStatus();

      if (code === 0) resolve(code);
      else reject(new Error(`Command failed with code ${code}`));
    });

    cp.on('error', (err) => {
      activeProcess = null;
      networkStatus.pid = null;
      networkStatus.state = 'error';
      broadcastLog(`[CMD] Error: ${err.message}\n`);
      broadcastStatus();
      reject(err);
    });
  });
}

// =============================================================================
// Seed file import endpoints
// =============================================================================

/** Get seed import status */
app.get('/api/seed/status', (_req, res) => {
  const seedDir00 = path.join(SEED_DIR, '00000');
  const files: Record<string, number> = {};
  const required = ['00001.dat', '00001.stmt', 'hashes.dat'];
  const optional = ['00001.proof', 'proof.heights.dat'];

  let allRequired = true;
  for (const f of [...required, ...optional]) {
    const fp = path.join(seedDir00, f);
    if (fs.existsSync(fp)) {
      files[f] = fs.statSync(fp).size;
    } else if (required.includes(f)) {
      allRequired = false;
    }
  }

  // Check root-level index files too
  for (const f of ['index.dat', 'proof.index.dat']) {
    const fp = path.join(SEED_DIR, f);
    if (fs.existsSync(fp)) files[f] = fs.statSync(fp).size;
  }

  res.json({
    imported: allRequired && Object.keys(files).length >= required.length,
    ready: allRequired,
    files,
    requiredFiles: required,
    optionalFiles: optional,
  });
});

/** Upload seed files (JSON body with base64-encoded file contents) */
app.post('/api/seed/upload', (req, res) => {
  try {
    const { files } = req.body as { files: { name: string; data: string }[] };
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    const seedDir00 = path.join(SEED_DIR, '00000');
    fs.mkdirSync(seedDir00, { recursive: true });

    const written: string[] = [];
    for (const f of files) {
      if (!f.name || !f.data) continue;

      // Security: only allow known seed file names
      const allowed = ['00001.dat', '00001.stmt', 'hashes.dat',
                       '00001.proof', 'proof.heights.dat',
                       'index.dat', 'proof.index.dat',
                       // Also accept data-format files (with 800-byte header)
                       '00000.dat', '00000.stmt', '00000.proof'];
      if (!allowed.includes(f.name)) {
        return res.status(400).json({ error: `Disallowed file name: ${f.name}` });
      }

      let buf = Buffer.from(f.data, 'base64');

      // If user provided data-format files (00000.*), strip the 800-byte offset header
      // and rename to seed-format (00001.*)
      const dataFormatMap: Record<string, string> = {
        '00000.dat': '00001.dat',
        '00000.stmt': '00001.stmt',
        '00000.proof': '00001.proof',
      };
      let destName = f.name;
      if (dataFormatMap[f.name]) {
        if (buf.length > 800) {
          buf = buf.subarray(800);   // strip offset header
          broadcastLog(`[Seed] Converted data-format ${f.name} → seed-format (stripped 800B header, payload=${buf.length}B)\n`);
        }
        destName = dataFormatMap[f.name];
      }

      // Root-level files go to SEED_DIR, sub-files to SEED_DIR/00000/
      const destDir = ['index.dat', 'proof.index.dat'].includes(destName) ? SEED_DIR : seedDir00;
      fs.writeFileSync(path.join(destDir, destName), buf);
      written.push(`${destName} (${buf.length}B)`);
    }

    res.json({ success: true, written });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Clear imported seed files */
app.delete('/api/seed', (_req, res) => {
  try {
    if (fs.existsSync(SEED_DIR)) {
      fs.rmSync(SEED_DIR, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Command endpoints
// =============================================================================

app.post('/api/commands/start', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Network encryption password is required.' });
    }

    // Save current config first
    broadcastLog('[System] Saving preset before start...\n');

    // Read preset and assembly from .ui-meta.json (or fall back to YAML)
    let basePreset = 'bootstrap';
    let assembly = 'dual';
    try {
      if (fs.existsSync(UI_META_PATH)) {
        const meta = JSON.parse(fs.readFileSync(UI_META_PATH, 'utf-8'));
        if (meta.preset) basePreset = String(meta.preset);
        if (meta.assembly) assembly = String(meta.assembly);
      } else {
        // Fallback: read from YAML (legacy flat format)
        const presetPath = path.join(SHARED_DIR, 'custom-preset.yml');
        const content = fs.readFileSync(presetPath, 'utf-8');
        const data = yaml.load(content) as Record<string, unknown>;
        if (data._preset) basePreset = String(data._preset);
        else if (data.preset) basePreset = String(data.preset);
        if (data._assembly) assembly = String(data._assembly);
        else if (data.assembly) assembly = String(data.assembly);
      }
    } catch {
      broadcastLog('[Warn] Could not read preset/assembly, using defaults\n');
    }

    broadcastLog(`[System] Base preset: ${basePreset}, Assembly: ${assembly}\n`);

    // ---------------------------------------------------------------
    // We split "start" into  config → patch → compose → run
    // because symbol-bootstrap 1.1.10 does NOT generate all properties
    // that catapult v1.0.3.9 expects in [cache_database] of config-node.properties.
    // (Missing: maxLogFiles, maxLogFileSize)
    //
    // "start" internally does config → compose → run, but we need to
    // inject a patch step between config and compose.
    // ---------------------------------------------------------------
    const startSequence = async () => {
      // Step 0: Resolve catapult version
      const version = resolveVersion();
      broadcastLog(`[System] Catapult version: ${version.id} (${version.serverImage})\n`);

      // Step 0b: Build patched image BEFORE config
      //   symbol-bootstrap config internally runs `docker run <serverImage>`
      //   to generate node certificates.  The V3 image (gcc-1.0.3.9) is
      //   missing /usr/catapult/deps/openssl.cnf, so we must build the
      //   patched image and update the preset YAML *before* config runs.
      broadcastLog('[System] Step 0/6 – Ensuring patched server image...\n');
      const patchedTag = await ensurePatchedImage(version);

      // Step 1: symbol-bootstrap config  (--upgrade to force regeneration)
      //   Reads custom-preset.yml which now has the patched image name.
      //   Note: --upgrade preserves existing data but skips nemesis seed generation
      //   when data/ doesn't exist.  Only use --upgrade when data/ already exists.
      const dataExists = fs.existsSync(path.join(TARGET_DIR, 'nodes', 'api-node-0', 'data', '00000'));
      broadcastLog(`[System] Step 1/6 – Generating configuration... (upgrade=${dataExists})\n`);
      const configArgs = [
        '-p', basePreset,
        '-a', assembly,
        '-c', 'custom-preset.yml',
        '--password', password,
      ];
      if (dataExists) configArgs.push('--upgrade');
      await runBootstrapCommand('config', configArgs, {
        stateWhileRunning: 'starting',
        stateOnSuccess: 'starting',
      });

      // Step 2: Rewrite generated preset + configs with patched image
      //   Must happen AFTER config so the generated preset.yml exists,
      //   and BEFORE compose so docker-compose.yml gets the patched tag.
      broadcastLog('[System] Step 2/6 – Rewriting generated configs with patched image...\n');
      // Also rewrite the generated preset.yml inside the target so that
      // compose picks up the patched image name.
      if (patchedTag) {
        rewriteGeneratedPresetImages(TARGET_DIR, version, patchedTag);
      }

      // Step 3: Patch generated properties files (version-dependent)
      broadcastLog(`[System] Step 3/6 – Patching generated config files (${version.configPatches.length} patch sets)...\n`);
      patchGeneratedConfigs(TARGET_DIR, version);

      // Step 4: symbol-bootstrap compose (generates docker-compose.yml)
      broadcastLog('[System] Step 4/6 – Generating docker-compose.yml...\n');
      await runBootstrapCommand('compose', [
        '--password', password,
      ], {
        stateWhileRunning: 'starting',
        stateOnSuccess: 'starting',
      });

      // Step 4b: ALWAYS force-patch docker-compose.yml images to match custom-preset.yml
      broadcastLog('[System] Step 4b – Patching docker-compose.yml images...\n');
      forceCorrectDockerComposeImages(TARGET_DIR);

      // Step 4c: Overwrite peer files if joining an existing network
      //   Must happen AFTER compose because compose regenerates peers-*.json.
      let sourceUrl: string | undefined;
      try {
        const meta = fs.existsSync(UI_META_PATH)
          ? JSON.parse(fs.readFileSync(UI_META_PATH, 'utf-8'))
          : {};
        sourceUrl = meta.sourceNodeUrl;
        if (sourceUrl) {
          broadcastLog('[System] Step 4c – Fetching peers from source node...\n');
          await fetchAndWritePeerFiles(TARGET_DIR, sourceUrl);
        }
      } catch (e: any) {
        broadcastLog(`[Peers] ⚠️  Peer fetch failed (non-fatal): ${e.message}\n`);
      }

      // Step 4c2: Patch config-node.properties so that the Docker subnet is
      //           listed in trustedHosts / localNetworks (REST gateway access).
      broadcastLog('[System] Step 4c2 – Patching localNetworks & generating REST cert...\n');
      patchLocalNetworks(TARGET_DIR);
      generateRestGatewayCert(TARGET_DIR);

      // Step 4d: Install nemesis seed data
      //   Priority: 1) Imported seed files from network admin (shared/seed/)
      //             2) REST API reconstruction (fallback, may not work for all networks)
      if (sourceUrl) {
        const importedSeedDir = path.join(SEED_DIR, '00000');
        const hasImportedSeed = fs.existsSync(path.join(importedSeedDir, '00001.dat'));
        if (hasImportedSeed) {
          try {
            broadcastLog('[System] Step 4d – Installing imported nemesis seed...\n');
            await installImportedSeed(TARGET_DIR);
          } catch (e: any) {
            broadcastLog(`[Nemesis] ⚠️  Seed install failed: ${e.message}\n`);
            broadcastLog(`[Nemesis] ⚠️  Stack: ${e.stack}\n`);
          }
        } else {
          try {
            broadcastLog('[System] Step 4d – No imported seed found; attempting REST API reconstruction...\n');
            await fetchAndBuildNemesisSeed(TARGET_DIR, sourceUrl);
          } catch (e: any) {
            broadcastLog(`[Nemesis] ⚠️  Nemesis rebuild failed: ${e.message}\n`);
            broadcastLog(`[Nemesis] ⚠️  Stack: ${e.stack}\n`);
          }
        }
      }

      // Step 5: symbol-bootstrap run (docker-compose up -d)
      broadcastLog('[System] Step 5/6 – Starting docker containers...\n');
      await runBootstrapCommand('run', [
        '-d',
      ], {
        stateWhileRunning: 'starting',
        stateOnSuccess: 'running',
      });

      // Step 6: Wait for node health
      //   symbol-manager and rest-gateway are on different Docker networks.
      //   Join the docker_default network so we can reach rest-gateway at
      //   its container name (or IP).  Then use the REST gateway's container
      //   IP for health checks.
      broadcastLog('\n[System] Containers started. Waiting for node health...\n');

      // Join the docker_default network so health check can reach REST gateway
      try {
        const { execSync } = await import('child_process');
        execSync('docker network connect docker_default symbol-manager 2>/dev/null || true');
        NODE_REST_HOST = 'rest-gateway';
        broadcastLog('[System] Joined docker_default network — REST host set to rest-gateway.\n');
      } catch { /* already connected or network unavailable */ }

      broadcastLog(`[System] Polling http://${NODE_REST_HOST}:${NODE_REST_PORT}/node/health ...\n`);
      await waitForNodeHealth(90);    // up to 90 seconds
    };

    // Fire-and-forget
    startSequence().catch((err) => {
      broadcastLog(`[Error] Start failed: ${err.message}\n`);
    });

    res.json({ success: true, message: 'Start command initiated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/commands/stop', async (_req, res) => {
  try {
    runBootstrapCommand('stop', [], {
      stateWhileRunning: 'stopping',
      stateOnSuccess: 'stopped',
    }).catch((err) => {
      broadcastLog(`[Error] Stop failed: ${err.message}\n`);
    });
    res.json({ success: true, message: 'Stop command initiated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/commands/healthCheck', async (_req, res) => {
  try {
    runBootstrapCommand('healthCheck', []).catch((err) => {
      broadcastLog(`[Error] HealthCheck failed: ${err.message}\n`);
    });
    res.json({ success: true, message: 'HealthCheck command initiated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/commands/resetData', async (_req, res) => {
  try {
    runBootstrapCommand('resetData', [], {
      stateWhileRunning: 'stopping',
      stateOnSuccess: 'stopped',
    }).catch((err) => {
      broadcastLog(`[Error] ResetData failed: ${err.message}\n`);
    });
    res.json({ success: true, message: 'ResetData command initiated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full reset — stop everything, delete target dir, seeds, ui-meta
app.post('/api/commands/fullReset', async (_req, res) => {
  try {
    broadcastLog('\n[System] ========== FULL RESET ==========\n');
    networkStatus.state = 'stopping';
    broadcastStatus();

    const { execSync } = await import('child_process');

    // 1. Stop V2 containers (docker compose down) if they exist
    const composePath = path.join(TARGET_DIR, 'docker', 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      broadcastLog('[Reset] Stopping V2 containers...\n');
      try {
        execSync(`docker compose -f "${composePath}" down --remove-orphans`, {
          timeout: 60_000,
          stdio: 'pipe',
        });
        broadcastLog('[Reset] ✅ V2 containers stopped\n');
      } catch (e: any) {
        broadcastLog(`[Reset] ⚠️  docker compose down: ${e.message}\n`);
      }
    }

    // 2. symbol-bootstrap stop (for V1 / any leftover)
    try {
      execSync(`npx -y symbol-bootstrap stop -t "${TARGET_DIR}"`, {
        cwd: '/',
        timeout: 60_000,
        stdio: 'pipe',
      });
      broadcastLog('[Reset] ✅ symbol-bootstrap stop completed\n');
    } catch {
      // May fail if nothing is running — that's fine
    }

    // 3. Kill any leftover Docker containers that may hold mounts on target dir
    try {
      const containers = execSync(
        `docker ps -a --filter "label=com.docker.compose.project=docker" -q`,
        { timeout: 15_000, stdio: 'pipe' }
      ).toString().trim();
      if (containers) {
        broadcastLog('[Reset] Force-removing leftover containers...\n');
        execSync(`docker rm -f ${containers.split('\n').join(' ')}`, {
          timeout: 30_000,
          stdio: 'pipe',
        });
        broadcastLog('[Reset] ✅ Leftover containers removed\n');
      }
    } catch { /* ignore */ }

    // 3b. Remove docker network created by compose
    try {
      execSync('docker network rm docker_default 2>/dev/null || true', {
        timeout: 15_000,
        stdio: 'pipe',
      });
    } catch { /* ignore */ }

    // 3c. Unmount any overlay/volume mounts on TARGET_DIR
    try {
      execSync(`umount "${TARGET_DIR}" 2>/dev/null || true`, {
        timeout: 10_000,
        stdio: 'pipe',
      });
    } catch { /* ignore */ }

    // 3d. Wait a moment for mounts to release
    await new Promise(r => setTimeout(r, 2000));

    // 3e. Remove target directory — retry with shell rm -rf on EBUSY
    if (fs.existsSync(TARGET_DIR)) {
      broadcastLog(`[Reset] Removing ${TARGET_DIR}...\n`);
      try {
        fs.rmSync(TARGET_DIR, { recursive: true, force: true });
      } catch (rmErr: any) {
        if (rmErr.code === 'EBUSY') {
          broadcastLog('[Reset] ⚠️  EBUSY — retrying with shell rm -rf...\n');
          // Find and unmount any sub-mounts
          try {
            execSync(`grep "${TARGET_DIR}" /proc/mounts | awk '{print $2}' | sort -r | xargs -r umount 2>/dev/null || true`, {
              timeout: 10_000, stdio: 'pipe',
            });
          } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, 1000));
          try {
            execSync(`rm -rf "${TARGET_DIR}"`, { timeout: 30_000, stdio: 'pipe' });
          } catch (rm2: any) {
            // Last resort: empty the directory contents even if dir itself can't be removed
            broadcastLog('[Reset] ⚠️  Cannot remove mount point — cleaning contents...\n');
            execSync(`find "${TARGET_DIR}" -mindepth 1 -delete 2>/dev/null || true`, {
              timeout: 30_000, stdio: 'pipe',
            });
          }
        } else {
          throw rmErr;
        }
      }
      broadcastLog('[Reset] ✅ Target directory cleaned\n');
    }

    // 4. Remove imported seed files
    if (fs.existsSync(SEED_DIR)) {
      broadcastLog('[Reset] Removing imported seed files...\n');
      fs.rmSync(SEED_DIR, { recursive: true, force: true });
      broadcastLog('[Reset] ✅ Seed files removed\n');
    }

    // 5. Remove ui-meta (catapult version selection, sourceNodeUrl, etc.)
    if (fs.existsSync(UI_META_PATH)) {
      fs.unlinkSync(UI_META_PATH);
      broadcastLog('[Reset] ✅ UI metadata removed\n');
    }

    // 6. Remove custom-preset.yml
    if (fs.existsSync(PRESET_PATH)) {
      fs.unlinkSync(PRESET_PATH);
      broadcastLog('[Reset] ✅ custom-preset.yml removed\n');
    }

    // 7. Disconnect from docker network if connected
    try {
      execSync('docker network disconnect docker_default symbol-manager 2>/dev/null || true', { stdio: 'pipe' });
    } catch { /* ignore */ }

    // Reset internal state
    networkStatus.state = 'stopped';
    networkStatus.lastCommand = 'fullReset';
    networkStatus.lastCommandTime = new Date().toISOString();
    networkStatus.pid = null;
    broadcastStatus();

    broadcastLog('[System] ✅ Full reset complete — ready for fresh setup\n');
    broadcastLog('[System] ====================================\n\n');

    res.json({ success: true, message: 'Full reset complete.' });
  } catch (err: any) {
    broadcastLog(`[Error] Full reset failed: ${err.message}\n`);
    networkStatus.state = 'error';
    broadcastStatus();
    res.status(500).json({ error: err.message });
  }
});

// Kill active process (emergency stop)
app.post('/api/commands/kill', async (_req, res) => {
  try {
    if (activeProcess && !activeProcess.killed) {
      activeProcess.kill('SIGKILL');
      broadcastLog('[System] Active process killed.\n');
      networkStatus.state = 'stopped';
      broadcastStatus();
      res.json({ success: true, message: 'Process killed.' });
    } else {
      res.json({ success: false, message: 'No active process to kill.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Join Network — fetch network properties from a remote node
// =============================================================================

app.post('/api/network/fetch', async (req, res) => {
  const { nodeUrl } = req.body as { nodeUrl: string };
  if (!nodeUrl) {
    return res.status(400).json({ error: 'nodeUrl is required.' });
  }

  // Normalise: strip trailing slash
  const base = nodeUrl.replace(/\/+$/, '');

  const fetchJson = async (urlPath: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(`${base}${urlPath}`, { signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${urlPath}`);
      return r.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    broadcastLog(`[JoinNetwork] Fetching from ${base} ...\n`);

    // Parallel fetch: network/properties, node/info, node/peers
    const [networkProps, nodeInfo, peers] = await Promise.all([
      fetchJson('/network/properties'),
      fetchJson('/node/info'),
      fetchJson('/node/peers').catch(() => []),
    ]);

    broadcastLog(`[JoinNetwork] network/properties ✓\n`);
    broadcastLog(`[JoinNetwork] node/info ✓  (network: ${nodeInfo.networkIdentifier})\n`);
    broadcastLog(`[JoinNetwork] node/peers ✓  (${Array.isArray(peers) ? peers.length : 0} peers)\n`);

    res.json({
      success: true,
      networkProperties: networkProps,
      nodeInfo,
      peers: Array.isArray(peers) ? peers : [],
    });
  } catch (err: any) {
    broadcastLog(`[JoinNetwork] Error: ${err.message}\n`);
    res.status(502).json({
      error: `Failed to fetch from node: ${err.message}`,
    });
  }
});

// =============================================================================
// Static file serving (production build)
// =============================================================================

const FRONTEND_DIST = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// =============================================================================
// Start server
// =============================================================================

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n  🚀  Symbol Network Manager API running on port ${PORT}`);
  console.log(`  📁  Shared directory: ${SHARED_DIR}`);
  console.log(`  🔌  WebSocket ready for real-time logs\n`);

  // ── Auto-detect running Symbol node on startup ───────────────────────
  detectRunningNode();
});

/**
 * Check whether Symbol node containers are already running (e.g. after a
 * manager container restart).  If they are, re-join the docker_default
 * network and update internal state so the UI shows the correct status.
 */
async function detectRunningNode() {
  try {
    const { execSync } = await import('child_process');

    // Look for a running container whose name matches the typical
    // symbol-bootstrap naming convention (e.g. "docker-api-node-1",
    // "docker-peer-node-0-1", etc.)
    const psOutput = execSync(
      'docker ps --format "{{.Names}}" 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    if (!psOutput) return;

    const containers = psOutput.split('\n').map((s) => s.trim()).filter(Boolean);
    const nodeRunning = containers.some(
      (name) => /api-node|peer-node|rest-gateway/.test(name)
    );

    if (!nodeRunning) {
      console.log('  ℹ️  No Symbol node containers detected.');
      return;
    }

    console.log(`  🔍  Detected running Symbol containers: ${containers.filter((n) => /api-node|peer-node|rest-gateway|db/.test(n)).join(', ')}`);

    // Re-join docker_default network so we can reach rest-gateway by name
    try {
      execSync('docker network connect docker_default symbol-manager 2>/dev/null || true');
      NODE_REST_HOST = 'rest-gateway';
      console.log('  🔗  Re-joined docker_default network — REST host set to rest-gateway');
    } catch { /* already connected or unavailable */ }

    // Update internal state
    networkStatus.state = 'running';
    networkStatus.lastCommand = '(auto-detected on startup)';
    networkStatus.lastCommandTime = new Date().toISOString();
    broadcast('STATUS', networkStatus);

    // Immediately poll health so the UI indicator updates right away
    await pollNodeHealth();
    broadcast('NODE_HEALTH', nodeHealth);

    broadcastLog('[System] ♻️  既存のSymbolノードコンテナを検出しました — 状態を「稼働中」に復元しました\n');
  } catch (err: any) {
    console.log(`  ⚠️  Auto-detect skipped: ${err.message}`);
  }
}
