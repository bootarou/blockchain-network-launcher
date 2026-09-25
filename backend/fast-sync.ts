import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import crc32 from 'buffer-crc32';
import { blockHash, readIndex, queuesDrained, switchDirectories } from './local-recovery.js';

const exec = promisify(execFile);
const run = async (args: string[]) => (await exec('docker', args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout;
const workName = '.fast-sync';
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const reserve = 1024 * 1024 * 1024;

export interface Snapshot {
  version: 1;
  node: string;
  height: string;
  genesis: string;
  tip: string;
  serverImage: string;
  mongoImage: string;
  configuration: Record<string, string>;
  identities: string[];
}
export interface FastSyncJob {
  state: 'uploading' | 'extracting' | 'ready' | 'installing' | 'complete' | 'failed' | 'manual';
  bytes: number;
  files: number;
  height?: string;
  error?: string;
}

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function directory(p: string) {
  assert(fs.lstatSync(p).isDirectory() && !fs.lstatSync(p).isSymbolicLink(), `Unsafe directory: ${p}`);
}
function canonicalProperties(file: string) {
  // Catapult INI: preserve section membership, ignore comments and formatting.
  let section = '';
  const entries: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (/^\[.*\]$/.test(line)) { section = line; continue; }
    const i = line.indexOf('=');
    assert(i > 0, `Invalid property: ${file}`);
    const key = section + line.slice(0, i).trim();
    assert(!(key in entries), `Duplicate property: ${file}`);
    entries[key] = line.slice(i + 1).trim();
  }
  return entries;
}
function property(file: string, key: string) {
  const values = Object.entries(canonicalProperties(file)).filter(([k]) => k.endsWith(']' + key)).map(([, v]) => v);
  assert(values.length === 1, `Missing or ambiguous property: ${key}`);
  return values[0];
}
function fingerprint(file: string) {
  return hash(new crypto.X509Certificate(fs.readFileSync(file)).publicKey.export({ type: 'spki', format: 'der' }));
}
function imageFamily(image: string) {
  if (['symbolplatform/symbol-server:gcc-1.0.3.9', 'symbol-server-patched:gcc-1.0.3.9'].includes(image)) return 'official-1.0.3.9';
  if (image === 'nftdrive/bnl-catapult-server:1.0.3.9-cf1-ebp') return 'bnl-cf1-ebp';
  throw new Error('Fast Sync requires a supported non-PQC 1.0.3.9 image.');
}

export async function runtimeProfile(target: string, docker = run) {
  const nodes = fs.readdirSync(path.join(target, 'nodes'));
  assert(nodes.length === 1 && /^[a-zA-Z0-9_-]+$/.test(nodes[0]), 'Fast Sync requires a single node.');
  const node = nodes[0];
  const nodeDir = path.join(target, 'nodes', node);
  directory(nodeDir);
  const compose = JSON.parse(await docker(['compose', '-f', path.join(target, 'docker/docker-compose.yml'), 'config', '--format', 'json']));
  const services: any[] = Object.values(compose.services);
  const servers = services.filter(s => s.volumes?.some((v: any) => v.type === 'bind' && v.source === nodeDir && v.target === '/symbol-workdir'));
  assert(servers.length === 2 && servers[0].image === servers[1].image, 'Expected a matching node/broker pair.');
  assert(servers.every(s => ['0', '0:0', 'root', 'root:root'].includes(String(s.user))), 'Fast Sync currently requires root-run node/broker containers.');
  imageFamily(servers[0].image);
  const db = services.find(s => s.volumes?.some((v: any) => v.type === 'bind' && v.source === path.join(target, 'databases/db') && v.target === '/dbdata'));
  const command: string[] = Array.isArray(db?.command) ? db.command : String(db?.command || '').split(/\s+/);
  assert(db?.image === 'mongo:5.0.15' && (command.includes('--dbpath=/dbdata') || command[command.indexOf('--dbpath') + 1] === '/dbdata'), 'Expected mongo:5.0.15 with /dbdata storage.');
  const configuration: Record<string, string> = {};
  for (const role of ['server', 'broker']) {
    const resources = path.join(nodeDir, role + '-config/resources');
    for (const name of ['network', 'inflation']) {
      const props = canonicalProperties(path.join(resources, `config-${name}.properties`));
      configuration[role + '/' + name] = hash(JSON.stringify(Object.entries(props).sort(([a], [b]) => a.localeCompare(b))));
    }
    for (const [file, key, expected] of [
      ['user', 'dataDirectory', './data'], ['node', 'fileDatabaseBatchSize', '1'],
      ['node', 'enableCacheDatabaseStorage', 'true'], ['network', 'enableVerifiableState', 'true'],
    ]) assert(property(path.join(resources, `config-${file}.properties`), key) === expected, `Unsupported storage setting: ${key}`);
  }
  assert(property(path.join(nodeDir, 'broker-config/resources/config-database.properties'), 'databaseName') === 'catapult', 'Expected catapult database.');
  return { node, serverImage: servers[0].image as string, mongoImage: db.image as string, configuration,
    identities: ['ca.cert.pem', 'node.crt.pem'].map(name => fingerprint(path.join(nodeDir, 'cert', name))) };
}

export function validateChain(data: string, snapshot?: Snapshot) {
  const height = readIndex(path.join(data, 'index.dat'));
  assert(height > 1n, 'At least two blocks are required.');
  assert(queuesDrained(data), 'Broker queues must be fully consumed. Stop cleanly and create a new backup.');
  const stateQueue = path.join(data, 'spool/state_change');
  if (fs.existsSync(path.join(stateQueue, 'index_server.dat'))) {
    assert(readIndex(path.join(stateQueue, 'index_server.dat')) === readIndex(path.join(stateQueue, 'index.dat')), 'Server state queue is not fully consumed.');
  }
  for (const name of ['state', 'statedb']) {
    directory(path.join(data, name));
    assert(fs.readdirSync(path.join(data, name)).length > 0, `Missing ${name} contents.`);
  }
  const genesis = blockHash(data, 1n), tip = blockHash(data, height);
  if (snapshot) assert(snapshot.height === height.toString() && snapshot.genesis === genesis && snapshot.tip === tip, 'Snapshot block height/hash mismatch.');
  return { height: height.toString(), genesis, tip };
}

export async function createSnapshot(target: string, docker = run): Promise<Snapshot> {
  const profile = await runtimeProfile(target, docker);
  const data = path.join(target, 'nodes', profile.node, 'data');
  assert(!fs.readdirSync(data).some(n => n.endsWith('.lock') || n === 'server-recovery.started'), 'Clean shutdown required for Fast Sync.');
  assert(fs.statSync(path.join(target, 'databases/db/WiredTiger')).size > 0, 'MongoDB snapshot is missing.');
  const mongoLock = path.join(target, 'databases/db/mongod.lock');
  assert(!fs.existsSync(mongoLock) || fs.statSync(mongoLock).size === 0, 'MongoDB did not stop cleanly.');
  return { version: 1, ...profile, ...validateChain(data) };
}

export function validateSnapshot(value: any): asserts value is Snapshot {
  assert(value?.version === 1 && /^[a-zA-Z0-9_-]+$/.test(value.node), 'No supported Fast Sync metadata. Create a new Fast Sync package or compatible full backup.');
  assert(typeof value.height === 'string' && /^[1-9][0-9]{0,19}$/.test(value.height), 'Invalid snapshot height.');
  for (const key of ['genesis', 'tip']) assert(typeof value[key] === 'string' && /^[A-F0-9]{64}$/.test(value[key]), 'Invalid snapshot hash.');
  imageFamily(value.serverImage);
  assert(value.mongoImage === 'mongo:5.0.15', 'Unsupported MongoDB snapshot.');
  assert(value.configuration && ['server/network', 'server/inflation', 'broker/network', 'broker/inflation'].every(k => /^[a-f0-9]{64}$/.test(value.configuration[k])), 'Invalid configuration fingerprint.');
  assert(Array.isArray(value.identities) && value.identities.length === 2 && value.identities.every((v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)), 'Missing source node identities.');
}

export function assertFresh(target: string) {
  if (!fs.existsSync(target)) return;
  directory(target);
  // Do not infer freshness just from height: a previous failed start has an identity too.
  assert(fs.readdirSync(target).every(n => n === workName), 'Fast Sync is only available before the first node start, with an empty target directory.');
}

export function safeEntry(entry: yauzl.Entry) {
  const name = entry.fileName;
  assert(name.length < 1024 && !name.includes('\\') && !name.includes(':') && !/[\x00-\x1f]/.test(name)
    && !name.startsWith('/') && !name.split('/').some(p => p === '.' || p === '..' || (!p && !name.endsWith('/'))), 'Unsafe ZIP path.');
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  assert(mode === 0 || mode === 0x8000 || mode === 0x4000, 'Links and special files are not allowed in a backup.');
  assert(!(entry.generalPurposeBitFlag & 1) && Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize >= 0, 'Unsupported ZIP entry.');
}

export function selectedPath(name: string, node: string): string | null {
  // Strict allowlist: voting trees, delegated harvesters, keys, configs and transient queues never cross identities.
  const prefix = `blockdata/${node}/`;
  if (name.startsWith(prefix)) {
    const rel = name.slice(prefix.length);
    if (/^(index\.dat|proof\.index\.dat|commit_step\.dat)$/.test(rel)
      || /^\d{5,}\/(\d{5}\.(dat|stmt|proof)|hashes\.dat|proof\.heights\.dat)$/.test(rel)
      || /^(state|statedb|importance)\/.+/.test(rel)
      || /^spool\/(block_change|state_change|finalization)\/.+/.test(rel)) {
      return 'data/' + rel;
    }
  }
  if (name.startsWith('databases/db/')) {
    const rel = name.slice('databases/db/'.length);
    if (/^(WiredTiger(?:\.(?:wt|turtle|basecfg|backup))?|WiredTiger(?:HS|LAS)\.wt|_mdb_catalog\.wt|sizeStorer\.wt|storage\.bson|(?:collection|index)-[a-zA-Z0-9_-]+\.wt)$/.test(rel)
      || /^journal\/WiredTiger(?:Log|Preplog)\.[0-9]+$/.test(rel)) return 'mongo/' + rel;
  }
  return null;
}

async function eachEntry(file: string, visit: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true, strictFileNames: true }, (e, z) => e ? reject(e) : resolve(z!)));
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        Promise.resolve().then(() => visit(zip, entry)).then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
async function input(zip: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (e, stream) => e ? reject(e) : resolve(stream!)));
}
function checksum(entry: yauzl.Entry) {
  let crc = 0, bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      crc = crc32.unsigned(chunk, crc);
      callback(bytes > entry.uncompressedSize ? new Error('ZIP size exceeded.') : null, chunk);
    },
    flush(callback) { callback(bytes === entry.uncompressedSize && crc === entry.crc32 ? null : new Error('ZIP checksum/size mismatch.')); },
  });
}

export class FastSync {
  private job: FastSyncJob | null = null;
  private executing = false;
  private work: string;
  constructor(private target: string, private journal: string, private log: (s: string) => void, private docker = run,
    private platform = process.platform,
    private ownMongo = async (dir: string) => { await exec('chown', ['-R', '999:999', dir], { timeout: 600000 }); },
    private switchData = switchDirectories) {
    this.work = path.join(target, workName);
    if (fs.existsSync(journal)) {
      try {
        this.job = JSON.parse(fs.readFileSync(journal, 'utf8'));
        assert(this.job && ['uploading', 'extracting', 'ready', 'installing', 'complete', 'failed', 'manual'].includes(this.job.state), 'Invalid Fast Sync journal.');
        if (this.job.state === 'installing') this.job = { ...this.job, state: 'manual', error: 'Interrupted data installation. Preserve both datasets and inspect the journal before starting.' };
        if (['uploading', 'extracting'].includes(this.job.state)) this.job = { ...this.job, state: 'failed', error: 'Import interrupted. Discard and upload again.' };
      } catch { this.job = { state: 'manual', bytes: 0, files: 0, error: 'Unreadable Fast Sync journal.' }; }
      this.save();
    }
  }
  status() { return this.job ? { ...this.job } : null; }
  get busy() { return this.executing || !!this.job && !['complete', 'ready', 'failed'].includes(this.job.state); }
  get pending() { return !!this.job && this.job.state !== 'complete'; }
  private save() {
    fs.mkdirSync(path.dirname(this.journal), { recursive: true });
    const fd = fs.openSync(this.journal + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.job)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(this.journal + '.tmp', this.journal);
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(this.journal), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  }
  async stopped() {
    assert(this.platform === 'linux', 'Fast Sync requires Linux / WSL.');
    const names = await this.docker(['ps', '--format', '{{.Names}}']);
    assert(!names.split(/\r?\n/).some(n => /^(db|broker|node)$|api-node|peer-node|rest-gateway/.test(n)), 'Stop all node containers first.');
    const others = names.trim().split(/\r?\n/).filter(Boolean);
    if (others.length) {
      const containers = JSON.parse(await this.docker(['inspect', ...others]));
      assert(!containers.some((c: any) => c.Mounts?.some((m: any) => {
        if (!m.Source) return false;
        const source = path.resolve(m.Source);
        // The manager mounts the whole target; it is the only permitted writer here.
        if (c.Name === '/symbol-manager') return false;
        return source === this.target || source.startsWith(this.target + path.sep);
      })), 'A running container is using the target directory.');
    }
  }
  eligibility() {
    try { assertFresh(this.target); assert(!this.pending && !fs.existsSync(this.work), 'A Fast Sync import or staging directory already exists.'); return { available: this.platform === 'linux', reason: this.platform === 'linux' ? '' : 'Linux / WSL required.' }; }
    catch (e: any) { return { available: false, reason: e.message }; }
  }
  async receive(stream: Readable) {
    assert(!this.pending && !this.executing, 'A Fast Sync import already exists.');
    assertFresh(this.target);
    assert(!fs.existsSync(this.work), 'An existing staging directory must be inspected first.');
    // Reserve synchronously before the first await so concurrent requests cannot enter.
    this.executing = true;
    this.job = { state: 'uploading', bytes: 0, files: 0 };
    try {
      this.save();
      await this.stopped();
      fs.mkdirSync(this.work, { recursive: true, mode: 0o700 });
      const free = fs.statfsSync(this.work);
      const limit = free.bavail * free.bsize - reserve;
      const meter = new Transform({ transform: (chunk, _encoding, callback) => {
        this.job!.bytes += chunk.length;
        callback(this.job!.bytes > limit ? new Error('Insufficient upload disk space.') : null, chunk);
      } });
      const output = fs.createWriteStream(path.join(this.work, 'upload.zip'), { flags: 'wx', mode: 0o600 });
      try { await pipeline(stream, meter, output); }
      finally {
        output.destroy();
        if (!output.closed) await new Promise<void>(resolve => output.once('close', resolve));
      }
      this.job.state = 'extracting'; this.save();
      // Upload is durable; extraction continues even if the browser disconnects.
      void this.extract().catch(e => this.fail(e)).finally(() => { this.executing = false; });
    } catch (e) { this.fail(e); this.executing = false; throw e; }
    return this.status();
  }
  private fail(e: any) {
    this.job = { ...this.job!, state: 'failed', error: e.message };
    try { this.save(); }
    catch { this.job.state = 'manual'; this.job.error += ' Could not persist the journal; manual review required.'; }
    this.log(`[Fast Sync] ${this.job.error}\n`);
  }
  private async extract() {
    const file = path.join(this.work, 'upload.zip');
    let snapshot: Snapshot | undefined;
    let metadataSeen = false;
    let expanded = 0;
    await eachEntry(file, async (zip, entry) => {
      safeEntry(entry);
      expanded += entry.uncompressedSize;
      assert(Number.isSafeInteger(expanded), 'Archive is too large.');
      if (entry.fileName === 'backup-meta.json') {
        assert(!metadataSeen, 'Duplicate backup metadata.'); metadataSeen = true;
        assert(entry.uncompressedSize <= 1024 * 1024, 'Backup metadata is too large.');
        const chunks: Buffer[] = [];
        const source = await input(zip, entry);
        await pipeline(source, checksum(entry), new Transform({ transform(c, _e, cb) { chunks.push(c); cb(); } }));
        const meta = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert((meta.type === 'node-full-backup' && meta.full === true) || (meta.type === 'node-fast-sync' && meta.full === false), 'A Fast Sync package or full backup is required.');
        if (!meta.fastSync && meta.fastSyncUnavailable) throw new Error('Backup is not eligible for Fast Sync: ' + String(meta.fastSyncUnavailable));
        validateSnapshot(meta.fastSync);
        snapshot = meta.fastSync;
      }
    });
    assert(snapshot, 'Missing Fast Sync metadata. Create a new full backup with this BNL version.');
    const space = fs.statfsSync(this.work);
    assert(expanded + reserve < space.bavail * space.bsize, 'Insufficient extraction disk space.');
    const snapshotValue = snapshot;
    await eachEntry(file, async (zip, entry) => {
      if (entry.fileName.endsWith('/')) return;
      const rel = selectedPath(entry.fileName, snapshotValue.node);
      if (!rel) return;
      const dest = path.join(this.work, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      await pipeline(await input(zip, entry), checksum(entry), fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
      this.job!.files++;
    });
    validateChain(path.join(this.work, 'data'), snapshotValue);
    assert(fs.statSync(path.join(this.work, 'mongo/WiredTiger')).size > 0, 'MongoDB data is missing.');
    fs.writeFileSync(path.join(this.work, 'snapshot.json'), JSON.stringify(snapshotValue), { mode: 0o600 });
    fs.rmSync(file);
    if (process.platform === 'linux') await exec('sync', ['-f', this.work], { timeout: 600000 });
    this.job = { ...this.job!, height: snapshotValue.height, state: 'ready' }; this.save();
    this.log(`[Fast Sync] Ready at height ${snapshotValue.height}. Configure the same network and start a new identity.\n`);
  }
  async discard() {
    assert(!this.busy, 'Cannot discard an active or interrupted installation.');
    assert(!this.job || ['failed', 'ready'].includes(this.job.state), 'No pending import to discard.');
    this.executing = true;
    try {
      await this.stopped();
      if (fs.existsSync(this.work)) { directory(this.work); fs.rmSync(this.work, { recursive: true }); }
      this.job = null;
      fs.rmSync(this.journal, { force: true });
    } finally { this.executing = false; }
  }
  assertStart() { assert(!this.pending || this.job?.state === 'ready', 'Fast Sync is not ready. Check Backup / Fast Sync.'); }
  async install() {
    if (!this.pending) return;
    this.assertStart();
    await this.stopped();
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(path.join(this.work, 'snapshot.json'), 'utf8'));
    validateSnapshot(snapshot);
    const profile = await runtimeProfile(this.target, this.docker);
    assert(imageFamily(profile.serverImage) === imageFamily(snapshot.serverImage) && profile.mongoImage === snapshot.mongoImage, 'Snapshot image mismatch.');
    assert(Object.keys(snapshot.configuration).every(k => profile.configuration[k] === snapshot.configuration[k]), 'Network/inflation configuration mismatch. Use the matching preset or Share package.');
    assert(profile.identities.every(id => !snapshot.identities.includes(id)), 'Source identity reused. Fast Sync requires new CA and transport keys.');
    const data = path.join(this.target, 'nodes', profile.node, 'data');
    assert(readIndex(path.join(data, 'index.dat')) <= 1n, 'Destination has already synchronized blocks.');
    assert(blockHash(data, 1n) === snapshot.genesis, 'Nemesis mismatch. Refusing to mix networks.');
    validateChain(path.join(this.work, 'data'), snapshot);
    const database = path.join(this.target, 'databases/db');
    fs.mkdirSync(database, { recursive: true });
    assert(fs.readdirSync(database).length === 0, 'Destination MongoDB is not empty.');
    await this.ownMongo(path.join(this.work, 'mongo'));
    this.job!.state = 'installing'; this.save();
    try {
      this.switchData([[data, path.join(this.work, 'data'), path.join(this.work, 'original-data')],
        [database, path.join(this.work, 'mongo'), path.join(this.work, 'original-mongo')]]);
      this.job!.state = 'complete'; this.save();
      this.log(`[Fast Sync] Installed height ${snapshot.height}; remaining blocks will synchronize from peers.\n`);
    } catch (e: any) {
      this.job!.state = 'manual'; this.job!.error = e.message; this.save(); throw e;
    }
  }
}
