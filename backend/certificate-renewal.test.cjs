const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync, execFile } = require('node:child_process');
const ts = require('typescript');
const yaml = require('js-yaml');
const express = require('express');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, name + '.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, { exports, Buffer, process, structuredClone, setTimeout, console,
    require: name => name.startsWith('./') ? load(name.slice(2, -3)) : require(name) });
  return cache[name] = exports;
}
const { CertificateRenewal, CertificateError, redactBootstrapArgs, secretLogFilter } = load('certificate-renewal');
const { switchDirectories } = load('local-recovery');
const openssl = process.env.OPENSSL || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');
function encrypt(value) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync('test-password', salt, 1024, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return 'ENCRYPTED:' + salt.toString('hex') + iv.toString('hex') + Buffer.concat([cipher.update(value), cipher.final()]).toString('base64');
}
function fixture(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-cert-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target'), cert = path.join(target, 'nodes', 'api-node-0', 'cert');
  const rest = path.join(target, 'gateways', 'rest-gateway', 'api-node-config', 'cert');
  fs.mkdirSync(cert, { recursive: true }); fs.mkdirSync(rest, { recursive: true });
  const ca = crypto.generateKeyPairSync('ed25519').privateKey;
  const node = crypto.generateKeyPairSync('ed25519').privateKey;
  const caFile = path.join(root, 'ca.key');
  fs.writeFileSync(caFile, ca.export({ format: 'pem', type: 'pkcs8' }));
  fs.writeFileSync(path.join(cert, 'node.key.pem'), node.export({ format: 'pem', type: 'pkcs8' }));
  const ssl = args => execFileSync(openssl, args, { stdio: 'pipe' });
  ssl(['req', '-new', '-x509', '-key', caFile, '-subj', '/CN=Test CA', '-days', '30',
    '-addext', 'basicConstraints=critical,CA:true', '-out', path.join(cert, 'ca.cert.pem')]);
  ssl(['req', '-new', '-key', path.join(cert, 'node.key.pem'), '-subj', '/CN=Test node', '-out', path.join(root, 'node.csr')]);
  ssl(['x509', '-req', '-in', path.join(root, 'node.csr'), '-CA', path.join(cert, 'ca.cert.pem'), '-CAkey', caFile,
    '-set_serial', '23', '-days', '2', '-out', path.join(cert, 'node.crt.pem')]);
  fs.writeFileSync(path.join(cert, 'node.full.crt.pem'), fs.readFileSync(path.join(cert, 'node.crt.pem'), 'utf8') + fs.readFileSync(path.join(cert, 'ca.cert.pem'), 'utf8'));
  fs.writeFileSync(path.join(cert, 'metadata.yml'), 'version: 1\n');
  for (const file of fs.readdirSync(cert)) fs.copyFileSync(path.join(cert, file), path.join(rest, file));
  fs.writeFileSync(path.join(rest, 'rest-ca.cert.pem'), 'legacy');
  const raw = key => key.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
  const addresses = { nodes: [{ name: 'api-node-0', main: { privateKey: encrypt(raw(ca)) }, transport: { privateKey: encrypt(raw(node)) } }] };
  fs.writeFileSync(path.join(target, 'addresses.yml'), yaml.dump(addresses));
  fs.writeFileSync(path.join(target, 'preset.yml'), yaml.dump({ nodeCertificateExpirationInDays: 10, caCertificateExpirationInDays: 100,
    symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.9' }));
  const journal = path.join(root, 'journal.json'), preset = path.join(root, 'custom.yml');
  const logs = [], calls = [];
  const containers = [{ Name: '/api-node-0', Mounts: [{ Source: path.join(target, 'nodes', 'api-node-0') }], State: { Status: 'exited' } }];
  const run = async (program, args, input) => {
    calls.push({ program, args });
    if (opts.run) { const result = await opts.run(program, args, input); if (result !== undefined) return result; }
    if (program === 'docker') return args[0] === 'ps' ? 'fake-id' : JSON.stringify(containers);
    return new Promise((resolve, reject) => {
      const child = execFile(program, args, { timeout: 15000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
      child.stdin.end(input || '');
    });
  };
  const service = () => new CertificateRenewal(target, preset, journal, m => logs.push(m), run, openssl, opts.switchDirs || switchDirectories);
  return { root, target, cert, rest, journal, preset, addresses, logs, calls, containers, service, store: service(), ca, node };
}
function read(dir, file) { return fs.readFileSync(path.join(dir, file)); }
const x509 = (dir, file) => new crypto.X509Certificate(read(dir, file));

test('CA renewal preserves both identities, extends validity, syncs REST and retains originals', async t => {
  const f = fixture(t);
  const oldCa = read(f.cert, 'ca.cert.pem'), oldNode = read(f.cert, 'node.crt.pem'), key = read(f.cert, 'node.key.pem');
  const result = await f.store.renew('test-password', 'ca');
  assert.equal(result.success, true); assert.equal(result.caRenewed, true);
  const ca = x509(f.cert, 'ca.cert.pem'), leaf = x509(f.cert, 'node.crt.pem');
  assert.equal(ca.publicKey.equals(crypto.createPublicKey(f.ca)), true);
  assert.equal(leaf.publicKey.equals(crypto.createPublicKey(f.node)), true);
  assert.ok(Date.parse(ca.validTo) > Date.parse(new crypto.X509Certificate(oldCa).validTo));
  assert.equal(leaf.verify(ca.publicKey), true);
  assert.deepEqual(read(f.cert, 'node.key.pem'), key);
  for (const name of ['ca.cert.pem', 'node.crt.pem', 'node.key.pem', 'node.full.crt.pem']) assert.deepEqual(read(f.rest, name), read(f.cert, name));
  assert.deepEqual(read(path.join(result.backupDir, 'node'), 'ca.cert.pem'), oldCa);
  assert.deepEqual(read(path.join(result.backupDir, 'node'), 'node.crt.pem'), oldNode);
  assert.equal(fs.existsSync(path.join(f.rest, 'rest-ca.cert.pem')), false);
  assert.equal(fs.existsSync(path.join(f.store.status().work, 'keys')), false);
  assert.equal(f.store.status().state, 'complete'); assert.equal(f.store.busy, false);
  assert.equal(JSON.stringify(f.calls).includes('test-password'), false);
  assert.equal(f.logs.join('').includes('test-password'), false);
});
test('node-only renewal keeps CA certificate and caps validity to the existing CA', async t => {
  const f = fixture(t), ca = read(f.cert, 'ca.cert.pem');
  fs.writeFileSync(f.preset, 'nodeCertificateExpirationInDays: 100\n');
  const result = await f.store.renew('test-password', 'node', true);
  assert.equal(result.renewed, true); assert.equal(result.caRenewed, false);
  assert.deepEqual(read(f.cert, 'ca.cert.pem'), ca);
  assert.ok(Date.parse(x509(f.cert, 'node.crt.pem').validTo) <= Date.parse(x509(f.cert, 'ca.cert.pem').validTo));
});
test('not due: keeps certificate, still synchronizes REST', async t => {
  const f = fixture(t), original = read(f.cert, 'node.crt.pem');
  fs.writeFileSync(f.preset, 'certificateWarningInDays: 1\n');
  fs.writeFileSync(path.join(f.rest, 'node.crt.pem'), 'stale');
  const result = await f.store.renew('test-password');
  assert.equal(result.renewed, false);
  assert.deepEqual(read(f.cert, 'node.crt.pem'), original);
  assert.deepEqual(read(f.rest, 'node.crt.pem'), original);
});
for (const [name, change, code] of [
  ['wrong password', () => {}, 'INVALID_PASSWORD'],
  ['missing signing key', f => { delete f.addresses.nodes[0].main.privateKey; }, 'MISSING_PRIVATE_KEYS'],
  ['wrong signing key', f => { f.addresses.nodes[0].main.privateKey = '12'.repeat(32); }, 'CERTIFICATE_KEY_MISMATCH'],
  ['multiple nodes', f => { f.addresses.nodes.push(f.addresses.nodes[0]); }, 'SINGLE_NODE_REQUIRED'],
]) test(name + ' fails before mutation', async t => {
  const f = fixture(t), original = read(f.cert, 'ca.cert.pem'); change(f);
  fs.writeFileSync(path.join(f.target, 'addresses.yml'), yaml.dump(f.addresses));
  await assert.rejects(f.store.renew(name === 'wrong password' ? 'wrong' : 'test-password', 'ca'), e => e.code === code);
  assert.deepEqual(read(f.cert, 'ca.cert.pem'), original); assert.equal(f.store.busy, false);
});
test('running and paused target containers block renewal', async t => {
  const f = fixture(t);
  for (const status of ['running', 'paused', 'restarting']) {
    f.containers[0].State.Status = status;
    await assert.rejects(f.store.renew('test-password', 'ca'), e => e.code === 'NODE_RUNNING');
  }
  assert.equal(f.calls.some(c => c.program === openssl), false);
});
test('Docker unavailable fails closed', async t => {
  const f = fixture(t, { run: async program => { if (program === 'docker') throw new Error('unavailable'); } });
  await assert.rejects(f.store.renew('test-password', 'ca'));
  assert.equal(f.calls.some(c => c.program === openssl), false);
});
test('signing failure leaves original node and REST files intact, no key files remain', async t => {
  const f = fixture(t, { run: async program => { if (program !== 'docker') throw new Error('secret signing output'); } });
  const original = read(f.cert, 'ca.cert.pem');
  await assert.rejects(f.store.renew('test-password', 'ca'), e => e.code === 'CERTIFICATE_RENEWAL_FAILED');
  assert.deepEqual(read(f.cert, 'ca.cert.pem'), original);
  assert.deepEqual(read(f.rest, 'ca.cert.pem'), original);
  assert.equal(fs.existsSync(path.join(f.store.status().work, 'keys')), false);
  assert.equal(f.logs.join('').includes('secret signing output'), false);
});
test('REST cutover failure rolls back node and REST, then blocks further mutations for inspection', async t => {
  let count = 0;
  const f = fixture(t, { switchDirs: pairs => switchDirectories(pairs, (a, b) => {
    if (++count === 4) throw new Error('REST rename failure'); fs.renameSync(a, b);
  }) });
  const original = read(f.cert, 'ca.cert.pem');
  await assert.rejects(f.store.renew('test-password', 'ca'));
  assert.deepEqual(read(f.cert, 'ca.cert.pem'), original);
  assert.deepEqual(read(f.rest, 'ca.cert.pem'), original);
  assert.equal(f.store.status().state, 'manual'); assert.equal(f.store.busy, true);
  assert.equal(f.service().busy, true);
});
test('interrupted applying/corrupt journals fail closed after manager restart', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.journal, JSON.stringify({ state: 'applying', mode: 'ca', work: 'test', pairs: [] }));
  assert.equal(f.service().status().state, 'manual');
  fs.writeFileSync(f.journal, '{bad'); assert.equal(f.service().busy, true);
});
test('concurrent renewal rejected while Docker check is pending', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const f = fixture(t, { run: async program => { if (program === 'docker') await gate; } });
  const first = f.store.renew('test-password', 'ca');
  await assert.rejects(f.store.renew('test-password', 'ca'), e => e.code === 'CERTIFICATE_RENEWAL_ACTIVE');
  release(); await first;
});
test('bootstrap display arguments redact both password forms', () => {
  assert.equal(redactBootstrapArgs(['--password=secret', '--force']).join(' '), '--password=[REDACTED] --force');
  assert.equal(redactBootstrapArgs(['--password', 'secret']).join(' '), '--password [REDACTED]');
});
test('bootstrap output redacts passwords split across stdout chunks', () => {
  let output = '';
  const log = secretLogFilter(['--password=secret-password'], s => { output += s; });
  log('begin sec'); log('ret-pass'); log('word end'); log('', true);
  assert.equal(output, 'begin [REDACTED] end');
});
test('target container starting during signing prevents cutover', async t => {
  const f = fixture(t, { run: async program => { if (program === openssl) f.containers[0].State.Status = 'running'; } });
  const original = read(f.cert, 'ca.cert.pem');
  await assert.rejects(f.store.renew('test-password', 'ca'), e => e.code === 'NODE_RUNNING');
  assert.deepEqual(read(f.cert, 'ca.cert.pem'), original);
});
test('CA renewal also verifies new leaf against the old CA with the same public key', async t => {
  const f = fixture(t), old = path.join(f.root, 'old-ca.pem');
  fs.writeFileSync(old, read(f.cert, 'ca.cert.pem'));
  await f.store.renew('test-password', 'ca');
  execFileSync(openssl, ['verify', '-CAfile', old, path.join(f.cert, 'node.crt.pem')]);
});
test('actual API middleware blocks start, reset and backup during certificate transaction; GET remains available', async t => {
  const source = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(n => ts.isExpressionStatement(n) && n.getText(tree).includes('pendingMutations++'));
  const app = express();
  const certificateRenewal = { busy: true, status: () => ({ state: 'manual' }) };
  vm.runInNewContext(ts.transpileModule('let pendingMutations=0;\n' + node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { app, certificateRenewal, localRecovery: { busy: false }, backupFiles: { busy: false } });
  app.use('/api', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  for (const route of ['/commands/start', '/commands/reset', '/backups', '/certificate-renew']) {
    assert.equal((await fetch(base + route, { method: 'POST' })).status, 409);
  }
  assert.equal((await fetch(base + '/certificate-info')).status, 200);
});
test('actual renewal route returns failure, not success, when certificate/REST transaction fails', async t => {
  const source = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(tree) === 'app.post' && n.expression.arguments[0]?.text === '/api/certificate-renew');
  const app = express(); app.use(express.json());
  let calls = 0;
  const certificateRenewal = { status: () => ({ state: 'failed' }), renew: async () => {
    calls++; throw new CertificateError('OPENSSL_FAILED', 500);
  } };
  const networkStatus = { state: 'stopped' };
  vm.runInNewContext(ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { app, certificateRenewal, CertificateError, networkStatus, broadcastStatus: () => {}, activeProcess: null,
      isStartSequenceInFlight: false, pendingMutations: 1, backupFiles: { busy: false }, localRecovery: { busy: false } });
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/certificate-renew`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post({ password: 'test', mode: 'invalid' })).status, 400);
  assert.equal(calls, 0);
  const response = await post({ password: 'test', mode: 'ca' });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'OPENSSL_FAILED');
  assert.equal(calls, 1);
});
