const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'local-recovery.ts'), 'utf8');
const exportsForTest = {};
function loadModule(platform = process.platform) {
const result = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, {
  exports: result, require, Buffer, console, process: { ...process, platform }, structuredClone,
  setTimeout: (fn) => setTimeout(fn, 1),
});
return result;
}
Object.assign(exportsForTest, loadModule());
const { readIndex, blockPath, blockHash, queueProblems, queuesDrained, switchDirectories, LocalRecovery } = exportsForTest;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function index(file, n) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(n)); fs.writeFileSync(file, bytes);
}
function block(data, h) {
  const file = blockPath(data, h);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.alloc(408); bytes.writeUInt32LE(376); bytes.writeBigUInt64LE(h, 112);
  bytes.fill(0x42, 376); fs.writeFileSync(file, bytes);
  return '42'.repeat(32);
}
function queue(root, writer, reader) {
  const dir = path.join(root, 'spool/block_change');
  index(path.join(dir, 'index.dat'), writer);
  index(path.join(dir, 'index_broker_r.dat'), reader);
  return dir;
}

test('block paths use 10000 decimal groups and read the stored block-element hash', t => {
  const root = fixture(t);
  assert.equal(blockPath(root, 148874n), path.join(root, '00014/08874.dat'));
  assert.equal(blockPath(root, 10000n), path.join(root, '00001/00000.dat'));
  const hash = block(root, 148874n);
  assert.equal(blockHash(root, 148874n), hash);
  fs.truncateSync(blockPath(root, 148874n), 380);
  assert.throws(() => blockHash(root, 148874n), /Truncated/);
});

test('indexes must be exactly eight bytes', t => {
  const root = fixture(t), file = path.join(root, 'index.dat');
  for (const size of [0, 7, 9]) {
    fs.writeFileSync(file, Buffer.alloc(size)); assert.throws(() => readIndex(file), /8-byte/);
  }
  index(file, 148874n); assert.equal(readIndex(file), 148874n);
});

test('detects the missing pending spool message from the actual incident', t => {
  const root = fixture(t);
  const dir = queue(root, 148874n, 148873n);
  assert.match(queueProblems(root)[0], /missing\/empty/);
  fs.writeFileSync(path.join(dir, '0000000000024589.dat'), 'message');
  assert.equal(queueProblems(root).length, 0);
  fs.truncateSync(path.join(dir, '0000000000024589.dat'), 0);
  assert.equal(queueProblems(root).length, 1);
});

test('consumed files need not exist; absent reader means position zero', t => {
  const root = fixture(t);
  const dir = queue(root, 2n, 2n);
  assert.equal(queueProblems(root).length, 0);
  fs.unlinkSync(path.join(dir, 'index_broker_r.dat'));
  assert.equal(queueProblems(root).length, 1);
});

test('corrupt or huge queue indices fail promptly without range enumeration', t => {
  const root = fixture(t);
  const dir = queue(root, (1n << 64n) - 1n, 0n);
  assert.equal(queueProblems(root).length, 1);
  index(path.join(dir, 'index.dat'), 1n); index(path.join(dir, 'index_broker_r.dat'), 2n);
  assert.match(queueProblems(root)[0], /ahead/);
});

function pair(root, name) {
  const live = path.join(root, `${name}-live`), next = path.join(root, `${name}-new`), saved = path.join(root, `${name}-saved`);
  fs.mkdirSync(live); fs.mkdirSync(next);
  fs.writeFileSync(path.join(live, 'value'), 'original'); fs.writeFileSync(path.join(next, 'value'), 'rebuilt');
  return [live, next, saved];
}
test('cutover retains both original directories', t => {
  const root = fixture(t), pairs = [pair(root, 'node'), pair(root, 'mongo')];
  switchDirectories(pairs);
  for (const [live, next, saved] of pairs) {
    assert.equal(fs.readFileSync(path.join(live, 'value'), 'utf8'), 'rebuilt');
    assert.equal(fs.readFileSync(path.join(saved, 'value'), 'utf8'), 'original');
    assert.equal(fs.existsSync(next), false);
  }
});
for (const failAt of [1, 2, 3, 4]) test(`cutover rolls back a failure at rename ${failAt}`, t => {
  const root = fixture(t), pairs = [pair(root, 'node'), pair(root, 'mongo')];
  let count = 0;
  assert.throws(() => switchDirectories(pairs, (a, b) => {
    if (++count === failAt) throw new Error('injected');
    fs.renameSync(a, b);
  }), /injected/);
  for (const [live, next, saved] of pairs) {
    assert.equal(fs.readFileSync(path.join(live, 'value'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(next, 'value'), 'utf8'), 'rebuilt');
    assert.equal(fs.existsSync(saved), false);
  }
});

test('restart holds the lock on interrupted work and ambiguous cutover', async t => {
  const root = fixture(t), journal = path.join(root, 'job.json');
  for (const [before, after] of [['running', 'interrupted'], ['applying', 'manual'], ['ready', 'ready']]) {
    fs.writeFileSync(journal, JSON.stringify({ id: 'test', state: before, containers: [] }));
    const manager = new LocalRecovery(root, journal, () => {});
    assert.equal(manager.status().state, after); assert.equal(manager.busy, true);
    assert.throws(() => manager.start(), /already active/);
    if (after === 'manual') await assert.rejects(manager.abandon('test'), /Cannot release/);
  }
  fs.writeFileSync(journal, '{corrupt');
  const manager = new LocalRecovery(root, journal, () => {});
  assert.equal(manager.busy, true); assert.equal(manager.status().state, 'manual');
});

async function wait(manager) {
  for (let i = 0; i < 300 && manager.executing; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(manager.executing, false, 'job timeout');
  return manager.status();
}

function simulatedRecovery(t, failQuery = false) {
  const root = fixture(t), node = path.join(root, 'nodes/api-node-0');
  fs.mkdirSync(path.join(node, 'data/state'), { recursive: true });
  fs.mkdirSync(path.join(node, 'broker-config/resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'databases/db'), { recursive: true });
  fs.writeFileSync(path.join(node, 'broker-config/resources/config-database.properties'), 'databaseUri = mongodb://original:27017\n');
  fs.writeFileSync(path.join(node, 'data/state/original'), 'retain');
  fs.writeFileSync(path.join(node, 'data/voting_status.dat'), 'voting-state');
  fs.writeFileSync(path.join(root, 'databases/db/original'), 'mongo-original');
  index(path.join(node, 'data/index.dat'), 2n);
  const hash = block(path.join(node, 'data'), 2n);
  const containers = new Map(), calls = [];
  let manager;
  const run = async args => {
    calls.push(args);
    if (args[0] === 'ps') return '';
    if (args[0] === 'network') return args[1] === 'ls' ? manager.status().network || '' : '';
    if (args[0] === 'inspect') return JSON.stringify([containers.get(args[1])]);
    if (args[0] === 'logs') return `cache state hash at height 2: ${'AB'.repeat(32)}`;
    if (args[0] === 'exec') {
      if (failQuery && args.at(-1).includes('RECOVERY_DB_VERIFIED')) throw new Error('hash mismatch');
      return 'RECOVERY_DB_VERIFIED';
    }
    if (args[0] === 'stop') { Object.assign(containers.get(args.at(-1)).State, { Status: 'exited', Running: false }); return ''; }
    if (args[0] === 'start') { Object.assign(containers.get(args[1]).State, { Status: 'running', Running: true }); return ''; }
    if (args[0] === 'rm') { containers.delete(args[1]); return ''; }
    if (args[0] === 'run' && args.includes('--rm')) return '100 /source';
    if (args[0] === 'run') {
      const name = args[args.indexOf('--name') + 1];
      const role = name.split('-').at(-1), work = manager.status().work;
      const running = role === 'broker' || role === 'mongo';
      containers.set(name, { State: { Status: running ? 'running' : 'exited', Running: running, ExitCode: 0, OOMKilled: false } });
      if (role === 'copy') fs.cpSync(node, path.join(work, 'node'), { recursive: true });
      if (role === 'import') {
        for (const q of ['block_change', 'state_change', 'finalization']) {
          index(path.join(work, `node/data/spool/${q}/index.dat`), 2n);
          index(path.join(work, `node/data/spool/${q}/index_broker_r.dat`), 2n);
        }
        fs.mkdirSync(path.join(work, 'node/data/state'));
        fs.writeFileSync(path.join(work, 'node/data/state/rebuilt'), 'state');
      }
      return name;
    }
    throw new Error(`unexpected command ${args}`);
  };
  manager = new LocalRecovery(root, path.join(root, 'journal.json'), () => {}, run);
  manager.preflight = async () => ({ node, height: 2n, hash, imageId: 'server', mongoId: 'mongo', configHash: 'config' });
  return { root, node, manager, calls, containers };
}

test('orchestration prepares, verifies, restarts, and only switches on explicit apply', async t => {
  const { root, node, manager, calls, containers } = simulatedRecovery(t);
  const started = manager.start();
  assert.throws(() => manager.start(), /already active/);
  const ready = await wait(manager);
  assert.equal(ready.state, 'ready', ready.error);
  assert.equal(fs.readFileSync(path.join(node, 'data/state/original'), 'utf8'), 'retain');
  assert.equal(queuesDrained(path.join(ready.work, 'node/data')), true);
  assert.equal(manager.busy, true);
  await assert.rejects(manager.apply('wrong'), /not ready/);
  await manager.apply(started.id);
  assert.equal(manager.status().state, 'complete'); assert.equal(manager.busy, false);
  assert.equal(fs.readFileSync(path.join(node, 'data/voting_status.dat'), 'utf8'), 'voting-state');
  assert.equal(fs.readFileSync(path.join(node, 'broker-config/resources/config-database.properties'), 'utf8'), 'databaseUri = mongodb://original:27017\n');
  assert.equal(fs.readFileSync(path.join(ready.work, 'original-before-cutover/mongo-db/original'), 'utf8'), 'mongo-original');
  assert.equal(containers.size, 0);
  assert.ok(calls.some(c => c[0] === 'network' && c.includes('--internal')));
  assert.ok(calls.filter(c => c[0] === 'run' && c.includes('-d')).every(c => !c.includes('-p') && c.includes('--pull')));
  assert.ok(calls.some(c => c[0] === 'start' && c[1].endsWith('-broker')));
  assert.equal(fs.existsSync(path.join(root, 'databases/db')), true);
});

test('verification failure never changes original data and cannot be applied', async t => {
  const { node, manager } = simulatedRecovery(t, true);
  const job = manager.start(); const failed = await wait(manager);
  assert.equal(failed.state, 'failed'); assert.match(failed.error, /hash mismatch/);
  assert.equal(manager.busy, true);
  assert.equal(fs.readFileSync(path.join(node, 'data/state/original'), 'utf8'), 'retain');
  await assert.rejects(manager.apply(job.id), /not ready/);
});

test('changed source tip refuses prepared cutover', async t => {
  const { manager, node } = simulatedRecovery(t);
  const job = manager.start(); await wait(manager);
  const preflight = manager.preflight;
  manager.preflight = async () => ({ ...await preflight(), height: 3n });
  await assert.rejects(manager.apply(job.id), /changed/);
  assert.equal(fs.readFileSync(path.join(node, 'data/state/original'), 'utf8'), 'retain');
});

test('abandon preserves workspace; manual state has no unlock action', async t => {
  const { manager } = simulatedRecovery(t);
  const job = manager.start(); await wait(manager);
  await manager.abandon(job.id);
  assert.equal(manager.busy, false); assert.equal(fs.existsSync(job.work), true);
});

test('real API middleware blocks mutations during recovery but allows status and apply', async t => {
  const express = require('express');
  const serverSource = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const tree = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true);
  const statements = tree.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression));
  const middleware = statements.find(n => n.expression.expression.getText(tree) === 'app.use' && n.getText(tree).includes('pendingMutations++'));
  const paths = ['/api/recovery', '/api/recovery/apply', '/api/recovery/abandon', '/api/commands/crashRecovery'];
  const routes = statements.filter(n => paths.includes(n.expression.arguments[0]?.text));
  assert.equal(routes.length, 4);
  const app = express(); app.use(express.json());
  const localRecovery = {
    busy: false, status() { return { id: 'job', state: this.busy ? 'ready' : 'complete' }; },
    start() { this.busy = true; return this.status(); },
    async apply(id) { assert.equal(id, 'job'); this.busy = false; },
    async abandon() { this.busy = false; },
  };
  const backupFiles = { busy: false };
  const program = ts.transpileModule(`let pendingMutations = 0;\n${middleware.getText(tree)}\n${routes.map(n => n.getText(tree)).join('\n')}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(program, { app, localRecovery, backupFiles, certificateRenewal: { busy: false }, activeProcess: null, isStartSequenceInFlight: false,
    backupPreparing: false, fastSync: { busy: false, pending: false },
    networkStatus: {}, broadcastStatus() {}, broadcastLog() {} });
  for (const endpoint of ['/commands/start', '/commands/resetData', '/commands/fullReset', '/commands/clearLocks', '/backups', '/restore']) {
    app.post(`/api${endpoint}`, (_req, res) => res.json({ success: true }));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (url, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  backupFiles.busy = true;
  assert.equal((await post('/commands/crashRecovery')).status, 409);
  backupFiles.busy = false;
  assert.equal((await post('/commands/crashRecovery')).status, 202);
  for (const endpoint of ['/commands/crashRecovery', '/commands/start', '/commands/resetData', '/commands/fullReset', '/commands/clearLocks', '/backups', '/restore']) {
    assert.equal((await post(endpoint)).status, 409, endpoint);
  }
  assert.equal((await fetch(base + '/recovery')).status, 200);
  assert.equal((await post('/recovery/apply', { id: 'job' })).status, 200);
  assert.equal((await post('/commands/start')).status, 200);
});

test('preflight rejects PQC, wrong Mongo path, live writers and Docker failure', async t => {
  const root = fixture(t), node = path.join(root, 'nodes/api-node-0');
  for (const role of ['server', 'broker']) {
    const resources = path.join(node, `${role}-config/resources`);
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'config-user.properties'), 'dataDirectory = ./data\n');
    fs.writeFileSync(path.join(resources, 'config-node.properties'), 'fileDatabaseBatchSize = 1\nenableCacheDatabaseStorage = true\n');
    fs.writeFileSync(path.join(resources, 'config-network.properties'), 'enableVerifiableState = true\n');
    fs.writeFileSync(path.join(resources, 'config-extensions-recovery.properties'), 'extension.filespooling = true\nextension.mongo = false\nextension.zeromq = false\n');
    fs.writeFileSync(path.join(resources, 'config-extensions-broker.properties'), 'extension.mongo = true\n');
    fs.writeFileSync(path.join(resources, 'config-database.properties'), 'databaseName = catapult\n');
  }
  fs.mkdirSync(path.join(root, 'databases/db'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docker/mongo'), { recursive: true });
  index(path.join(node, 'data/index.dat'), 2n); block(path.join(node, 'data'), 2n);
  let image = 'symbol-server-patched:gcc-1.0.3.9', command = ['mongod', '--dbpath=/dbdata'], live = false, dockerFailed = false;
  const run = async args => {
    if (dockerFailed) throw new Error('Docker unavailable');
    if (args[0] === 'ps') return live ? 'live-id' : '';
    if (args[0] === 'inspect') return JSON.stringify([{ Name: '/api-node-0', State: { Running: true }, Mounts: [{ Type: 'bind', Source: root }] }]);
    if (args[0] === 'image') return JSON.stringify([{ Id: `sha256:${args.at(-1)}` }]);
    if (args[0] === 'compose') return JSON.stringify({ services: {
      server: { image, volumes: [{ type: 'bind', source: node, target: '/symbol-workdir' }] },
      broker: { image, volumes: [{ type: 'bind', source: node, target: '/symbol-workdir' }] },
      db: { image: 'mongo:5.0.15', command, volumes: [{ type: 'bind', source: path.join(root, 'databases/db'), target: '/dbdata' }] },
    } });
    throw new Error('Unexpected command');
  };
  const manager = new (loadModule('linux').LocalRecovery)(root, path.join(root, 'journal.json'), () => {}, run);
  const verified = await manager.preflight(); assert.equal(verified.height, 2n);
  image = 'nftdrive/bnl-catapult-server-pqc:1.0.3.9-bnl';
  await assert.rejects(manager.preflight(), /PQC/);
  image = 'symbol-server-patched:gcc-1.0.3.9'; command = ['mongod', '--dbpath=/data/db'];
  await assert.rejects(manager.preflight(), /actually use/);
  command = ['mongod', '--dbpath=/dbdata']; live = true;
  await assert.rejects(manager.preflight(), /Stop container/);
  live = false; dockerFailed = true;
  await assert.rejects(manager.preflight(), /Docker unavailable/);
  dockerFailed = false;
  fs.appendFileSync(path.join(node, 'server-config/resources/config-network.properties'), '# changed\n');
  assert.notEqual((await manager.preflight()).configHash, verified.configHash);
});
