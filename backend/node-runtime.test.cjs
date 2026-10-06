const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const yaml = require('js-yaml');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'node-runtime.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports: exported, require, console, Buffer });
const { NodeRuntime, patchNofile, setLoggingLevel, validateSettings } = exported;
const logging = '[console]\nlevel = Info\n[console.component.levels]\nnet = Warning\n[file]\nlevel = Info\nrotationSize = 25MB\nmaxTotalSize = 2500MB\n[file.component.levels]\n';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bnl-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compose = path.join(root, 'docker/docker-compose.yml');
  fs.mkdirSync(path.dirname(compose), { recursive: true });
  fs.writeFileSync(compose, yaml.dump({ services: {
    node: { volumes: ['../nodes/node:/symbol-workdir'], ulimits: { core: 0 } },
    broker: { volumes: [{ type: 'bind', source: '../nodes/node', target: '/symbol-workdir' }] },
    db: { image: 'mongo:5.0.15' },
  } }));
  const resources = path.join(root, 'nodes/node/server-config/resources');
  fs.mkdirSync(resources, { recursive: true });
  for (const kind of ['server', 'recovery']) fs.writeFileSync(path.join(resources, `config-logging-${kind}.properties`), logging);
  fs.writeFileSync(path.join(resources, 'config-node.properties'), '[cache_database]\nmaxOpenFiles = 0\n');
  return { root, compose, resources, settings: path.join(root, 'shared/runtime.json') };
}
test('rejects invalid and unsafe limits', () => {
  for (const nofile of [1024, 65535, 1048577, -1, '65536', 65536.5, NaN]) assert.throws(() => validateSettings({ debug: true, nofile }));
  assert.throws(() => validateSettings({ debug: 'false', nofile: 65536 }));
  assert.equal(validateSettings({ debug: false, nofile: 1048576 }).nofile, 1048576);
});
test('updates both sinks and component thresholds without changing rotation', () => {
  const result = setLoggingLevel(logging, true);
  assert.match(result, /net = Debug/);
  assert.equal((result.match(/level = Debug/g) || []).length, 2);
  assert.match(result, /maxTotalSize = 2500MB/);
  assert.doesNotMatch(setLoggingLevel(result, false), /= Debug/);
  assert.throws(() => setLoggingLevel('[console]\nlevel = Info', true));
});
test('only Catapult mounts get nofile and unrelated limits survive', () => {
  const doc = { services: { custom: { volumes: ['../node:/symbol-workdir:rw'], ulimits: { core: 0 } }, db: { image: 'mongo' } } };
  patchNofile(doc, 65536);
  assert.equal(doc.services.custom.ulimits.nofile.soft, 65536);
  assert.equal(doc.services.custom.ulimits.core, 0);
  assert.equal(doc.services.db.ulimits, undefined);
  assert.throws(() => patchNofile({ services: {} }, 65536));
});
test('default limits apply while unmanaged custom logging is retained', t => {
  const f = fixture(t);
  new NodeRuntime(f.root, f.settings).apply();
  assert.equal(yaml.load(fs.readFileSync(f.compose, 'utf8')).services.broker.ulimits.nofile.hard, 65536);
  assert.equal(fs.readFileSync(path.join(f.resources, 'config-logging-server.properties'), 'utf8'), logging);
});
test('saved settings survive manager recreation and generated config replacement', t => {
  const f = fixture(t);
  new NodeRuntime(f.root, f.settings).save({ debug: true, nofile: 131072 });
  const instance = new NodeRuntime(f.root, f.settings);
  instance.apply();
  fs.writeFileSync(path.join(f.resources, 'config-logging-server.properties'), logging);
  instance.apply();
  assert.match(fs.readFileSync(path.join(f.resources, 'config-logging-server.properties'), 'utf8'), /level = Debug/);
  assert.match(fs.readFileSync(path.join(f.resources, 'config-logging-recovery.properties'), 'utf8'), /level = Debug/);
  assert.equal(yaml.load(fs.readFileSync(f.compose, 'utf8')).services.node.ulimits.nofile.soft, 131072);
  assert.match(fs.readFileSync(path.join(f.resources, 'config-node.properties'), 'utf8'), /maxOpenFiles = 0/);
});
test('reports actual process limits instead of assuming compose settings are live', async t => {
  const f = fixture(t);
  const calls = [];
  const runtime = new NodeRuntime(f.root, f.settings, async args => {
    calls.push(args);
    if (args[0] === 'compose') return 'container-id';
    if (args[0] === 'inspect') return JSON.stringify([{ State: { Status: 'running', Running: true }, HostConfig: { Ulimits: null } }]);
    return '18 catapult.server 1024 1048576 990\n';
  });
  const status = await runtime.status();
  assert.equal(status.containers[0].processes[0].soft, '1024');
  assert.equal(status.containers[0].processes[0].open, '990');
  assert.equal(status.configurations[0].maxOpenFiles, '0');
  assert.ok(calls.some(args => args[0] === 'exec'));
});
test('stopped containers have no invented live measurements', async t => {
  const f = fixture(t);
  const runtime = new NodeRuntime(f.root, f.settings, async args => {
    if (args[0] === 'compose') return 'container-id';
    assert.equal(args[0], 'inspect');
    return JSON.stringify([{ State: { Status: 'exited', Running: false }, HostConfig: { Ulimits: null } }]);
  });
  const status = await runtime.status();
  assert.equal(status.containers[0].processes.length, 0);
});
