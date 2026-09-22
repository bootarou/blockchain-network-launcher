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
