const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bash = process.env.BNL_TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const helper = path.join(__dirname, 'install-dependencies.sh').replaceAll('\\', '/');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const script = path.join(root, 'install-dependencies.sh');
  fs.writeFileSync(script, fs.readFileSync(helper, 'utf8').replaceAll('\r\n', '\n'));
  for (const name of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(root, name), '{}\n');
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/bash\n[ "${NODE_FAIL:-0}" = 0 ] || exit 9\nprintf "%s\\n" "${NODE_VERSION:-node-test-v1}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npm'), [
    '#!/bin/bash',
    'if [ "$1" = --version ]; then echo "${NPM_VERSION:-npm-test-v1}"; exit 0; fi',
    'echo "$*" >> calls',
    '[ "${INSTALL_FAIL:-0}" = 0 ] || exit 7',
    'mkdir -p node_modules',
    '',
  ].join('\n'), { mode: 0o755 });
  const run = (env = {}) => spawnSync(bash, ['-c', 'export PATH="$PWD/bin:$PATH"; exec bash "$1" "$PWD"', 'test', script.replaceAll('\\', '/')], {
    cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000,
  });
  const success = (env) => { const result = run(env); assert.equal(result.status, 0, result.stderr || result.error?.message); };
  const calls = () => fs.existsSync(path.join(root, 'calls')) ? fs.readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n') : [];
  return { root, run, success, calls, marker: path.join(root, 'node_modules/.bnl-dependencies') };
}

test('fresh and legacy installs synchronize once; unchanged restarts skip installation', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'node_modules'));
  f.success(); f.success();
  assert.deepEqual(f.calls(), ['ci --include=dev --no-audit --no-fund']);
  fs.rmSync(path.join(f.root, 'node_modules'), { recursive: true });
  f.success();
  assert.equal(f.calls().length, 2);
});

test('manifest, lockfile, Node and npm changes each trigger synchronization', t => {
  const f = fixture(t); f.success();
  fs.appendFileSync(path.join(f.root, 'package.json'), ' '); f.success();
  fs.appendFileSync(path.join(f.root, 'package-lock.json'), ' '); f.success();
  f.success({ NODE_VERSION: 'node-test-v2' });
  f.success({ NODE_VERSION: 'node-test-v2', NPM_VERSION: 'npm-test-v2' });
  assert.equal(f.calls().length, 5);
});

test('failed refresh invalidates marker and retries without changing runtime data', t => {
  const f = fixture(t); f.success();
  fs.mkdirSync(path.join(f.root, 'shared'));
  fs.writeFileSync(path.join(f.root, 'shared/backup.zip'), 'keep');
  fs.appendFileSync(path.join(f.root, 'package-lock.json'), ' ');
  assert.equal(f.run({ INSTALL_FAIL: '1' }).status, 7);
  assert.equal(fs.existsSync(f.marker), false);
  f.success(); f.success();
  assert.equal(f.calls().length, 3);
  assert.equal(fs.readFileSync(path.join(f.root, 'shared/backup.zip'), 'utf8'), 'keep');
});

test('missing lockfile and runtime detection failure block installation', t => {
  const f = fixture(t);
  assert.notEqual(f.run({ NODE_FAIL: '1' }).status, 0);
  fs.unlinkSync(path.join(f.root, 'package-lock.json'));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls().length, 0);
});

test('Docker build excludes all shared data; both startup syncs precede API launch', () => {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8').replaceAll('\r\n', '\n');
  const ignore = read('.dockerignore').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  assert.ok(ignore.includes('shared'));
  assert.ok(!ignore.some(s => s.startsWith('!')));
  const dockerfile = read('Dockerfile');
  assert.doesNotMatch(dockerfile, /^COPY\s+shared\//m);
  assert.match(dockerfile, /RUN mkdir -p \/app\/shared/);
  for (const role of ['backend', 'frontend']) {
    const command = `/install-dependencies.sh /app/${role}`;
    assert.ok(dockerfile.includes(command));
    assert.ok(read('start.sh').indexOf(command) < read('start.sh').indexOf('npm run dev'));
  }
  assert.match(read('start.sh'), /^set -e$/m);
});
