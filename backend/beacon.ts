/**
 * Beacon producer.
 *
 * BNL's job here is narrow: gather what a running node actually reports, prove
 * the transport key it is about to sign with really belongs to that node, and
 * hand the result to @nftdrive/beacon-sdk. Every piece of Beacon Protocol -
 * canonical serialization, SHA3-256, the signature, the file format and the
 * validation - lives in the SDK and is never reimplemented here.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import yaml from 'js-yaml';
import { decryptPrivateKey } from './addresses-crypto.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Errors
// =============================================================================

/** Internal codes, kept separate from the user-facing message. */
export const BeaconProducerErrorCode = {
  NODE_NOT_RUNNING: 'NODE_NOT_RUNNING',
  REST_UNREACHABLE: 'REST_UNREACHABLE',
  GENERATION_HASH_MISMATCH: 'GENERATION_HASH_MISMATCH',
  MAIN_KEY_MISMATCH: 'MAIN_KEY_MISMATCH',
  TRANSPORT_KEY_UNAVAILABLE: 'TRANSPORT_KEY_UNAVAILABLE',
  TRANSPORT_KEY_MISMATCH: 'TRANSPORT_KEY_MISMATCH',
  P2P_HOST_UNAVAILABLE: 'P2P_HOST_UNAVAILABLE',
  P2P_PORT_UNAVAILABLE: 'P2P_PORT_UNAVAILABLE',
  API_HOST_UNAVAILABLE: 'API_HOST_UNAVAILABLE',
  API_PORT_UNAVAILABLE: 'API_PORT_UNAVAILABLE',
  API_SCHEME_UNKNOWN: 'API_SCHEME_UNKNOWN',
  BLOCK_FETCH_FAILED: 'BLOCK_FETCH_FAILED',
  BLOCK_HEIGHT_MISMATCH: 'BLOCK_HEIGHT_MISMATCH',
  BEACON_VALIDATION_FAILED: 'BEACON_VALIDATION_FAILED',
  FILE_WRITE_FAILED: 'FILE_WRITE_FAILED',
} as const;
export type BeaconProducerErrorCode =
  (typeof BeaconProducerErrorCode)[keyof typeof BeaconProducerErrorCode];

export class BeaconProducerError extends Error {
  readonly code: BeaconProducerErrorCode;
  readonly detail?: string;
  constructor(code: BeaconProducerErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'BeaconProducerError';
    this.code = code;
    this.detail = detail;
    Object.setPrototypeOf(this, BeaconProducerError.prototype);
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

// =============================================================================
// SDK loader
// =============================================================================

/**
 * The single place the ESM-only SDK is pulled into this CommonJS backend.
 *
 * Static require() cannot load it, and duplicating the dynamic import would
 * make it easy for one call site to drift onto a different version.
 */
export async function loadBeaconSdk(): Promise<typeof import('@nftdrive/beacon-sdk')> {
  return import('@nftdrive/beacon-sdk');
}

// =============================================================================
// Types
// =============================================================================

export interface BeaconEndpoints {
  p2pHost: string;
  p2pPort: number;
  apiHost: string;
  apiPort: number;
  apiScheme: 'http' | 'https';
}

export interface BeaconEndpointSources {
  /** Where each value came from, shown in the UI so an operator can sanity-check it. */
  p2pHost: string;
  p2pPort: string;
  apiHost: string;
  apiPort: string;
  apiScheme: string;
}

export interface BeaconNodeInfo {
  nodeName: string;
  networkName: string;
  generationHash: string;
  transportPublicKey: string;
  mainPublicKey: string;
  friendlyName: string;
}

export interface BeaconBlockState {
  height: string;
  blockHash: string;
  blockTimestamp: string;
}

export interface BeaconPreview {
  node: BeaconNodeInfo;
  endpoints: BeaconEndpoints;
  endpointSources: BeaconEndpointSources;
  block: BeaconBlockState;
  /** Non-fatal advisories, e.g. a private/local endpoint. */
  warnings: string[];
}

// =============================================================================
// Small helpers
// =============================================================================

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** RFC1918 / loopback / link-local check used only to raise a warning. */
export function isPrivateOrLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function normalizeHexKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

// =============================================================================
// Collection
// =============================================================================

export interface BeaconSourcePaths {
  targetDir: string;
  presetPath: string;
  uiMetaPath: string;
}

function readYaml(file: string): any {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

/** The node entry in addresses.yml, which holds both public keys. */
function readAddressesNode(targetDir: string, nodeName?: string): any {
  const file = path.join(targetDir, 'addresses.yml');
  if (!fs.existsSync(file)) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      'addresses.yml が見つかりません。ノードを一度起動してください。',
      file,
    );
  }
  const doc = readYaml(file);
  const nodes: any[] = Array.isArray(doc?.nodes) ? doc.nodes : [];
  const node = nodeName ? nodes.find((n) => String(n?.name) === nodeName) : nodes[0];
  if (!node) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      `addresses.yml にノード "${nodeName ?? '(first)'}" がありません。`,
    );
  }
  return node;
}

/**
 * Resolve the published host port for a container port.
 *
 * `docker port` reports what is actually reachable from outside, which is the
 * only thing a verifier can use. With `17900:7900` this returns 17900, not the
 * 7900 the node listens on internally.
 */
async function resolvePublishedPort(
  container: string,
  containerPort: number,
): Promise<{ port: number; source: string } | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['port', container, String(containerPort)], {
      timeout: 8000,
    });
    // e.g. "0.0.0.0:17900\n[::]:17900"
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/:(\d+)$/);
      if (m) {
        return { port: Number(m[1]), source: `docker port ${container} ${containerPort}` };
      }
    }
  } catch { /* container not running, or port not published */ }
  return null;
}

/** Fallback: the ports: mapping in the generated docker-compose.yml. */
function resolveComposePort(
  targetDir: string,
  service: string,
  containerPort: number,
): { port: number; source: string } | null {
  const file = path.join(targetDir, 'docker', 'docker-compose.yml');
  if (!fs.existsSync(file)) return null;
  try {
    const doc = readYaml(file);
    const ports: unknown[] = doc?.services?.[service]?.ports ?? [];
    for (const entry of ports) {
      const m = String(entry).match(/^(?:[\d.]+:)?(\d+):(\d+)$/);
      if (m && Number(m[2]) === containerPort) {
        return { port: Number(m[1]), source: `docker-compose.yml ${service}.ports` };
      }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Collect everything a Beacon needs, and verify it against the running node.
 *
 * Every cross-check that the spec calls for happens here rather than at signing
 * time, so a mismatch is reported before any key material is touched.
 */
export async function collectBeaconPreview(
  paths: BeaconSourcePaths,
  options: {
    nodeName?: string;
    restUrl: string;
    /** Container names, used to look up the published ports. */
    p2pContainer?: string;
    apiContainer?: string;
    overrides?: Partial<BeaconEndpoints>;
  },
): Promise<BeaconPreview> {
  const { targetDir, presetPath, uiMetaPath } = paths;
  const warnings: string[] = [];

  // --- running node ---
  let nodeInfo: any;
  try {
    nodeInfo = await fetchJson(`${options.restUrl.replace(/\/+$/, '')}/node/info`);
  } catch (err: any) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.REST_UNREACHABLE,
      `ノードの REST API (${options.restUrl}) に接続できません。ノードが起動しているか確認してください。`,
      err?.message,
    );
  }

  // --- generationHash: BNL config is the source of truth, node must agree ---
  let presetGenerationHash = '';
  try {
    const preset = readYaml(presetPath);
    presetGenerationHash = normalizeHexKey(preset?.networkProperties?.nemesisGenerationHashSeed);
  } catch { /* handled below */ }
  const nodeGenerationHash = normalizeHexKey(nodeInfo?.networkGenerationHashSeed);
  if (!presetGenerationHash) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.GENERATION_HASH_MISMATCH,
      'custom-preset.yml から generationHash を取得できませんでした。',
      presetPath,
    );
  }
  if (presetGenerationHash !== nodeGenerationHash) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.GENERATION_HASH_MISMATCH,
      'BNL の設定と稼働ノードで generationHash が一致しません。別のネットワークを指している可能性があります。',
      `preset=${presetGenerationHash} node=${nodeGenerationHash}`,
    );
  }

  // --- public keys: addresses.yml must agree with the running node ---
  const addressesNode = readAddressesNode(targetDir, options.nodeName);
  const mainPublicKey = normalizeHexKey(addressesNode?.main?.publicKey);
  const transportPublicKey = normalizeHexKey(addressesNode?.transport?.publicKey);

  // /node/info.publicKey is the MAIN key; the transport key is nodePublicKey.
  // Confusing the two is the classic mistake here, so both are checked by name.
  const nodeMainPublicKey = normalizeHexKey(nodeInfo?.publicKey);
  const nodeTransportPublicKey = normalizeHexKey(nodeInfo?.nodePublicKey);

  if (!mainPublicKey || mainPublicKey !== nodeMainPublicKey) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.MAIN_KEY_MISMATCH,
      'addresses.yml の main 公開鍵が稼働ノードの publicKey と一致しません。',
      `addresses=${mainPublicKey} node=${nodeMainPublicKey}`,
    );
  }
  if (!transportPublicKey) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      'addresses.yml に transport 公開鍵がありません。',
    );
  }
  if (transportPublicKey !== nodeTransportPublicKey) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_MISMATCH,
      'addresses.yml の transport 公開鍵が稼働ノードの nodePublicKey と一致しません。',
      `addresses=${transportPublicKey} node=${nodeTransportPublicKey}`,
    );
  }

  // --- endpoints ---
  const preset = (() => { try { return readYaml(presetPath); } catch { return {}; } })();
  const uiMeta = (() => {
    try { return JSON.parse(fs.readFileSync(uiMetaPath, 'utf8').replace(/^﻿/, '')); }
    catch { return {}; }
  })();
  const presetNode = (Array.isArray(preset?.nodes) ? preset.nodes : []).find(
    (n: any) => !options.nodeName || String(n?.name) === options.nodeName,
  ) ?? (Array.isArray(preset?.nodes) ? preset.nodes[0] : undefined);
  const presetGateway = Array.isArray(preset?.gateways) ? preset.gateways[0] : undefined;

  const sources: BeaconEndpointSources = {
    p2pHost: '', p2pPort: '', apiHost: '', apiPort: '', apiScheme: '',
  };

  // p2pHost: the host the operator advertises for this node.
  let p2pHost = String(presetNode?.host ?? '').trim();
  sources.p2pHost = 'custom-preset.yml nodes[].host';
  if (options.overrides?.p2pHost) {
    p2pHost = options.overrides.p2pHost.trim();
    sources.p2pHost = 'ユーザー入力';
  }
  if (!p2pHost) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.P2P_HOST_UNAVAILABLE,
      'ノードの外向け host が設定されていません。Configuration の Nodes で host を設定してください。',
    );
  }

  // p2pPort: published port first - that is what a verifier can reach.
  let p2pPort = 0;
  if (options.overrides?.p2pPort) {
    p2pPort = Number(options.overrides.p2pPort);
    sources.p2pPort = 'ユーザー入力';
  } else {
    const internalP2p = Number(nodeInfo?.port) || 7900;
    const published = options.p2pContainer
      ? await resolvePublishedPort(options.p2pContainer, internalP2p)
      : null;
    const composed = published ?? resolveComposePort(targetDir, options.p2pContainer ?? '', internalP2p);
    if (published) {
      p2pPort = published.port;
      sources.p2pPort = published.source;
    } else if (composed) {
      p2pPort = composed.port;
      sources.p2pPort = composed.source;
    } else {
      p2pPort = internalP2p;
      sources.p2pPort = '/node/info.port（内部 listen port。公開ポートを確認してください）';
      warnings.push(
        '公開ポートを特定できなかったため、ノード内部の listen port を初期値にしています。外部から接続するポートを確認してください。',
      );
    }
  }
  if (!Number.isInteger(p2pPort) || p2pPort < 1 || p2pPort > 65535) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.P2P_PORT_UNAVAILABLE,
      'P2P ポートを特定できませんでした。',
      String(p2pPort),
    );
  }

  // apiHost: defaults to p2pHost; a proxy/tunnel deployment overrides it.
  let apiHost = p2pHost;
  sources.apiHost = 'p2pHost と同一（既定）';
  const publishedSubdomain = String(uiMeta?.publishSubdomain ?? '').trim();
  if (publishedSubdomain) {
    apiHost = publishedSubdomain;
    sources.apiHost = '公開設定 (subdomain)';
  }
  if (options.overrides?.apiHost) {
    apiHost = options.overrides.apiHost.trim();
    sources.apiHost = 'ユーザー入力';
  }
  if (!apiHost) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.API_HOST_UNAVAILABLE,
      'REST API の host を特定できませんでした。',
    );
  }

  // apiPort
  let apiPort = 0;
  if (options.overrides?.apiPort) {
    apiPort = Number(options.overrides.apiPort);
    sources.apiPort = 'ユーザー入力';
  } else {
    const internalApi = Number(presetGateway?.port) || 3000;
    const published = options.apiContainer
      ? await resolvePublishedPort(options.apiContainer, internalApi)
      : null;
    if (published) {
      apiPort = published.port;
      sources.apiPort = published.source;
    } else {
      apiPort = internalApi;
      sources.apiPort = 'custom-preset.yml gateways[].port';
    }
  }
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.API_PORT_UNAVAILABLE,
      'REST API のポートを特定できませんでした。',
      String(apiPort),
    );
  }

  // apiScheme: never guessed from the port number. A published (tunnelled)
  // endpoint terminates TLS, so https is offered as the default there; in every
  // other case the operator confirms it.
  let apiScheme: 'http' | 'https';
  if (options.overrides?.apiScheme) {
    apiScheme = options.overrides.apiScheme;
    sources.apiScheme = 'ユーザー入力';
  } else if (publishedSubdomain) {
    apiScheme = 'https';
    sources.apiScheme = '公開設定あり → https（要確認）';
  } else {
    apiScheme = 'http';
    sources.apiScheme = '判定材料なし → http（要確認）';
    warnings.push(
      'REST API の scheme を自動判定できませんでした。http/https を確認してから書き出してください。',
    );
  }
  if (apiScheme !== 'http' && apiScheme !== 'https') {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.API_SCHEME_UNKNOWN,
      'REST API の scheme が http / https のいずれでもありません。',
      String(apiScheme),
    );
  }

  for (const [label, host] of [['P2P', p2pHost], ['REST API', apiHost]] as const) {
    if (isPrivateOrLocalHost(host)) {
      warnings.push(
        `${label} の host (${host}) はプライベート/ローカルアドレスです。第三者による外部検証ができない可能性があります（Gateway や VPN 経由なら問題ありません）。`,
      );
    }
  }

  const block = await fetchBlockState(options.restUrl);

  return {
    node: {
      nodeName: String(addressesNode?.name ?? ''),
      networkName: String(uiMeta?.networkName ?? ''),
      generationHash: presetGenerationHash,
      transportPublicKey,
      mainPublicKey,
      friendlyName: String(nodeInfo?.friendlyName ?? ''),
    },
    endpoints: { p2pHost, p2pPort, apiHost, apiPort, apiScheme },
    endpointSources: sources,
    block,
    warnings,
  };
}

/**
 * Read height, hash and timestamp from ONE block.
 *
 * The chain moves while this runs, so the height is resolved first and the
 * block is then fetched by that height; the echoed `block.height` is checked so
 * a Beacon can never pair a height with another block's hash.
 */
export async function fetchBlockState(restUrl: string): Promise<BeaconBlockState> {
  const base = restUrl.replace(/\/+$/, '');
  let height: string;
  try {
    const chainInfo = await fetchJson(`${base}/chain/info`);
    height = String(chainInfo?.height ?? '');
    if (!/^\d+$/.test(height)) throw new Error(`unexpected height: ${height}`);
  } catch (err: any) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.BLOCK_FETCH_FAILED,
      '/chain/info からブロック高を取得できませんでした。',
      err?.message,
    );
  }

  let block: any;
  try {
    block = await fetchJson(`${base}/blocks/${height}`);
  } catch (err: any) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.BLOCK_FETCH_FAILED,
      `/blocks/${height} を取得できませんでした。`,
      err?.message,
    );
  }

  const returnedHeight = String(block?.block?.height ?? '');
  if (returnedHeight !== height) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.BLOCK_HEIGHT_MISMATCH,
      '取得したブロックの高さが要求値と一致しません。取得中にチェーンが進んだ可能性があります。もう一度実行してください。',
      `requested=${height} returned=${returnedHeight}`,
    );
  }
  const blockHash = normalizeHexKey(block?.meta?.hash);
  const blockTimestamp = String(block?.block?.timestamp ?? '');
  if (!/^[0-9A-F]{64}$/.test(blockHash) || !/^\d+$/.test(blockTimestamp)) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.BLOCK_FETCH_FAILED,
      'ブロックのハッシュまたはタイムスタンプを取得できませんでした。',
      `hash=${blockHash} timestamp=${blockTimestamp}`,
    );
  }
  return { height, blockHash, blockTimestamp };
}

// =============================================================================
// Signing and file production
// =============================================================================

export interface GeneratedBeacon {
  /** The Beacon File JSON exactly as the SDK renders it. */
  json: string;
  /** Suggested file name. Carries no protocol meaning. */
  fileName: string;
  payloadHash: string;
  signature: string;
  payloadByteLength: number;
}

/**
 * Decrypt the transport private key, sign, self-verify, and return the file.
 *
 * The key exists only inside this function: it is decrypted here, handed to the
 * SDK signer, and the signer is destroyed in `finally` so an error partway
 * through still zeroes the buffer. It is never logged, returned, or written
 * into the Beacon File.
 */
export async function generateBeacon(
  paths: BeaconSourcePaths,
  preview: BeaconPreview,
  password: string,
  options: { nodeName?: string } = {},
): Promise<GeneratedBeacon> {
  const sdk = await loadBeaconSdk();
  const addressesNode = readAddressesNode(paths.targetDir, options.nodeName);

  const encrypted = String(addressesNode?.transport?.privateKey ?? '');
  if (!encrypted) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      'addresses.yml に transport 秘密鍵がありません。',
    );
  }

  let transportPrivateKey: string;
  try {
    transportPrivateKey = decryptPrivateKey(encrypted, password).trim().toUpperCase();
  } catch (err: any) {
    // Deliberately vague: a decrypt failure almost always means a wrong
    // password, and echoing crypto internals here helps nobody.
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      'transport 秘密鍵を復号できませんでした。ネットワーク作成時のパスワードと一致しているか確認してください。',
    );
  }
  if (!/^[0-9A-F]{64}$/.test(transportPrivateKey)) {
    throw new BeaconProducerError(
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      '復号した transport 秘密鍵の形式が不正です。',
    );
  }

  const signer = new sdk.SymbolSdkBeaconSigner(transportPrivateKey);
  try {
    // Three-way check: the key we are about to sign with, what addresses.yml
    // records, and what the running node advertises must all be the same
    // identity. collectBeaconPreview already compared the latter two.
    const derived = String(await signer.getPublicKey()).toUpperCase();
    if (derived !== preview.node.transportPublicKey) {
      throw new BeaconProducerError(
        BeaconProducerErrorCode.TRANSPORT_KEY_MISMATCH,
        '署名鍵から導出した公開鍵が、ノードの transport 公開鍵と一致しません。',
        `derived=${derived} expected=${preview.node.transportPublicKey}`,
      );
    }

    const pkg = await sdk.createBeaconPackage(
      {
        generationHash: preview.node.generationHash,
        transportPublicKey: preview.node.transportPublicKey,
        mainPublicKey: preview.node.mainPublicKey,
        height: preview.block.height,
        blockHash: preview.block.blockHash,
        blockTimestamp: preview.block.blockTimestamp,
        p2pHost: preview.endpoints.p2pHost,
        p2pPort: preview.endpoints.p2pPort,
        apiHost: preview.endpoints.apiHost,
        apiPort: preview.endpoints.apiPort,
        apiScheme: preview.endpoints.apiScheme,
      },
      signer,
    );

    const json = sdk.encodeBeaconFileJson(pkg);

    // Offline self-verification with the same SDK, before anything is written.
    const result = sdk.validateBeaconFile(json);
    if (!result.valid) {
      throw new BeaconProducerError(
        BeaconProducerErrorCode.BEACON_VALIDATION_FAILED,
        '生成した Beacon の自己検証に失敗したため、書き出しを中止しました。',
        result.errors.map((e) => e.code).join(', '),
      );
    }

    const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '_');
    const namePart = [preview.node.networkName, preview.node.nodeName]
      .map((v) => safe(v || ''))
      .filter(Boolean)
      .join('-') || 'node';

    return {
      json,
      fileName: `${namePart}.beacon.json`,
      payloadHash: pkg.payloadHash,
      signature: pkg.signature,
      payloadByteLength: pkg.payloadHex.length / 2,
    };
  } finally {
    // Runs even if signing or validation threw.
    signer.destroy();
  }
}
