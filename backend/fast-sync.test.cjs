const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable, PassThrough } = require('node:stream');
const ts = require('typescript');
const archiver = require('archiver');

function load(name) {
  const result = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, name + '.ts'), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports: result, Buffer, console, process, setTimeout,
    require: id => id === './local-recovery.js' ? load('local-recovery') : require(id) });
  return result;
}
const { FastSync, selectedPath, safeEntry, validateSnapshot, validateChain, assertFresh, runtimeProfile, createSnapshot } = load('fast-sync');
const { blockPath, blockHash } = load('local-recovery');
const { BackupFiles } = load('backup-files');
function put(file, contents) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
function index(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function block(h) { const b = Buffer.alloc(408); b.writeUInt32LE(376); b.writeBigUInt64LE(BigInt(h), 112); b.fill(h, 376); return b; }
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-fast-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target'), journal = path.join(root, 'fast-sync.json');
  const calls = [];
  let compose = {};
  const docker = async args => { calls.push(args); return args[0] === 'compose' ? JSON.stringify(compose) : (overrides.running || ''); };
  const service = () => new FastSync(target, journal, () => {}, docker, 'linux', async () => {}, overrides.swap);
  return { root, target, journal, calls, docker, service, sync: service(), setCompose: c => { compose = c; } };
}
function metadata() {
  return { version: 1, node: 'api-node-0', height: '2', genesis: '01'.repeat(32), tip: '02'.repeat(32),
    serverImage: 'symbol-server-patched:gcc-1.0.3.9', mongoImage: 'mongo:5.0.15',
    configuration: Object.fromEntries(['server/network', 'server/inflation', 'broker/network', 'broker/inflation'].map(k => [k, 'a'.repeat(64)])),
    identities: ['b'.repeat(64), 'c'.repeat(64)] };
}
function entries(meta = metadata()) {
  const files = {
    'backup-meta.json': JSON.stringify({ type: 'node-full-backup', full: true, fastSync: meta }),
    'blockdata/api-node-0/index.dat': index(2),
    'blockdata/api-node-0/00000/00001.dat': block(1),
    'blockdata/api-node-0/00000/00002.dat': block(2),
    'blockdata/api-node-0/state/state.dat': 'state-data',
    'blockdata/api-node-0/statedb/CURRENT': 'state-db-data',
    'databases/db/WiredTiger': 'mongo-data',
    'addresses.yml': 'SECRET', 'preset.yml': 'SECRET', 'custom-preset.yml': 'SECRET',
    'harvesters/api-node-0/harvesters.dat': 'SECRET',
    'blockdata/api-node-0/harvesters.dat': 'SECRET',
    'blockdata/api-node-0/voting/private_key_tree1.dat': 'SECRET',
    'blockdata/api-node-0/votes_backup/key.dat': 'SECRET',
    'blockdata/api-node-0/voting_status.dat': 'SECRET',
    'blockdata/api-node-0/transfer_message/private.dat': 'SECRET',
    'blockdata/api-node-0/spool/partial_transactions/private.dat': 'SECRET',
  };
  for (const q of ['block_change', 'state_change', 'finalization']) {
    files[`blockdata/api-node-0/spool/${q}/index.dat`] = index(2);
    files[`blockdata/api-node-0/spool/${q}/index_broker_r.dat`] = index(2);
  }
  return files;
}
async function zip(files, setup) {
  const a = archiver('zip', { forceZip64: true, store: true });
  const chunks = [];
  a.on('data', b => chunks.push(b));
  const completed = new Promise((resolve, reject) => { a.on('end', resolve); a.on('error', reject); });
  for (const [name, value] of Object.entries(files)) a.append(value, { name });
  if (setup) setup(a);
  await a.finalize(); await completed;
  return Buffer.concat(chunks);
}
async function settle(sync) {
  for (let i = 0; i < 400; i++) {
    if (!sync.busy) return sync.status();
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Import timed out');
}
async function imported(f, files = entries()) {
  await f.sync.receive(Readable.from(await zip(files)));
  return settle(f.sync);
}

test('freshness rejects any previously generated identity, data, restore, or unknown content', t => {
  const f = fixture(t);
  for (const name of ['addresses.yml', 'preset.yml', 'nodes', 'databases', '.pending-restore', 'unknown']) {
    put(path.join(f.target, name), 'existing');
    assert.throws(() => assertFresh(f.target), /first node start/);
    fs.rmSync(path.join(f.target, name));
  }
});
test('ZIP64 extraction imports chain data but excludes all source identities and private node data', async t => {
  const f = fixture(t), result = await imported(f);
  assert.equal(result.state, 'ready'); assert.equal(result.height, '2');
  const work = path.join(f.target, '.fast-sync');
  assert.equal(fs.existsSync(path.join(work, 'upload.zip')), false);
  function check(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) check(p); else assert.ok(!fs.readFileSync(p).includes(Buffer.from('SECRET')));
  } }
  check(work);
  assert.equal(blockHash(path.join(work, 'data'), 2n), '02'.repeat(32));
  assert.equal(f.service().status().state, 'ready');
  await f.sync.discard();
  assert.equal(f.sync.eligibility().available, true);
});
test('old, identity-only, wrong-image and malformed snapshots fail closed', async t => {
  for (const mutate of [f => { f['backup-meta.json'] = '{}'; }, f => { f['backup-meta.json'] = JSON.stringify({ type: 'node-backup', full: false }); },
    f => { const m = JSON.parse(f['backup-meta.json']); m.fastSync.serverImage = 'pqc:latest'; f['backup-meta.json'] = JSON.stringify(m); },
    f => { delete f['blockdata/api-node-0/index.dat']; }, f => { f['blockdata/api-node-0/00000/00002.dat'] = block(3); },
    f => { f['blockdata/api-node-0/spool/block_change/index_broker_r.dat'] = index(1); },
    f => { delete f['databases/db/WiredTiger']; }]) {
    const f = fixture(t), files = entries(); mutate(files);
    assert.equal((await imported(f, files)).state, 'failed');
    assert.throws(() => f.sync.assertStart(), /not ready/);
    assert.equal(fs.existsSync(path.join(f.target, 'nodes')), false);
  }
});
test('unsafe paths, encryption, links and special files are rejected', () => {
  const normal = { fileName: 'a/b.dat', externalFileAttributes: 0, generalPurposeBitFlag: 0, uncompressedSize: 2 };
  for (const fileName of ['../escape', '/absolute', 'C:/escape', 'a/../../escape', 'a\\escape', 'a\0b']) {
    assert.throws(() => safeEntry({ ...normal, fileName }), /Unsafe/);
  }
  for (const mode of [0xa000, 0x1000, 0x6000]) assert.throws(() => safeEntry({ ...normal, externalFileAttributes: mode << 16 }), /Links/);
  assert.throws(() => safeEntry({ ...normal, generalPurposeBitFlag: 1 }), /Unsupported/);
});
test('archive duplicates, symlinks, CRC damage and truncated archives do not become ready', async t => {
  for (const kind of ['duplicate', 'link', 'crc', 'truncated']) {
    const f = fixture(t);
    let buffer = await zip(entries(), a => {
      if (kind === 'duplicate') a.append('again', { name: 'backup-meta.json' });
      if (kind === 'link') a.symlink('escape-link', '../../escape');
    });
    if (kind === 'crc') buffer[buffer.indexOf(Buffer.from('mongo-data'))] ^= 1;
    if (kind === 'truncated') buffer = buffer.subarray(0, buffer.length - 80);
    await f.sync.receive(Readable.from(buffer));
    assert.equal((await settle(f.sync)).state, 'failed', kind);
  }
});
test('interruption locks start and never automatically installs staged data', t => {
  const f = fixture(t);
  for (const state of ['uploading', 'extracting', 'installing']) {
    put(f.journal, JSON.stringify({ state, bytes: 0, files: 0 }));
    const sync = f.service();
    assert.equal(sync.status().state, state === 'installing' ? 'manual' : 'failed');
    assert.throws(() => sync.assertStart(), /not ready/);
  }
  put(f.journal, '{bad json'); assert.equal(f.service().status().state, 'manual');
});
test('concurrent uploads, live containers and aborted uploads cannot proceed', async t => {
  const f = fixture(t), stream = new PassThrough();
  const first = f.sync.receive(stream);
  await assert.rejects(f.sync.receive(Readable.from('x')), /already exists/);
  await new Promise(resolve => setImmediate(resolve));
  stream.destroy(new Error('aborted'));
  await assert.rejects(first, /aborted/); assert.equal(f.sync.status().state, 'failed');
  const live = fixture(t, { running: 'broker' });
  await assert.rejects(live.sync.receive(Readable.from('x')), /Stop all/);
});

function generated(f) {
  const node = path.join(f.target, 'nodes/api-node-0');
  for (const role of ['server', 'broker']) {
    const base = path.join(node, role + '-config/resources');
    put(path.join(base, 'config-network.properties'), '[network]\ngenerationHashSeed = abc\n[chain]\nenableVerifiableState = true\n');
    put(path.join(base, 'config-inflation.properties'), '[inflation]\nstarting-at-height-1 = 0\n');
    put(path.join(base, 'config-node.properties'), '[node]\nfileDatabaseBatchSize = 1\nenableCacheDatabaseStorage = true\n');
    put(path.join(base, 'config-user.properties'), '[storage]\ndataDirectory = ./data\n');
    put(path.join(base, 'config-database.properties'), '[database]\ndatabaseName = catapult\n');
  }
  put(path.join(node, 'data/index.dat'), index(1));
  put(blockPath(path.join(node, 'data'), 1n), block(1));
  fs.mkdirSync(path.join(f.target, 'databases/db'), { recursive: true });
  const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');
  for (const name of ['ca.cert.pem', 'node.crt.pem']) {
    const key = crypto.generateKeyPairSync('ed25519').privateKey;
    const keyFile = path.join(node, 'cert', name + '.key');
    put(keyFile, key.export({ format: 'pem', type: 'pkcs8' }));
    execFileSync(openssl, ['req', '-new', '-x509', '-key', keyFile, '-subj', '/CN=Fast Sync test', '-days', '1', '-out', path.join(node, 'cert', name)], { stdio: 'pipe' });
  }
  f.setCompose({ services: {
    server: { user: '0:0', image: 'symbol-server-patched:gcc-1.0.3.9', volumes: [{ type: 'bind', source: node, target: '/symbol-workdir' }] },
    broker: { user: '0:0', image: 'symbol-server-patched:gcc-1.0.3.9', volumes: [{ type: 'bind', source: node, target: '/symbol-workdir' }] },
    db: { image: 'mongo:5.0.15', command: ['mongod', '--dbpath=/dbdata'], volumes: [{ type: 'bind', source: path.join(f.target, 'databases/db'), target: '/dbdata' }] },
  } });
  return node;
}
async function readyGenerated(t, overrides) {
  const f = fixture(t, overrides);
  await imported(f);
  const node = generated(f);
  const profile = await runtimeProfile(f.target, f.docker);
  const snapshot = { ...metadata(), configuration: profile.configuration };
  put(path.join(f.target, '.fast-sync/snapshot.json'), JSON.stringify(snapshot));
  return { ...f, node, profile, snapshot };
}
test('first start installs both datasets together and keeps independently generated keys', async t => {
  const f = await readyGenerated(t);
  const cert = fs.readFileSync(path.join(f.node, 'cert/ca.cert.pem'));
  await f.sync.install();
  assert.equal(f.sync.status().state, 'complete');
  assert.equal(blockHash(path.join(f.node, 'data'), 2n), f.snapshot.tip);
  assert.equal(fs.readFileSync(path.join(f.target, 'databases/db/WiredTiger'), 'utf8'), 'mongo-data');
  assert.deepEqual(fs.readFileSync(path.join(f.node, 'cert/ca.cert.pem')), cert);
  assert.equal(fs.existsSync(path.join(f.target, '.fast-sync/original-data/index.dat')), true);
  const snapshot = await createSnapshot(f.target, f.docker);
  assert.equal(snapshot.height, '2'); assert.deepEqual(snapshot.identities, f.profile.identities);
});
test('network, Nemesis, source identity, storage and existing MongoDB mismatches block installation', async t => {
  for (const kind of ['network', 'genesis', 'keys', 'storage', 'mongo', 'height']) {
    const f = await readyGenerated(t);
    if (kind === 'network') put(path.join(f.node, 'server-config/resources/config-inflation.properties'), '[inflation]\nstarting-at-height-1 = 1');
    if (kind === 'genesis') put(blockPath(path.join(f.node, 'data'), 1n), block(4));
    if (kind === 'keys') put(path.join(f.target, '.fast-sync/snapshot.json'), JSON.stringify({ ...f.snapshot, identities: f.profile.identities }));
    if (kind === 'storage') put(path.join(f.node, 'server-config/resources/config-node.properties'), '[node]\nfileDatabaseBatchSize = 100\nenableCacheDatabaseStorage = true');
    if (kind === 'mongo') put(path.join(f.target, 'databases/db/existing'), 'keep');
    if (kind === 'height') put(path.join(f.node, 'data/index.dat'), index(5));
    await assert.rejects(f.sync.install(), undefined, kind);
    assert.equal(f.sync.status().state, 'ready');
    assert.equal(fs.existsSync(path.join(f.target, '.fast-sync/data/index.dat')), true);
  }
});
test('installation failure is persistently blocked for manual inspection', async t => {
  const f = await readyGenerated(t, { swap: () => { throw new Error('disk failure'); } });
  await assert.rejects(f.sync.install(), /disk failure/);
  assert.equal(f.sync.status().state, 'manual');
  assert.equal(f.service().status().state, 'manual');
  await assert.rejects(f.sync.discard(), /Cannot discard/);
});
test('startup integration preserves staging and installs before node run', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  assert.match(server, /STASH_SKIP = new Set\([^\n]*'\.fast-sync'/);
  assert.match(server, /if \(fastSync.pending\) startMode = 'full'/);
  const install = server.indexOf('await fastSync.install()');
  assert.ok(install > server.indexOf('// Step 4f2:'));
  assert.ok(install < server.indexOf('// Step 5: symbol-bootstrap run'));
  assert.match(server, /fastSync\.busy/);
});

test('actual Fast Sync routes enforce trust, content type, busy guards and persistent status', async t => {
  const f = fixture(t), express = require('express');
  const source = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const statements = tree.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression));
  const middleware = statements.find(n => n.getText(tree).includes('pendingMutations++'));
  const routes = statements.filter(n => n.expression.arguments[0]?.text === '/api/fast-sync');
  assert.equal(routes.length, 3);
  const app = express(); app.use(express.json());
  const backupFiles = { busy: false };
  const context = { app, fastSync: f.sync, backupPreparing: false, backupFiles, localRecovery: { busy: false },
    certificateRenewal: { busy: false }, activeProcess: null, isStartSequenceInFlight: false, networkStatus: { state: 'stopped' } };
  vm.runInNewContext(ts.transpileModule('let pendingMutations=0;\n' + middleware.getText(tree) + '\n' + routes.map(n => n.getText(tree)).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  app.post('/api/restore', (_q, s) => s.json({ ok: true }));
  app.post('/api/preset', (_q, s) => s.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/fast-sync`;
  const body = await zip(entries());
  const options = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Fast-Sync-Trusted': 'yes' }, body };
  assert.equal((await fetch(url, { ...options, headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
  assert.equal((await fetch(url, { ...options, headers: { 'Content-Type': 'text/plain', 'X-Fast-Sync-Trusted': 'yes' } })).status, 415);
  backupFiles.busy = true; assert.equal((await fetch(url, options)).status, 409); backupFiles.busy = false;
  assert.equal((await fetch(url, options)).status, 202);
  assert.equal((await settle(f.sync)).state, 'ready');
  assert.equal((await (await fetch(url)).json()).job.state, 'ready');
  assert.equal((await fetch(url.replace('fast-sync', 'restore'), { method: 'POST' })).status, 409);
  assert.equal((await fetch(url.replace('fast-sync', 'preset'), { method: 'POST' })).status, 200);
  assert.equal((await fetch(url, options)).status, 409);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(url)).json()).available, true);
});

test('distribution export contains only selected data and round-trips through Fast Sync', async t => {
  const f = fixture(t), source = path.join(f.root, 'source');
  const files = { ...entries(),
    'databases/db/private.key.pem': 'SECRET', 'databases/db/diagnostic.data/private-log': 'SECRET',
    'databases/db/collection-1-123.wt': 'collection-data', 'databases/db/index-2--123.wt': 'index-data',
    'databases/db/journal/WiredTigerLog.0000000001': 'journal-data',
    'blockdata/api-node-0/spool/state_change/0000000000000001.dat': 'consumed-state',
  };
  for (const [name, contents] of Object.entries(files)) put(path.join(source, name), contents);
  const store = new BackupFiles(path.join(f.root, 'exports'));
  const meta = { formatVersion: 1, type: 'node-fast-sync', full: false, fastSync: metadata() };
  assert.throws(() => store.start(true, [], [], meta), /filtered directories/);
  const job = store.start(true, [], [
    { diskPath: path.join(source, 'blockdata/api-node-0'), zipPath: 'blockdata/api-node-0' },
    { diskPath: path.join(source, 'databases/db'), zipPath: 'databases/db' },
  ], meta, name => selectedPath(name, 'api-node-0') !== null);
  while (store.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal(store.get(job.id).state, 'ready', store.get(job.id).error);
  assert.equal(job.kind, 'fast-sync'); assert.match(job.filename, /^node-fast-sync-/);
  const zipFile = new (require('adm-zip'))(store.filePath(job.id));
  for (const entry of zipFile.getEntries()) {
    assert.ok(entry.entryName === 'backup-meta.json' || selectedPath(entry.entryName, 'api-node-0'));
    assert.ok(!entry.getData().includes(Buffer.from('SECRET')), entry.entryName);
  }
  assert.equal(zipFile.getEntry('custom-preset.yml'), null);
  assert.equal(zipFile.getEntry('addresses.yml'), null);
  assert.equal(zipFile.getEntry('blockdata/api-node-0/voting/private_key_tree1.dat'), null);
  assert.ok(zipFile.getEntry('databases/db/collection-1-123.wt'));
  assert.ok(zipFile.getEntry('databases/db/journal/WiredTigerLog.0000000001'));
  await f.sync.receive(fs.createReadStream(store.filePath(job.id)));
  assert.equal((await settle(f.sync)).state, 'ready');
  assert.equal(new BackupFiles(path.join(f.root, 'exports')).get(job.id).kind, 'fast-sync');
});

test('distribution export refuses linked data and never publishes a partial ZIP', async t => {
  const f = fixture(t), source = path.join(f.root, 'source'), secret = path.join(f.root, 'secret');
  put(secret, 'SECRET'); fs.mkdirSync(source);
  fs.linkSync(secret, path.join(source, 'WiredTiger'));
  const store = new BackupFiles(path.join(f.root, 'exports'));
  const job = store.start(true, [], [{ diskPath: source, zipPath: 'databases/db' }],
    { type: 'node-fast-sync', full: false, fastSync: metadata() }, name => selectedPath(name, 'api-node-0') !== null);
  while (store.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal(store.get(job.id).state, 'failed');
  assert.equal(fs.existsSync(store.filePath(job.id)), false);
  assert.equal(fs.existsSync(store.filePath(job.id) + '.part'), false);
});

test('dedicated export API fails closed on incompatible snapshots instead of falling back to full backup', async t => {
  const f = fixture(t), express = require('express');
  const text = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const tree = ts.createSourceFile('server.ts', text, ts.ScriptTarget.Latest, true);
  const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(tree) === 'app.post' && n.expression.arguments[0]?.text === '/api/backups');
  const app = express(); app.use(express.json());
  let compatible = false;
  const backupFiles = new BackupFiles(path.join(f.root, 'exports'));
  for (const [name, data] of Object.entries(entries())) {
    if (name.startsWith('blockdata/api-node-0/')) put(path.join(f.target, 'nodes/api-node-0/data', name.slice('blockdata/api-node-0/'.length)), data);
    if (name.startsWith('databases/')) put(path.join(f.target, name), data);
  }
  vm.runInNewContext(ts.transpileModule(route.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { app, backupFiles, backupPreparing: false, pendingMutations: 0, activeProcess: null, isStartSequenceInFlight: false,
      networkStatus: { state: 'stopped' }, execSync: () => '', NODE_CONTAINER_NAMES: ['db', 'broker'],
      createSnapshot: async () => { if (!compatible) throw new Error('Unclean source'); return metadata(); },
      selectedPath, TARGET_DIR: f.target, fs, path, broadcastLog: () => {} });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const post = kind => fetch(`http://127.0.0.1:${server.address().port}/api/backups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
  assert.equal((await post('unknown')).status, 400);
  assert.equal((await post('fast-sync')).status, 409); assert.equal(backupFiles.list().length, 0);
  compatible = true;
  const response = await post('fast-sync'); assert.equal(response.status, 202);
  const job = await response.json(); assert.equal(job.kind, 'fast-sync');
  while (backupFiles.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal(backupFiles.get(job.id).state, 'ready');
  const rejectPosition = text.indexOf("Fast Sync packages cannot be used for identity restore");
  const cleanupPosition = text.indexOf('// ── Step 0: Clean existing runtime data');
  assert.ok(rejectPosition > 0 && rejectPosition < cleanupPosition);
});
