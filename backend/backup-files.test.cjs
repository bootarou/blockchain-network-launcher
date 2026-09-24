const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const AdmZip = require('adm-zip');
const express = require('express');

function evaluate(source, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  vm.runInNewContext(compiled.outputText, { exports, require, console, Buffer, ...globals });
  return exports;
}
const source = fs.readFileSync(path.join(__dirname, 'backup-files.ts'), 'utf8');
const { BackupFiles } = evaluate(source);
const serverSource = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
const tree = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true);
function route(method, routePath) {
  const node = tree.statements.find(n => ts.isExpressionStatement(n)
    && ts.isCallExpression(n.expression) && n.expression.expression.getText(tree) === `app.${method}`
    && n.expression.arguments[0]?.text === routePath);
  assert.ok(node, `Missing ${method} ${routePath}`);
  return node.getText(tree);
}
function fixture(t, Type = BackupFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-backup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'backups');
  const input = path.join(root, 'preset.yml');
  fs.writeFileSync(input, 'network: test\n');
  return { root, directory, input, store: new Type(directory) };
}
async function complete(store, id) {
  const deadline = Date.now() + 10000;
  while (store.busy && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.equal(store.busy, false, 'Backup did not finish');
  return store.get(id);
}

test('creates a persistent ZIP64 archive, preserves restore paths, excludes runtime locks', async t => {
  const { root, directory, input, store } = fixture(t);
  const data = path.join(root, 'data');
  fs.mkdirSync(data);
  for (const name of ['00001.dat', 'mongod.lock', 'server-recovery.started']) fs.writeFileSync(path.join(data, name), name);
  const meta = { formatVersion: 1, type: 'node-full-backup', full: true };
  const job = store.start(true, [{ diskPath: input, zipPath: 'custom-preset.yml' }], [{ diskPath: data, zipPath: 'blockdata/api-node-0' }], meta);
  assert.equal(job.state, 'creating');
  assert.throws(() => store.start(false, [], [], {}), /already/);
  assert.throws(() => store.remove(job.id), /being created/);
  const ready = await complete(store, job.id);
  assert.equal(ready.state, 'ready', ready.error);
  const zipBytes = fs.readFileSync(store.filePath(job.id));
  assert.equal(ready.bytes, zipBytes.length);
  assert.notEqual(zipBytes.indexOf(Buffer.from('504b0606', 'hex')), -1, 'ZIP64 end record');
  const zip = new AdmZip(zipBytes);
  assert.deepEqual(JSON.parse(zip.readAsText('backup-meta.json')), meta);
  assert.equal(zip.readAsText('custom-preset.yml'), 'network: test\n');
  assert.equal(zip.readAsText('blockdata/api-node-0/00001.dat'), '00001.dat');
  assert.equal(zip.getEntries().some(e => /\.lock$|server-recovery\.started$/.test(e.entryName)), false);
  assert.equal(fs.existsSync(store.filePath(job.id) + '.part'), false);
  const restarted = new BackupFiles(directory);
  assert.equal(restarted.get(job.id).state, 'ready');
  assert.equal(restarted.get(job.id).bytes, zipBytes.length);
  restarted.remove(job.id);
  assert.equal(restarted.list().length, 0);
  assert.equal(fs.existsSync(store.filePath(job.id)), false);
});

test('missing input fails without leaving a downloadable or partial archive; next attempt works', async t => {
  const { root, input, store } = fixture(t);
  const job = store.start(false, [{ diskPath: path.join(root, 'missing'), zipPath: 'missing' }], [], {});
  const failed = await complete(store, job.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /ENOENT/);
  assert.equal(fs.existsSync(store.filePath(job.id)), false);
  assert.equal(fs.existsSync(store.filePath(job.id) + '.part'), false);
  const next = store.start(false, [{ diskPath: input, zipPath: 'custom-preset.yml' }], [], {});
  assert.equal((await complete(store, next.id)).state, 'ready');
});

test('restart marks unfinished jobs failed and keeps completed files intact', async t => {
  const { directory, input, store } = fixture(t);
  const ready = store.start(false, [{ diskPath: input, zipPath: 'custom-preset.yml' }], [], {});
  await complete(store, ready.id);
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({ id, state: 'creating' }));
  fs.writeFileSync(path.join(directory, `${id}.zip.part`), 'incomplete');
  const restarted = new BackupFiles(directory);
  assert.equal(restarted.get(id).state, 'failed');
  assert.equal(restarted.get(ready.id).state, 'ready');
  assert.equal(fs.existsSync(path.join(directory, `${id}.zip.part`)), false);
  assert.throws(() => restarted.filePath('../secret'), /Invalid/);
  assert.throws(() => restarted.remove('../secret'), /not found/);
});

test('disk write errors release the lock and do not publish incomplete output', async t => {
  const { Writable } = require('node:stream');
  const fakeFs = { ...fs, createWriteStream: () => new Writable({ write(_c, _e, cb) { cb(new Error('ENOSPC')); } }) };
  const { BackupFiles: FailingFiles } = evaluate(source, { require: name => name === 'fs' ? fakeFs : require(name) });
  const { store, input } = fixture(t, FailingFiles);
  const job = store.start(false, [{ diskPath: input, zipPath: 'custom-preset.yml' }], [], {});
  const failed = await complete(store, job.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /ENOSPC/);
  assert.equal(fs.existsSync(store.filePath(job.id)), false);
});

test('actual download route supports Range/resume, rejects unfinished/unknown jobs, and never recompresses', async t => {
  const { store, input } = fixture(t);
  const job = store.start(false, [{ diskPath: input, zipPath: 'custom-preset.yml' }], [], {});
  await complete(store, job.id);
  const expected = fs.readFileSync(store.filePath(job.id));
  const app = express();
  evaluate(route('get', '/api/backups/:id/download'), { app, backupFiles: store });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/backups/${job.id}/download`;
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), expected.length);
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const first = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(first.status, 206);
  const rest = await fetch(url, { headers: { Range: 'bytes=100-', 'If-Range': head.headers.get('last-modified') } });
  assert.equal(rest.status, 206);
  const joined = Buffer.concat([Buffer.from(await first.arrayBuffer()), Buffer.from(await rest.arrayBuffer())]);
  assert.deepEqual(joined, expected);
  assert.equal(store.list().length, 1);
  assert.equal((await fetch(url.replace(job.id, crypto.randomUUID()))).status, 404);
  assert.equal((await fetch(url, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  const originalGet = store.get.bind(store);
  store.get = id => ({ ...originalGet(id), state: 'creating' });
  assert.equal((await fetch(url)).status, 409);
});

test('creation refuses running containers, Docker failures and competing mutations; middleware locks node commands', async t => {
  const { root, store, input } = fixture(t);
  const app = express();
  app.use(express.json());
  let dockerOutput = '';
  const nodeState = { state: 'stopped' };
  const middleware = tree.statements.find(n => ts.isExpressionStatement(n)
    && ts.isCallExpression(n.expression) && n.expression.expression.getText(tree) === 'app.use'
    && n.getText(tree).includes('pendingMutations++'));
  assert.ok(middleware);
  const handlers = evaluate(`let pendingMutations = 0;\n${middleware.getText(tree)}\n${route('post', '/api/backups')}\nexport function pending() { return pendingMutations; }`, {
    app, backupFiles: store, localRecovery: { busy: false }, activeProcess: null, isStartSequenceInFlight: false,
    networkStatus: nodeState, broadcastLog() {}, fs, path,
    PRESET_PATH: input, UI_META_PATH: path.join(root, 'no-meta'), TARGET_DIR: path.join(root, 'target'),
    NODE_CONTAINER_NAMES: ['db', 'api-node-0'],
    execSync() { if (dockerOutput === 'error') throw new Error('Docker unavailable'); return dockerOutput; },
  });
  let pendingResponse;
  app.post('/api/preset', (_req, res) => { pendingResponse = res; });
  app.post('/api/commands/start', (_req, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const create = full => fetch(`${base}/api/backups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full }) });
  dockerOutput = 'db\n';
  assert.equal((await create(true)).status, 409);
  dockerOutput = 'error';
  assert.equal((await create(true)).status, 500);
  dockerOutput = '';
  nodeState.state = 'running';
  assert.equal((await create(true)).status, 409);
  nodeState.state = 'stopped';
  const mutation = fetch(`${base}/api/preset`, { method: 'POST' });
  while (!pendingResponse) await new Promise(r => setTimeout(r, 5));
  assert.equal(handlers.pending(), 1);
  assert.equal((await create(false)).status, 409);
  pendingResponse.json({ success: true });
  await mutation;
  assert.equal(handlers.pending(), 0);
  // Force a busy state to exercise the real guard without depending on ZIP timing.
  Object.defineProperty(store, 'busy', { get: () => true, configurable: true });
  assert.equal((await fetch(`${base}/api/commands/start`, { method: 'POST' })).status, 409);
  assert.equal((await create(false)).status, 409);
  delete store.busy;
  const created = await create(true);
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.equal((await complete(store, job.id)).state, 'ready');
  assert.equal((await fetch(`${base}/api/commands/start`, { method: 'POST' })).status, 200);
});
