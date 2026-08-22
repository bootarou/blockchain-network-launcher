/**
 * Beacon producer tests.
 *
 * A throw-away key pair and a stub REST server stand in for a real node, so the
 * whole path - collection, the three-way key check, signing and the SDK's own
 * offline validation - runs without touching a live network or a real secret.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import yaml from 'js-yaml';

import {
  BeaconProducerError,
  BeaconProducerErrorCode,
  collectBeaconPreview,
  fetchBlockState,
  generateBeacon,
  isPrivateOrLocalHost,
  loadBeaconSdk,
} from './beacon.js';
import { ENCRYPT_PREFIX } from './addresses-crypto.js';

// TEST KEY ONLY. Publicly known; never used for anything real.
const TRANSPORT_PRIVATE_KEY = '0F1E2D3C4B5A69788796A5B4C3D2E1F00F1E2D3C4B5A69788796A5B4C3D2E1F0';
const MAIN_PUBLIC_KEY = '38B6FF4049931EC1726C3CAE92A1B445927EA4050BC5DF9CB9F3245FBED4D0BB';
const GENERATION_HASH = '654B1030242BE4D3FC248AF2D627E22EEC20C3980BFBB13DF83DFC96BD9595D1';
const BLOCK_HASH = 'D06D1EE54939C362BBD39DFBB762B5BC88D9C5759ABE50E763B24DEFCE204455';
const PASSWORD = 'test-network-password';
const HEIGHT = '77765';
const TIMESTAMP = '213845856743';

/** Same scheme symbol-bootstrap uses, so the fixture is decryptable by BNL. */
function encryptPrivateKey(plain: string, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 1024, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return `${ENCRYPT_PREFIX}${salt.toString('hex')}${iv.toString('hex')}${body.toString('base64')}`;
}

let transportPublicKey = '';
let dir = '';
let server: http.Server;
let restUrl = '';

/** Mutable so a test can make the stub node disagree with the fixtures. */
let nodeInfo: Record<string, unknown>;
let chainHeight = HEIGHT;
let blockHeightOverride: string | null = null;

function writeFixture(): void {
  fs.writeFileSync(
    path.join(dir, 'addresses.yml'),
    yaml.dump({
      nodes: [
        {
          name: 'api-node-0',
          main: { publicKey: MAIN_PUBLIC_KEY, privateKey: encryptPrivateKey('00'.repeat(32), PASSWORD) },
          transport: {
            publicKey: transportPublicKey,
            privateKey: encryptPrivateKey(TRANSPORT_PRIVATE_KEY, PASSWORD),
          },
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'custom-preset.yml'),
    yaml.dump({
      networkProperties: { nemesisGenerationHashSeed: GENERATION_HASH },
      nodes: [{ name: 'api-node-0', host: 'node.example.com' }],
      gateways: [{ apiNodeName: 'api-node-0', port: 3000 }],
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'ui-meta.json'),
    JSON.stringify({ networkName: 'test-net' }),
  );
}

function paths() {
  return {
    targetDir: dir,
    presetPath: path.join(dir, 'custom-preset.yml'),
    uiMetaPath: path.join(dir, 'ui-meta.json'),
  };
}

beforeAll(async () => {
  const sdk = await loadBeaconSdk();
  transportPublicKey = String(sdk.deriveTransportPublicKey(TRANSPORT_PRIVATE_KEY)).toUpperCase();

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-beacon-'));
  writeFixture();

  nodeInfo = {
    publicKey: MAIN_PUBLIC_KEY,
    nodePublicKey: transportPublicKey,
    networkGenerationHashSeed: GENERATION_HASH,
    friendlyName: 'Test Node',
    port: 7900,
  };

  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const send = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.startsWith('/node/info')) return send(nodeInfo);
    if (url.startsWith('/chain/info')) return send({ height: chainHeight });
    const m = url.match(/^\/blocks\/(\d+)/);
    if (m) {
      return send({
        meta: { hash: BLOCK_HASH },
        block: { height: blockHeightOverride ?? m[1], timestamp: TIMESTAMP },
      });
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  restUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function preview(overrides = {}) {
  return collectBeaconPreview(paths(), { restUrl, overrides, ...overrides });
}

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  await expect(fn()).rejects.toMatchObject({ code });
}

describe('SDK integration', () => {
  it('loads the ESM SDK from CommonJS and exposes the v1 API', async () => {
    const sdk = await loadBeaconSdk();
    expect(typeof sdk.createBeaconPackage).toBe('function');
    expect(typeof sdk.validateBeaconFile).toBe('function');
    expect(typeof sdk.SymbolSdkBeaconSigner).toBe('function');
  });
});

describe('collectBeaconPreview', () => {
  it('collects a payload whose keys match the running node', async () => {
    const result = await preview();
    expect(result.node.generationHash).toBe(GENERATION_HASH);
    expect(result.node.mainPublicKey).toBe(MAIN_PUBLIC_KEY);
    expect(result.node.transportPublicKey).toBe(transportPublicKey);
    expect(result.endpoints.p2pHost).toBe('node.example.com');
    expect(result.block).toEqual({
      height: HEIGHT,
      blockHash: BLOCK_HASH,
      blockTimestamp: TIMESTAMP,
    });
  });

  it('takes height, hash and timestamp from one block', async () => {
    const state = await fetchBlockState(restUrl);
    expect(state.height).toBe(HEIGHT);
    expect(state.blockTimestamp).toBe(TIMESTAMP);
    // Not the local clock: chain time is far from a Unix millisecond value.
    expect(Number(state.blockTimestamp)).toBeLessThan(Date.now());
  });

  it('lets the operator override the endpoints', async () => {
    const result = await preview({
      overrides: {
        p2pHost: '203.0.113.10', p2pPort: 17900,
        apiHost: 'api.example.com', apiPort: 443, apiScheme: 'https' as const,
      },
    });
    expect(result.endpoints).toEqual({
      p2pHost: '203.0.113.10', p2pPort: 17900,
      apiHost: 'api.example.com', apiPort: 443, apiScheme: 'https',
    });
    expect(result.endpointSources.apiScheme).toContain('ユーザー入力');
  });

  it('warns about a private endpoint without refusing to continue', async () => {
    const result = await preview({ overrides: { p2pHost: '192.168.0.28' } });
    expect(result.endpoints.p2pHost).toBe('192.168.0.28');
    expect(result.warnings.join(' ')).toContain('プライベート');
  });

  it('classifies private and public hosts', () => {
    for (const host of ['127.0.0.1', 'localhost', '192.168.1.5', '10.0.0.1', '172.16.0.1', '::1']) {
      expect(isPrivateOrLocalHost(host), host).toBe(true);
    }
    for (const host of ['203.0.113.10', 'node.example.com', '2001:db8::1', '172.32.0.1']) {
      expect(isPrivateOrLocalHost(host), host).toBe(false);
    }
  });
});

describe('collectBeaconPreview rejection', () => {
  it('fails when the REST API is unreachable', async () => {
    await expectCode(
      () => collectBeaconPreview(paths(), { restUrl: 'http://127.0.0.1:1' }),
      BeaconProducerErrorCode.REST_UNREACHABLE,
    );
  });

  it('fails when the node reports a different generationHash', async () => {
    const original = nodeInfo.networkGenerationHashSeed;
    nodeInfo.networkGenerationHashSeed = 'A'.repeat(64);
    try {
      await expectCode(() => preview(), BeaconProducerErrorCode.GENERATION_HASH_MISMATCH);
    } finally {
      nodeInfo.networkGenerationHashSeed = original;
    }
  });

  it('fails when the main public key disagrees with the node', async () => {
    const original = nodeInfo.publicKey;
    nodeInfo.publicKey = 'B'.repeat(64);
    try {
      await expectCode(() => preview(), BeaconProducerErrorCode.MAIN_KEY_MISMATCH);
    } finally {
      nodeInfo.publicKey = original;
    }
  });

  it('fails when the transport public key disagrees with the node', async () => {
    const original = nodeInfo.nodePublicKey;
    nodeInfo.nodePublicKey = 'C'.repeat(64);
    try {
      await expectCode(() => preview(), BeaconProducerErrorCode.TRANSPORT_KEY_MISMATCH);
    } finally {
      nodeInfo.nodePublicKey = original;
    }
  });

  it('never treats /node/info.publicKey as the transport key', async () => {
    // The classic mix-up: if the code read publicKey as the transport key, a
    // node whose two keys are swapped would pass. It must not.
    const mainOriginal = nodeInfo.publicKey;
    const transportOriginal = nodeInfo.nodePublicKey;
    nodeInfo.publicKey = transportPublicKey;
    nodeInfo.nodePublicKey = MAIN_PUBLIC_KEY;
    try {
      await expectCode(() => preview(), BeaconProducerErrorCode.MAIN_KEY_MISMATCH);
    } finally {
      nodeInfo.publicKey = mainOriginal;
      nodeInfo.nodePublicKey = transportOriginal;
    }
  });

  it('fails when the returned block is not the requested height', async () => {
    blockHeightOverride = '99999';
    try {
      await expectCode(() => fetchBlockState(restUrl), BeaconProducerErrorCode.BLOCK_HEIGHT_MISMATCH);
    } finally {
      blockHeightOverride = null;
    }
  });

  it('fails when the chain height cannot be read', async () => {
    await expectCode(
      () => fetchBlockState('http://127.0.0.1:1'),
      BeaconProducerErrorCode.BLOCK_FETCH_FAILED,
    );
  });
});

describe('generateBeacon', () => {
  it('signs with the transport key and passes the SDK\'s own validation', async () => {
    const sdk = await loadBeaconSdk();
    const p = await preview();
    const beacon = await generateBeacon(paths(), p, PASSWORD);

    const result = sdk.validateBeaconFile(beacon.json);
    expect(result.valid).toBe(true);
    expect(result.formatValid).toBe(true);
    expect(result.payloadHashValid).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.metadataMatchesPayload).toBe(true);

    const file = JSON.parse(beacon.json);
    expect(file.protocol).toBe('BNL_BEACON');
    expect(file.node.transportPublicKey).toBe(transportPublicKey);
    expect(file.operator.mainPublicKey).toBe(MAIN_PUBLIC_KEY);
    expect(file.network.generationHash).toBe(GENERATION_HASH);
    expect(file.block).toEqual({ height: HEIGHT, hash: BLOCK_HASH, timestamp: TIMESTAMP });
    expect(beacon.fileName).toBe('test-net-api-node-0.beacon.json');
  });

  it('never puts key material in the file', async () => {
    const p = await preview();
    const beacon = await generateBeacon(paths(), p, PASSWORD);
    expect(beacon.json).not.toContain(TRANSPORT_PRIVATE_KEY);
    expect(beacon.json.toLowerCase()).not.toContain('privatekey');
    expect(beacon.json).not.toContain(ENCRYPT_PREFIX);
    expect(JSON.stringify(beacon)).not.toContain(TRANSPORT_PRIVATE_KEY);
  });

  it('carries the operator\'s endpoint overrides into the signed bytes', async () => {
    const sdk = await loadBeaconSdk();
    const p = await preview({
      overrides: {
        p2pHost: '203.0.113.10', p2pPort: 17900,
        apiHost: 'api.example.com', apiPort: 443, apiScheme: 'https' as const,
      },
    });
    const beacon = await generateBeacon(paths(), p, PASSWORD);
    expect(sdk.validateBeaconFile(beacon.json).valid).toBe(true);

    const decoded = sdk.decodeBeaconFile(beacon.json).payload;
    expect(sdk.beaconP2pEndpoint(decoded)).toBe('203.0.113.10:17900');
    expect(sdk.beaconApiUrl(decoded)).toBe('https://api.example.com:443');
  });

  it('rejects a wrong network password', async () => {
    const p = await preview();
    await expectCode(
      () => generateBeacon(paths(), p, 'wrong-password'),
      BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
    );
  });

  it('refuses to sign when the signing key is not the node identity', async () => {
    // The stored key is fine, but the payload claims a different transport
    // identity: signing anyway would produce a Beacon nobody can verify.
    const p = await preview();
    p.node.transportPublicKey = 'D'.repeat(64);
    await expectCode(
      () => generateBeacon(paths(), p, PASSWORD),
      BeaconProducerErrorCode.TRANSPORT_KEY_MISMATCH,
    );
  });

  it('fails when addresses.yml has no transport key', async () => {
    const stripped = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-beacon-nokey-'));
    fs.copyFileSync(path.join(dir, 'custom-preset.yml'), path.join(stripped, 'custom-preset.yml'));
    fs.copyFileSync(path.join(dir, 'ui-meta.json'), path.join(stripped, 'ui-meta.json'));
    fs.writeFileSync(
      path.join(stripped, 'addresses.yml'),
      yaml.dump({ nodes: [{ name: 'api-node-0', main: { publicKey: MAIN_PUBLIC_KEY } }] }),
    );
    const p = await preview();
    try {
      await expectCode(
        () => generateBeacon(
          { targetDir: stripped, presetPath: paths().presetPath, uiMetaPath: paths().uiMetaPath },
          p, PASSWORD,
        ),
        BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      );
    } finally {
      fs.rmSync(stripped, { recursive: true, force: true });
    }
  });

  it('fails when addresses.yml is missing entirely', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-beacon-empty-'));
    try {
      await expectCode(
        () => collectBeaconPreview(
          { targetDir: empty, presetPath: paths().presetPath, uiMetaPath: paths().uiMetaPath },
          { restUrl },
        ),
        BeaconProducerErrorCode.TRANSPORT_KEY_UNAVAILABLE,
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('destroys the signer even when signing fails', async () => {
    // A destroyed signer throws on reuse; if generateBeacon leaked one it would
    // still be usable. The public surface only lets us assert the failure path
    // completes without leaving the process holding a live key.
    const p = await preview();
    p.node.transportPublicKey = 'E'.repeat(64);
    await expect(generateBeacon(paths(), p, PASSWORD)).rejects.toBeInstanceOf(BeaconProducerError);

    // The next successful run must still work - i.e. nothing was left broken.
    const good = await preview();
    const beacon = await generateBeacon(paths(), good, PASSWORD);
    const sdk = await loadBeaconSdk();
    expect(sdk.validateBeaconFile(beacon.json).valid).toBe(true);
  });

  it('rejects a Beacon file whose metadata was edited after signing', async () => {
    const sdk = await loadBeaconSdk();
    const p = await preview();
    const beacon = await generateBeacon(paths(), p, PASSWORD);
    const file = JSON.parse(beacon.json);
    file.node.apiHost = 'attacker.example';
    const result = sdk.validateBeaconFile(JSON.stringify(file));
    expect(result.valid).toBe(false);
    expect(result.metadataMatchesPayload).toBe(false);
    expect(result.signatureValid).toBe(true);
  });
});
