const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function evaluate(source, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  vm.runInNewContext(compiled.outputText, { exports, Buffer, ...globals });
  return exports;
}

const { buildNemesisSeedState } = evaluate(fs.readFileSync(path.join(__dirname, 'nemesis-seed.ts'), 'utf8'));
const serverSource = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
const tree = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true);
function serverFunction(name) {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing ${name}`);
  return node.getText(tree);
}

function fixture() {
  const block = Buffer.alloc(424);
  block.writeUInt32LE(block.length);
  return Buffer.concat([block, Buffer.alloc(32, 0x42), Buffer.alloc(32, 0x99)]);
}

test('saved custom policy replaces heartbeat in both node roles and REST without changing fork defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-policy-apply-'));
  try {
    const meta = path.join(root, 'meta.json');
    fs.writeFileSync(meta, JSON.stringify({ customConfigValues: { emptyBlockPolicy: 'normal', uniqueAggregateTransactionHash: '0' } }));
    const files = ['nodes/api-node-0/server-config/resources', 'nodes/api-node-0/broker-config/resources', 'gateways/rest-gateway/api-node-config']
      .map(dir => path.join(root, dir, 'config-network.properties'));
    const original = "[chain]\nemptyBlockPolicy = heartbeat\nemptyBlockHeartbeatInterval = 86400s\n[fork_heights]\nuniqueAggregateTransactionHash = 2'742'000\n";
    for (const file of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, original); }
    const { applySavedCustomConfigValues } = evaluate(serverFunction('upsertIniSectionProperty') + '\nexport ' + serverFunction('applySavedCustomConfigValues'), {
      fs, path, UI_META_PATH: meta, parseJsonFile: f => JSON.parse(fs.readFileSync(f, 'utf8')), broadcastLog() {},
    });
    const version = { postGenPatches: [{ file: 'config-network.properties', section: '[chain]', props: { emptyBlockPolicy: 'normal', emptyBlockHeartbeatInterval: '86400s' } }] };
    applySavedCustomConfigValues(root, version);
    for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), original.replace('= heartbeat', '= normal'));
    fs.writeFileSync(meta, JSON.stringify({ customConfigValues: {} }));
    applySavedCustomConfigValues(root, version);
    for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), original.replace('= heartbeat', '= normal'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('empty block policy defaults to normal and preserves an existing chain policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-policy-'));
  try {
    const meta = path.join(root, '.ui-meta.json');
    const defaults = [{ file: 'config-network.properties', section: '[chain]', props: { emptyBlockPolicy: 'normal' } }];
    const { applyCustomConfigValueOverrides } = evaluate(
      serverFunction('preserveExistingEmptyBlockPolicy') + '\nexport ' + serverFunction('applyCustomConfigValueOverrides'),
      { fs, path, TARGET_DIR: root, UI_META_PATH: meta, CUSTOM_EXTRA_PATCH_DEFAULTS: defaults,
        parseJsonFile: f => JSON.parse(fs.readFileSync(f, 'utf8')), broadcastLog() {} });
    const version = () => ({ postGenPatches: JSON.parse(JSON.stringify(defaults)) });
    let v = version(); applyCustomConfigValueOverrides(v);
    assert.equal(v.postGenPatches[0].props.emptyBlockPolicy, 'normal');
    const node = path.join(root, 'nodes/api-node-0');
    fs.mkdirSync(path.join(node, 'data'), { recursive: true });
    const height = Buffer.alloc(8); height.writeBigUInt64LE(2n);
    fs.writeFileSync(path.join(node, 'data/index.dat'), height);
    for (const role of ['server', 'broker']) {
      const dir = path.join(node, role + '-config/resources');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'config-network.properties'), '[chain]\nemptyBlockPolicy = heartbeat\n');
    }
    v = version(); applyCustomConfigValueOverrides(v);
    assert.equal(v.postGenPatches[0].props.emptyBlockPolicy, 'heartbeat');
    assert.equal(JSON.parse(fs.readFileSync(meta)).customConfigValues.emptyBlockPolicy, 'heartbeat');
    for (const policy of ['normal', 'suppress', 'heartbeat']) {
      fs.writeFileSync(meta, JSON.stringify({ customConfigValues: { emptyBlockPolicy: policy } }));
      v = version(); applyCustomConfigValueOverrides(v);
      assert.equal(v.postGenPatches[0].props.emptyBlockPolicy, policy);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Mosaic properties accept REST hex and reject invalid or oversized IDs', () => {
  const { mosaicIdProperty } = evaluate('export ' + serverFunction('mosaicIdProperty'));
  assert.equal(mosaicIdProperty('577e68efebec22a4'), "0x577E'68EF'EBEC'22A4");
  assert.equal(mosaicIdProperty("0x347B'319C'695D'D93C"), "0x347B'319C'695D'D93C");
  for (const value of ['', 'not-hex', '10000000000000000'])
    assert.throws(() => mosaicIdProperty(value), /Invalid mosaic ID/);
});

test('join backfill preserves snapshot-compatible Mosaic properties in node and REST configs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-mosaic-test-'));
  try {
    const meta = path.join(root, 'meta.json');
    const preset = path.join(root, 'preset.yml');
    fs.writeFileSync(meta, '{}');
    fs.writeFileSync(preset, '');
    const configs = ['nodes/api-node-0/server-config/resources', 'nodes/api-node-0/broker-config/resources', 'gateways/rest-gateway/api-node-config']
      .map(dir => path.join(root, dir, 'config-network.properties'));
    const source = "[chain]\ncurrencyMosaicId = 0x577E'68EF'EBEC'22A4\nharvestingMosaicId = 0x347B'319C'695D'D93C\n";
    for (const file of configs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    const { backfillMosaicIds } = evaluate(serverFunction('mosaicIdProperty') + '\nexport ' + serverFunction('backfillMosaicIds'), {
      fs, path, UI_META_PATH: meta, PRESET_PATH: preset,
      parseJsonFile: () => ({ sourceNodeUrl: 'http://source:3000' }),
      yaml: { load: () => ({ networkProperties: { chain: {
        currencyMosaicId: '577E68EFEBEC22A4', harvestingMosaicId: '347B319C695DD93C',
      } } }) }, broadcastLog() {},
    });
    backfillMosaicIds(root);
    for (const file of configs) assert.equal(fs.readFileSync(file, 'utf8'), source);
    // Repair the bare-hex properties left by an earlier failed startup, too.
    for (const file of configs) fs.writeFileSync(file, source.replace(/0x|'/g, ''));
    backfillMosaicIds(root);
    for (const file of configs) assert.equal(fs.readFileSync(file, 'utf8'), source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('genesis statistics match the local height-one hash, avoiding the epoch-zero fallback', () => {
  const state = buildNemesisSeedState(fixture());
  assert.equal(state.index.readBigUInt64LE(), 1n);
  assert.equal(state.proofIndex.length, 48);
  assert.equal(state.proofIndex.readUInt32LE(0), 1);
  assert.equal(state.proofIndex.readUInt32LE(4), 1);
  assert.equal(state.proofIndex.readBigUInt64LE(8), 1n);
  assert.deepEqual(state.hashes.subarray(0, 32), Buffer.alloc(32));
  assert.deepEqual(state.hashes.subarray(32), state.proofIndex.subarray(16));
  assert.deepEqual(state.hashes.subarray(32), Buffer.alloc(32, 0x42));
});

test('proof uses the Catapult size/version/round/height/hash layout', () => {
  const { proof, proofIndex } = buildNemesisSeedState(fixture());
  assert.equal(proof.length, 56);
  assert.equal(proof.readUInt32LE(0), 56);
  assert.equal(proof.readUInt32LE(4), 1);
  assert.deepEqual(proof.subarray(8), proofIndex);
});

test('invalid block metadata is rejected before generating seed files', () => {
  assert.throws(() => buildNemesisSeedState(Buffer.alloc(3)), /Truncated/);
  assert.throws(() => buildNemesisSeedState(fixture().subarray(0, 430)), /missing/);
  const element = fixture();
  element.fill(0, 424, 456);
  assert.throws(() => buildNemesisSeedState(element), /must not be zero/);
});

test('Share install ignores remote epoch 205 and stale package indexes; disk files agree', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-seed-test-'));
  try {
    const seed = path.join(root, 'shared-seed');
    const target = path.join(root, 'target');
    fs.mkdirSync(path.join(seed, '00000'), { recursive: true });
    fs.mkdirSync(path.join(target, 'nodes', 'api-node-0'), { recursive: true });
    fs.writeFileSync(path.join(seed, '00000', '00001.dat'), fixture());
    fs.writeFileSync(path.join(seed, '00000', '00001.stmt'), Buffer.alloc(12));
    fs.writeFileSync(path.join(seed, '00000', 'hashes.dat'), Buffer.alloc(64, 0xff));
    const stale = Buffer.alloc(48);
    stale.writeUInt32LE(205);
    stale.writeUInt32LE(42, 4);
    stale.writeBigUInt64LE(146800n, 8);
    fs.writeFileSync(path.join(seed, 'proof.index.dat'), stale);
    fs.writeFileSync(path.join(seed, 'index.dat'), stale.subarray(8, 16));
    const globals = {
      fs, path, SEED_DIR: seed, buildNemesisSeedState,
      broadcastLog() {},
      fetch() { throw new Error('Seed initialization must not request current finalization'); },
    };
    const { installImportedSeed } = evaluate(
      serverFunction('writeUint64LE') + '\nexport ' + serverFunction('installImportedSeed'), globals);
    await installImportedSeed(target);
    const expected = buildNemesisSeedState(fixture());
    for (const base of [path.join(target, 'nemesis', 'seed'), path.join(target, 'nodes', 'api-node-0', 'data')]) {
      assert.deepEqual(fs.readFileSync(path.join(base, 'index.dat')), expected.index);
      assert.deepEqual(fs.readFileSync(path.join(base, 'proof.index.dat')), expected.proofIndex);
      assert.deepEqual(fs.readFileSync(path.join(base, '00000', 'hashes.dat')), expected.hashes);
      assert.deepEqual(fs.readFileSync(path.join(base, '00000', '00001.proof')), expected.proof);
      assert.equal(fs.existsSync(path.join(base, '00000', '00204.proof')), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REST reconstruction writes identical valid seed and runtime files without querying chain/info', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-rest-seed-test-'));
  try {
    fs.mkdirSync(path.join(root, 'nodes', 'api-node-0'), { recursive: true });
    const statement = Buffer.alloc(12);
    const urls = [];
    const globals = {
      fs, path, buildNemesisSeedState, broadcastLog() {},
      serializeBlockHeader: () => fixture().subarray(0, 424),
      serializeNemesisStatements: () => statement,
      fetch: async url => {
        urls.push(url);
        assert.ok(!url.endsWith('/chain/info'));
        return { ok: true, json: async () => url.endsWith('/blocks/1')
          ? { block: { size: 424 }, meta: { hash: '42'.repeat(32), generationHash: '99'.repeat(32) } }
          : { data: [] } };
      },
    };
    const { fetchAndBuildNemesisSeed } = evaluate(
      ['hexToBuffer', 'writeUint32LE', 'writeUint64LE'].map(serverFunction).join('\n')
      + '\nexport ' + serverFunction('fetchAndBuildNemesisSeed'), globals);
    await fetchAndBuildNemesisSeed(root, 'http://source.invalid');
    assert.equal(urls.length, 4);
    const expected = buildNemesisSeedState(fixture());
    for (const base of [path.join(root, 'nemesis', 'seed'), path.join(root, 'nodes', 'api-node-0', 'data')]) {
      assert.deepEqual(fs.readFileSync(path.join(base, 'proof.index.dat')), expected.proofIndex);
      assert.deepEqual(fs.readFileSync(path.join(base, '00000', 'hashes.dat')), expected.hashes);
      assert.deepEqual(fs.readFileSync(path.join(base, '00000', '00001.proof')), expected.proof);
      assert.deepEqual(fs.readFileSync(path.join(base, '00000', '00001.stmt')), statement);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
