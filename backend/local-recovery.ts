import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export type Docker = (args: string[]) => Promise<string>;
const docker: Docker = async args => {
  const { stdout, stderr } = await exec('docker', args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  return args[0] === 'logs' ? stdout + stderr : stdout;
};

export function readIndex(file: string): bigint {
  const bytes = fs.readFileSync(file);
  if (bytes.length !== 8) throw new Error(`Invalid 8-byte index: ${file}`);
  return bytes.readBigUInt64LE();
}

export function blockPath(data: string, height: bigint): string {
  return path.join(data, (height / 10000n).toString().padStart(5, '0'),
    `${(height % 10000n).toString().padStart(5, '0')}.dat`);
}

export function blockHash(data: string, height: bigint): string {
  const file = blockPath(data, height);
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(120);
    if (fs.readSync(fd, header, 0, 120, 0) !== 120 || header.readBigUInt64LE(112) !== height) {
      throw new Error(`Invalid block header at height ${height}`);
    }
    const size = header.readUInt32LE();
    const hash = Buffer.alloc(32);
    if (size < 120 || fs.fstatSync(fd).size < size + 32 || fs.readSync(fd, hash, 0, 32, size) !== 32) {
      throw new Error(`Truncated block at height ${height}`);
    }
    return hash.toString('hex').toUpperCase();
  } finally { fs.closeSync(fd); }
}

// Inspect only pending messages. Already-consumed queue files are normally deleted.
export function queueProblems(data: string): string[] {
  const problems: string[] = [];
  for (const queue of ['block_change', 'state_change', 'finalization']) {
    const dir = path.join(data, 'spool', queue);
    if (!fs.existsSync(dir)) continue;
    try {
      const writer = readIndex(path.join(dir, 'index.dat'));
      const readerFile = path.join(dir, 'index_broker_r.dat');
      const reader = fs.existsSync(readerFile) ? readIndex(readerFile) : 0n;
      if (reader > writer) throw new Error('Reader is ahead of writer');
      // Scan directory entries rather than iterating an untrusted uint64 range.
      let present = 0n;
      for (const name of fs.readdirSync(dir)) {
        if (!/^[0-9a-f]{16}\.dat$/.test(name)) continue;
        const index = BigInt(`0x${name.slice(0, 16)}`);
        if (index >= reader && index < writer && fs.statSync(path.join(dir, name)).size > 0) present++;
      }
      if (present !== writer - reader) problems.push(`${queue}: missing/empty pending messages (${reader}..${writer})`);
    } catch (e: any) { problems.push(`${queue}: ${e.message}`); }
  }
  return problems;
}

export function queuesDrained(data: string): boolean {
  return ['block_change', 'state_change', 'finalization'].every(queue => {
    const dir = path.join(data, 'spool', queue);
    if (!fs.existsSync(dir)) return queue === 'finalization';
    const writer = readIndex(path.join(dir, 'index.dat'));
    const reader = path.join(dir, 'index_broker_r.dat');
    return (fs.existsSync(reader) ? readIndex(reader) : 0n) === writer;
  });
}

function property(file: string, name: string): string {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const matches = lines.filter(line => line.trim().startsWith(`${name} `) || line.trim().startsWith(`${name}=`))
    .map(line => line.substring(line.indexOf('=') + 1).trim());
  if (matches.length !== 1) throw new Error(`Missing/duplicate property ${name}: ${file}`);
  return matches[0];
}

function directory(p: string): void {
  if (!fs.lstatSync(p).isDirectory() || fs.realpathSync(p) !== p) throw new Error(`Unsafe directory: ${p}`);
}

function syncDirectory(p: string): void {
  // Directory fsync is needed for rename durability on the supported Linux host.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(p, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export interface RecoveryJob {
  id: string;
  state: 'running' | 'ready' | 'applying' | 'complete' | 'failed' | 'interrupted' | 'manual' | 'abandoned';
  phase: string;
  createdAt: string;
  work: string;
  height?: string;
  hash?: string;
  stateHash?: string;
  detail?: string;
  error?: string;
  containers: string[];
  network?: string;
  configHash?: string;
}

/** Two renames per dataset, with reverse-order rollback on an ordinary failure.
 * A persisted 'applying' job remains blocked after a process/host crash; never guess
 * which rename completed and never start a node on a mixed node/DB pair.
 */
export function switchDirectories(pairs: [string, string, string][], rename = fs.renameSync): void {
  for (const [live, rebuilt, saved] of pairs) {
    directory(live);
    directory(rebuilt);
    directory(path.dirname(saved));
    if (fs.existsSync(saved)) throw new Error(`Backup already exists: ${saved}`);
    if (fs.statSync(live).dev !== fs.statSync(rebuilt).dev || fs.statSync(live).dev !== fs.statSync(path.dirname(saved)).dev) {
      throw new Error('Cutover requires a single filesystem');
    }
  }
  const completed: [string, string][] = [];
  try {
    for (const [live, rebuilt, saved] of pairs) {
      rename(live, saved); completed.push([live, saved]);
      rename(rebuilt, live); completed.push([rebuilt, live]);
    }
    for (const parent of new Set(pairs.flatMap(pair => pair.map(p => path.dirname(p))))) syncDirectory(parent);
  } catch (error) {
    for (const [from, to] of completed.reverse()) rename(to, from);
    for (const parent of new Set(pairs.flatMap(pair => pair.map(p => path.dirname(p))))) syncDirectory(parent);
    throw error;
  }
}

export class LocalRecovery {
  private job: RecoveryJob | null = null;
  private executing = false;
  constructor(private target: string, private journal: string, private log: (s: string) => void,
    private run: Docker = docker) {
    if (fs.existsSync(journal)) {
      try {
        this.job = JSON.parse(fs.readFileSync(journal, 'utf8'));
        if (!this.job?.id || !Array.isArray(this.job.containers)) throw new Error('Invalid journal');
        if (this.job.state === 'applying') this.job.state = 'manual';
        else if (this.job.state === 'running') this.job.state = 'interrupted';
        this.save();
      } catch {
        // Fail closed; a corrupt journal must not permit data reset/start.
        this.job = { id: 'unknown', state: 'manual', phase: 'journal', createdAt: '', work: '', containers: [], error: 'Recovery journal unreadable; manual inspection required.' };
      }
    }
  }
  get busy(): boolean { return !!this.job && !['complete', 'abandoned'].includes(this.job.state); }
  status(): RecoveryJob | null { return this.job ? structuredClone(this.job) : null; }
  private save() {
    fs.mkdirSync(path.dirname(this.journal), { recursive: true });
    const tmp = `${this.journal}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.job, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.journal);
    syncDirectory(path.dirname(this.journal));
  }
  private phase(phase: string) { this.job!.phase = phase; this.save(); this.log(`[Local recovery] ${phase}\n`); }
  private async inspect(name: string): Promise<any> { return JSON.parse(await this.run(['inspect', name]))[0]; }
  private async originalsStopped() {
    const ids = (await this.run(['ps', '-aq'])).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return;
    for (const c of JSON.parse(await this.run(['inspect', ...ids]))) {
      if (this.job?.containers.includes(c.Name.replace(/^\//, '')) || c.Name === '/symbol-manager') continue;
      if (!c.State.Running && !c.State.Restarting && !c.State.Paused) continue;
      if (c.Mounts.some((m: any) => m.Type === 'bind' &&
        (m.Source === this.target || m.Source.startsWith(`${this.target}/`) || this.target.startsWith(`${m.Source}/`)))) {
        throw new Error(`Stop container before recovery: ${c.Name}`);
      }
    }
  }
  private async preflight() {
    if (process.platform !== 'linux') throw new Error('Local recovery requires the Linux/WSL manager.');
    directory(this.target);
    if (this.target.includes(',')) throw new Error('Comma in target path is unsupported');
    const nodes = fs.readdirSync(path.join(this.target, 'nodes'));
    if (nodes.length !== 1 || nodes[0] !== 'api-node-0') throw new Error('Only a single api-node-0 is supported.');
    const node = path.join(this.target, 'nodes', nodes[0]);
    directory(node); directory(path.join(node, 'data')); directory(path.join(this.target, 'databases', 'db'));
    await this.originalsStopped();
    const compose = await this.run(['compose', '-f', path.join(this.target, 'docker/docker-compose.yml'), 'config', '--format', 'json']);
    const services: any[] = Object.values(JSON.parse(compose).services);
    const nodeServices = services.filter(s => s.volumes?.some((v: any) => v.type === 'bind' && v.source === node && v.target === '/symbol-workdir'));
    if (nodeServices.length !== 2 || nodeServices[0].image !== nodeServices[1].image) throw new Error('Expected matching server/broker images and bind mounts.');
    const image = nodeServices[0].image;
    if (!/^(symbolplatform\/symbol-server:gcc-1\.0\.3\.9|symbol-server-patched:gcc-1\.0\.3\.9|nftdrive\/bnl-catapult-server:1\.0\.3\.9-cf1-ebp)$/.test(image)) {
      throw new Error(`Unsupported recovery image (PQC is excluded): ${image}`);
    }
    const db = services.find(s => s.volumes?.some((v: any) => v.type === 'bind' && v.source === path.join(this.target, 'databases/db') && v.target === '/dbdata'));
    if (!db || db.image !== 'mongo:5.0.15') throw new Error('Expected MongoDB 5.0.15 with /dbdata bind mount.');
    const command: string[] = Array.isArray(db.command) ? db.command : String(db.command || '').split(/\s+/);
    if (!command.includes('--dbpath=/dbdata') && !(command.includes('--dbpath') && command[command.indexOf('--dbpath') + 1] === '/dbdata')) {
      throw new Error('MongoDB must actually use --dbpath=/dbdata.');
    }
    const resource = (role: string, file: string) => path.join(node, `${role}-config/resources/config-${file}.properties`);
    const configHash = crypto.createHash('sha256').update(compose);
    for (const role of ['server', 'broker']) {
      const resources = path.join(node, `${role}-config/resources`);
      directory(resources);
      for (const name of fs.readdirSync(resources).sort()) {
        if (name.endsWith('.properties')) configHash.update(`${role}/${name}\0`).update(fs.readFileSync(path.join(resources, name)));
      }
      if (property(resource(role, 'user'), 'dataDirectory') !== './data' ||
          property(resource(role, 'node'), 'enableCacheDatabaseStorage') !== 'true' ||
          property(resource(role, 'node'), 'fileDatabaseBatchSize') !== '1' ||
          property(resource(role, 'network'), 'enableVerifiableState') !== 'true') throw new Error('Unsupported data/storage/state configuration.');
    }
    for (const [key, value] of Object.entries({ 'extension.filespooling': 'true', 'extension.mongo': 'false', 'extension.zeromq': 'false' })) {
      if (property(resource('server', 'extensions-recovery'), key) !== value) throw new Error(`Unsupported importer extension: ${key}`);
    }
    if (property(resource('broker', 'database'), 'databaseName') !== 'catapult' ||
        property(resource('broker', 'extensions-broker'), 'extension.mongo') !== 'true') throw new Error('Unsupported broker database configuration.');
    directory(path.join(this.target, 'docker/mongo'));
    const imageId = JSON.parse(await this.run(['image', 'inspect', image]))[0].Id;
    const mongoId = JSON.parse(await this.run(['image', 'inspect', db.image]))[0].Id;
    configHash.update(imageId).update(mongoId);
    const height = readIndex(path.join(node, 'data/index.dat'));
    if (height < 2n) throw new Error('At least two local blocks are required.');
    const hash = blockHash(path.join(node, 'data'), height);
    return { node, imageId, mongoId, height, hash, configHash: configHash.digest('hex') };
  }
  start(): RecoveryJob {
    if (this.busy || this.executing) throw new Error('Recovery already active.');
    const id = `bnl-rebuild-${crypto.randomBytes(8).toString('hex')}`;
    this.job = { id, state: 'running', phase: 'preflight', createdAt: new Date().toISOString(),
      work: path.join(this.target, 'local-recovery', id), containers: [] };
    this.save();
    this.executing = true;
    void this.rebuild().catch((e: any) => {
      this.job!.state = 'failed'; this.job!.error = e.message; this.save();
      this.log(`[Local recovery] Failed; originals retained: ${e.message}\n`);
    }).finally(() => { this.executing = false; });
    return this.status()!;
  }
  private mount(source: string, dest: string, readonly = false) {
    return ['--mount', `type=bind,src=${source},dst=${dest}${readonly ? ',readonly' : ''}`];
  }
  private async launch(role: string, args: string[]) {
    const name = `${this.job!.id}-${role}`;
    this.job!.containers.push(name); this.save();
    await this.run(['run', '-d', '--pull', 'never', '--restart', 'no', '--name', name,
      '--label', `bnl.local-recovery=${this.job!.id}`, '--log-opt', 'max-size=20m', '--log-opt', 'max-file=3', ...args]);
    return name;
  }
  private async wait(name: string) {
    for (;;) {
      const { State: state } = await this.inspect(name);
      if (state.Status === 'exited') {
        if (state.ExitCode !== 0 || state.OOMKilled) throw new Error(`${name} failed (${state.ExitCode}); inspect docker logs.`);
        return;
      }
      if (state.Status !== 'running') throw new Error(`${name}: ${state.Status}`);
      this.job!.detail = (await this.run(['logs', '--tail', '3', name])).slice(-2000); this.save();
      await sleep(5000);
    }
  }
  private async stopClean(name: string) {
    await this.run(['stop', '--timeout', '120', name]);
    const { State: state } = await this.inspect(name);
    if (state.Status !== 'exited' || state.ExitCode !== 0 || state.OOMKilled) throw new Error(`Unclean stop: ${name}`);
  }
  private async rebuild() {
    const p = await this.preflight();
    Object.assign(this.job!, { height: String(p.height), hash: p.hash, configHash: p.configHash }); this.save();
    const w = this.job!.work;
    fs.mkdirSync(path.dirname(w), { recursive: true, mode: 0o700 }); directory(path.dirname(w));
    fs.mkdirSync(w, { mode: 0o700 });
    for (const dir of ['node', 'mongo', 'before-import']) fs.mkdirSync(path.join(w, dir), { mode: 0o700 });
    const bytes = Number((await this.run(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
      ...this.mount(p.node, '/source', true), '--entrypoint', '/bin/sh', p.imageId, '-c',
      'set -eu; test -x /usr/catapult/bin/catapult.importer; test -x /usr/catapult/bin/catapult.broker; test -z "$(find /source -type l -print -quit)"; du -sb /source'])).trim().split(/\s+/)[0]);
    const space = fs.statfsSync(w);
    // Rebuilt queues and a new MongoDB can substantially exceed the block store.
    if (!Number.isFinite(bytes) || space.bavail * space.bsize < bytes * 4 + 2 * 1024 ** 3) throw new Error('Insufficient free space (requires 4x node size + 2 GiB).');
    this.phase('copy');
    await this.wait(await this.launch('copy', ['--network', 'none', '--read-only', '--user', '0:0',
      ...this.mount(p.node, '/source', true), ...this.mount(path.join(w, 'node'), '/destination'),
      '--entrypoint', '/bin/sh', p.imageId, '-c', 'set -eu; cp -a --reflink=auto /source/. /destination/; echo COPY_COMPLETE']));
    await this.originalsStopped();
    const data = path.join(w, 'node/data');
    for (const name of ['state', 'state.tmp', 'statedb', 'spool', 'importance', 'server.lock', 'broker.lock', 'recovery.lock', 'commit_step.dat', 'server-recovery.started']) {
      const src = path.join(data, name);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(w, 'before-import', name));
    }
    this.phase('import');
    const importer = await this.launch('import', ['--network', 'none', '--read-only', '--user', '0:0', '--tmpfs', '/tmp',
      ...this.mount(path.join(w, 'node'), '/symbol-workdir'), '--workdir', '/symbol-workdir',
      '--entrypoint', '/usr/catapult/bin/catapult.importer', p.imageId, './server-config']);
    await this.wait(importer);
    const logs = await this.run(['logs', '--tail', '100', importer]);
    const match = logs.match(new RegExp(`cache state hash at height ${p.height}: ([A-Fa-f0-9]{64})`));
    if (!match) throw new Error('Importer calculated state hash not found; refusing cutover.');
    this.job!.stateHash = match[1].toUpperCase(); this.save();
    if (readIndex(path.join(data, 'index.dat')) !== p.height || blockHash(data, p.height) !== p.hash) throw new Error('Imported chain tip mismatch.');
    this.phase('mongo');
    this.job!.network = `${this.job!.id}-net`; this.save();
    await this.run(['network', 'create', '--internal', this.job!.network]);
    const mongo = await this.launch('mongo', ['--network', this.job!.network, '--network-alias', 'db',
      '--workdir', '/docker-entrypoint-initdb.d', '-e', 'MONGO_INITDB_DATABASE=catapult',
      ...this.mount(path.join(w, 'mongo'), '/data/db'), ...this.mount(path.join(this.target, 'docker/mongo'), '/docker-entrypoint-initdb.d', true),
      p.mongoId, 'mongod', '--bind_ip_all', '--wiredTigerCacheSizeGB', '2']);
    const query = (js: string) => this.run(['exec', mongo, 'mongo', '--quiet', 'catapult', '--eval', js]);
    let initialized = false;
    for (let i = 0; i < 120; i++) {
      if (!(await this.inspect(mongo)).State.Running) throw new Error('MongoDB initialization failed.');
      // Connect via the network alias to exclude the temporary localhost-only init server.
      try {
        await this.run(['exec', mongo, 'mongo', '--host', 'db', '--quiet', 'catapult', '--eval',
          'assert(db.blocks.getIndexes().length >= 7); assert(db.transactions.getIndexes().length >= 11); assert.eq(0, db.blocks.countDocuments({}));']);
        initialized = true; break;
      } catch { await sleep(2000); }
    }
    if (!initialized) throw new Error('MongoDB initialization timed out.');
    const dbConfig = path.join(w, 'node/broker-config/resources/config-database.properties');
    const originalConfig = fs.readFileSync(dbConfig, 'utf8');
    property(dbConfig, 'databaseUri');
    fs.writeFileSync(dbConfig, originalConfig.replace(/^\s*databaseUri\s*=.*$/m, 'databaseUri = mongodb://db:27017'), { mode: 0o600 });
    this.phase('broker');
    const broker = await this.launch('broker', ['--network', this.job!.network, '--read-only', '--user', '0:0', '--tmpfs', '/tmp',
      '--stop-signal', 'SIGINT', ...this.mount(path.join(w, 'node'), '/symbol-workdir'), '--workdir', '/symbol-workdir',
      '--entrypoint', '/usr/catapult/bin/catapult.broker', p.imageId, './broker-config']);
    while (!queuesDrained(data)) {
      if (!(await this.inspect(broker)).State.Running || !(await this.inspect(mongo)).State.Running) throw new Error('Rebuild broker/MongoDB stopped unexpectedly.');
      this.job!.detail = (await this.run(['logs', '--tail', '3', broker])).slice(-2000); this.save();
      await sleep(5000);
    }
    this.phase('verify');
    // Stop the broker first: queue positions alone do not prove async DB writes finished.
    await this.stopClean(broker);
    const verification = `var b = db.blocks.findOne({'block.height': NumberLong('${p.height}')});
assert(b); assert.eq(${JSON.stringify(p.hash)}, b.meta.hash.hex().toUpperCase());
assert.eq(${JSON.stringify(this.job!.stateHash)}, b.block.stateHash.hex().toUpperCase());
assert.eq(${p.height}, db.blocks.countDocuments({}));
assert.eq(NumberLong('${p.height}'), db.blocks.find().sort({'block.height':-1}).limit(1).next().block.height);
print('RECOVERY_DB_VERIFIED');`;
    if (!(await query(verification)).includes('RECOVERY_DB_VERIFIED')) throw new Error('Database verification failed.');
    await this.stopClean(mongo);
    this.phase('restart-check');
    await this.run(['start', mongo]);
    let verified = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await query(verification)).includes('RECOVERY_DB_VERIFIED')) { verified = true; break; } }
      catch { /* Startup may still be in progress. */ }
      await sleep(2000);
    }
    if (!verified) throw new Error('Database restart verification failed.');
    await this.run(['start', broker]); await sleep(10000);
    if (!(await this.inspect(broker)).State.Running || !queuesDrained(data)) throw new Error('Broker restart verification failed.');
    await this.stopClean(broker);
    await query(verification);
    await this.stopClean(mongo);
    await this.originalsStopped();
    this.job!.state = 'ready'; this.phase('ready');
  }
  async apply(id: string) {
    if (this.executing || this.job?.id !== id || this.job.state !== 'ready') throw new Error('Recovery is not ready.');
    this.executing = true;
    try {
      const p = await this.preflight();
      if (String(p.height) !== this.job.height || p.hash !== this.job.hash || p.configHash !== this.job.configHash) throw new Error('Original chain/configuration changed; refusing cutover.');
      const w = this.job.work;
      const data = path.join(w, 'node/data');
      if (readIndex(path.join(data, 'index.dat')) !== p.height || blockHash(data, p.height) !== p.hash || !queuesDrained(data)) throw new Error('Prepared data changed.');
      // Remove stopped helpers before moving their bind mounts. They must never restart
      // against renamed paths. Logs remain available until this explicit apply step.
      for (const name of this.job.containers) {
        const c = await this.inspect(name);
        if (c.State.Status !== 'exited' || c.State.ExitCode !== 0 || c.State.OOMKilled) throw new Error(`Helper not cleanly stopped: ${name}`);
      }
      const saved = path.join(w, 'original-before-cutover');
      fs.mkdirSync(saved, { mode: 0o700 });
      syncDirectory(w);
      this.job.state = 'applying'; this.phase('cutover');
      for (const name of this.job.containers) await this.run(['rm', name]);
      if (this.job.network) await this.run(['network', 'rm', this.job.network]);
      await this.originalsStopped();
      switchDirectories([
        [path.join(p.node, 'data'), data, path.join(saved, 'node-data')],
        [path.join(this.target, 'databases/db'), path.join(w, 'mongo'), path.join(saved, 'mongo-db')],
      ]);
      this.job.state = 'complete'; this.phase('complete');
    } catch (e: any) {
      this.job!.state = this.job!.state === 'applying' ? 'manual' : 'failed';
      this.job!.error = e.message; this.save(); throw e;
    } finally { this.executing = false; }
  }
  async abandon(id: string) {
    if (this.executing || this.job?.id !== id || !['ready', 'failed', 'interrupted'].includes(this.job.state)) throw new Error('Cannot release this recovery.');
    this.executing = true;
    try {
      // Limit removal to this job's labelled containers. Never delete work/original data.
      const ids = (await this.run(['ps', '-aq', '--filter', `label=bnl.local-recovery=${id}`])).trim().split(/\s+/).filter(Boolean);
      for (const container of ids) {
        await this.run(['stop', '--timeout', '120', container]);
        await this.run(['rm', container]);
      }
      const networks = (await this.run(['network', 'ls', '--format', '{{.Name}}'])).trim().split('\n');
      if (this.job.network && networks.includes(this.job.network)) await this.run(['network', 'rm', this.job.network]);
      this.job.state = 'abandoned'; this.phase('abandoned');
    } finally { this.executing = false; }
  }
}
