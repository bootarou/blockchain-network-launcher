import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import yaml from 'js-yaml';
import { decryptAddressesObj } from './addresses-crypto.js';
import { switchDirectories } from './local-recovery.js';

export type RenewalMode = 'node' | 'ca';
type Run = (program: string, args: string[], input?: string) => Promise<string>;
type Job = { state: 'preparing' | 'applying' | 'complete' | 'failed' | 'manual';
  mode: RenewalMode; work: string; error?: string; pairs: [string, string, string][] };

export class CertificateError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const fail = (code: string, status = 400): never => { throw new CertificateError(code, status); };
const runCommand: Run = (program, args, input) => new Promise((resolve, reject) => {
  const child = execFile(program, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    // Never return subprocess errors: they can include command arguments or key material.
    if (err) reject(new CertificateError(program === 'docker' ? 'DOCKER_CHECK_FAILED' : 'OPENSSL_FAILED', 500));
    else resolve(stdout);
  });
  child.stdin?.on('error', () => {});
  child.stdin?.end(input || '');
});

export function redactBootstrapArgs(args: string[]): string[] {
  return args.map((arg, i) => args[i - 1] === '--password' ? '[REDACTED]'
    : arg.startsWith('--password=') ? '--password=[REDACTED]' : arg);
}

export function secretLogFilter(args: string[], emit: (s: string) => void) {
  const secrets = args.flatMap((arg, i) => arg.startsWith('--password=') ? [arg.slice(11)]
    : args[i - 1] === '--password' ? [arg] : []).filter(Boolean);
  const retain = Math.max(0, ...secrets.map(s => s.length - 1));
  let pending = '';
  return (chunk: string, flush = false) => {
    pending += chunk;
    for (const secret of secrets) pending = pending.split(secret).join('[REDACTED]');
    const end = flush ? pending.length : Math.max(0, pending.length - retain);
    if (end) emit(pending.slice(0, end));
    pending = pending.slice(end);
  };
}

function syncDir(dir: string) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function write(file: string, content: string | Buffer) {
  const fd = fs.openSync(file, 'w', 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function publicKey(key: crypto.KeyObject) {
  return key.export({ format: 'der', type: 'spki' }) as Buffer;
}
function privateKey(value: unknown): crypto.KeyObject {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) fail('MISSING_PRIVATE_KEYS');
  return crypto.createPrivateKey({ key: Buffer.from('302e020100300506032b657004220420' + value, 'hex'),
    format: 'der', type: 'pkcs8' });
}
function days(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 36500) fail('INVALID_CERTIFICATE_LIFETIME');
  return Number(value);
}
function directory(dir: string) {
  if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== path.resolve(dir)) fail('UNSAFE_CERTIFICATE_PATH');
}
function fingerprint(dir: string): string {
  directory(dir);
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    // Certificate directories are flat in symbol-bootstrap. Do not follow links.
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).nlink !== 1) fail('UNSUPPORTED_CERTIFICATE_LAYOUT');
    hash.update(name).update('\0').update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

/** Renew certificates, never node identity. Live directories are untouched until
 * all signatures, keys and REST copies pass validation. A crash during cutover
 * blocks further mutations until an operator inspects the persisted journal.
 */
export class CertificateRenewal {
  private job: Job | null = null;
  private executing = false;
  constructor(private target: string, private preset: string, private journal: string,
    private log: (message: string) => void, private run: Run = runCommand,
    private openssl = 'openssl', private switchDirs = switchDirectories) {
    if (!fs.existsSync(journal)) return;
    try {
      this.job = JSON.parse(fs.readFileSync(journal, 'utf8'));
      if (!this.job || !['preparing', 'applying', 'complete', 'failed', 'manual'].includes(this.job.state)
          || !Array.isArray(this.job.pairs)) throw new Error('Invalid journal');
      if (this.job.state === 'applying') this.job.state = 'manual';
      if (this.job.state === 'preparing') this.job.state = 'failed';
      this.save();
    } catch {
      this.job = { state: 'manual', mode: 'ca', work: '', pairs: [], error: 'CERTIFICATE_JOURNAL_UNREADABLE' };
    }
  }
  get busy() { return this.executing || !!this.job && ['preparing', 'applying', 'manual'].includes(this.job.state); }
  status() { return this.job ? structuredClone(this.job) : null; }
  private save() {
    fs.mkdirSync(path.dirname(this.journal), { recursive: true });
    write(this.journal + '.tmp', JSON.stringify(this.job, null, 2));
    fs.renameSync(this.journal + '.tmp', this.journal);
    syncDir(path.dirname(this.journal));
  }
  private async stopped() {
    const ids = (await this.run('docker', ['ps', '-aq'])).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) fail('DOCKER_CHECK_FAILED', 409);
    const containers = JSON.parse(await this.run('docker', ['inspect', ...ids]));
    if (!Array.isArray(containers) || containers.length !== ids.length) fail('DOCKER_CHECK_FAILED', 409);
    for (const c of containers) {
      if (!c.State || !Array.isArray(c.Mounts)) fail('DOCKER_CHECK_FAILED', 409);
      const name = String(c.Name).replace(/^\//, '');
      if (name === 'symbol-manager') continue;
      const usesTarget = c.Mounts.some((m: any) => {
        if (typeof m.Source !== 'string') return false;
        const source = path.resolve(m.Source), target = path.resolve(this.target);
        return source === target || source.startsWith(target + path.sep) || target.startsWith(source + path.sep);
      });
      if ((usesTarget || ['api-node-0', 'broker', 'db', 'rest-gateway'].includes(name))
          && !['exited', 'created', 'dead'].includes(c.State.Status)) fail('NODE_RUNNING', 409);
    }
  }
  async renew(password: string, mode: RenewalMode = 'node', force = false) {
    if (this.busy) fail('CERTIFICATE_RENEWAL_ACTIVE', 409);
    if (typeof password !== 'string' || !password.trim()) fail('PASSWORD_REQUIRED');
    if (!['node', 'ca'].includes(mode) || typeof force !== 'boolean') fail('INVALID_RENEWAL_OPTIONS');
    this.executing = true;
    let keysDir = '';
    let applying = false;
    try {
      await this.stopped();
      directory(this.target);
      const generated: any = yaml.load(fs.readFileSync(path.join(this.target, 'preset.yml'), 'utf8'));
      const custom: any = fs.existsSync(this.preset) ? yaml.load(fs.readFileSync(this.preset, 'utf8')) : {};
      if (/pqc/i.test(generated?.symbolServerImage || '')) fail('UNSUPPORTED_CERTIFICATE_LAYOUT');
      const addresses: any = yaml.load(fs.readFileSync(path.join(this.target, 'addresses.yml'), 'utf8'));
      if (addresses?.nodes?.length !== 1) fail('SINGLE_NODE_REQUIRED');
      const node = addresses.nodes[0];
      if (typeof node.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(node.name)) fail('UNSUPPORTED_CERTIFICATE_LAYOUT');
      const nodesDir = path.join(this.target, 'nodes');
      directory(nodesDir);
      const nodeDirs = fs.readdirSync(nodesDir).filter(name => fs.existsSync(path.join(nodesDir, name, 'cert')));
      if (nodeDirs.length !== 1 || nodeDirs[0] !== node.name
          || (Array.isArray(generated?.nodes) && generated.nodes.length !== 1)) fail('SINGLE_NODE_REQUIRED');
      let resolved: any;
      try { resolved = decryptAddressesObj({ main: node.main, transport: node.transport }, password); }
      catch { fail('INVALID_PASSWORD'); }
      const caKey = privateKey(resolved?.main?.privateKey);
      const nodeKey = privateKey(resolved?.transport?.privateKey);
      const certDir = path.join(this.target, 'nodes', node.name, 'cert');
      const originalHash = fingerprint(certDir);
      const ca = new crypto.X509Certificate(fs.readFileSync(path.join(certDir, 'ca.cert.pem')));
      const leaf = new crypto.X509Certificate(fs.readFileSync(path.join(certDir, 'node.crt.pem')));
      if (ca.publicKey.asymmetricKeyType !== 'ed25519' || leaf.publicKey.asymmetricKeyType !== 'ed25519'
          || ca.subjectAltName || leaf.subjectAltName || !ca.ca || leaf.ca) fail('UNSUPPORTED_CERTIFICATE_PROFILE');
      if (!publicKey(ca.publicKey).equals(publicKey(crypto.createPublicKey(caKey)))
          || !publicKey(leaf.publicKey).equals(publicKey(crypto.createPublicKey(nodeKey)))
          || !publicKey(leaf.publicKey).equals(publicKey(crypto.createPublicKey(fs.readFileSync(path.join(certDir, 'node.key.pem')))))
          || !ca.verify(ca.publicKey) || !leaf.verify(ca.publicKey)) fail('CERTIFICATE_KEY_MISMATCH');

      const warningDays = days(custom?.certificateWarningInDays ?? generated?.certificateWarningInDays ?? 30);
      const renewLeaf = mode === 'ca' || force || Date.parse(leaf.validTo) - Date.now() <= warningDays * 86400000;
      let nodeDays = days(custom?.nodeCertificateExpirationInDays ?? generated?.nodeCertificateExpirationInDays ?? 375);
      const caDays = days(custom?.caCertificateExpirationInDays ?? generated?.caCertificateExpirationInDays ?? 7300);
      if (mode === 'ca' && caDays <= nodeDays) fail('CA_LIFETIME_TOO_SHORT');
      if (mode === 'node') {
        const remaining = Math.floor((Date.parse(ca.validTo) - Date.now() - 60000) / 86400000);
        if (remaining < 1 || Date.parse(ca.validFrom) > Date.now()) fail('CA_RENEWAL_REQUIRED');
        nodeDays = Math.min(nodeDays, remaining);
      }

      const backupRoot = path.join(this.target, 'certificate-backups');
      fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      directory(backupRoot);
      const work = fs.mkdtempSync(path.join(backupRoot, 'renew-'));
      fs.chmodSync(work, 0o700);
      const staged = path.join(work, 'node');
      const originals = path.join(work, 'original');
      fs.mkdirSync(originals, { mode: 0o700 });
      fs.cpSync(certDir, staged, { recursive: true });
      this.job = { state: 'preparing', mode, work, pairs: [[certDir, staged, path.join(originals, 'node')]] };
      this.save();
      this.log('[Cert] Preparing certificates with unchanged CA and transport keys.\n');
      keysDir = path.join(work, 'keys');
      fs.mkdirSync(keysDir, { mode: 0o700 });
      const passphrase = crypto.randomBytes(32).toString('hex');
      for (const [name, key] of [['ca', caKey], ['node', nodeKey]] as const) {
        write(path.join(keysDir, name + '.pem'), key.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase }));
      }
      const ssl = (args: string[]) => this.run(this.openssl, args, passphrase + '\n');
      if (mode === 'ca') {
        write(path.join(keysDir, 'ca.ext'), 'basicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
        await ssl(['x509', '-x509toreq', '-in', path.join(certDir, 'ca.cert.pem'), '-signkey', path.join(keysDir, 'ca.pem'),
          '-passin', 'stdin', '-out', path.join(keysDir, 'ca.csr')]);
        await ssl(['x509', '-req', '-in', path.join(keysDir, 'ca.csr'), '-signkey', path.join(keysDir, 'ca.pem'),
          '-passin', 'stdin', '-days', String(caDays), '-set_serial', '0x' + crypto.randomBytes(19).toString('hex'),
          '-extfile', path.join(keysDir, 'ca.ext'), '-out', path.join(staged, 'ca.cert.pem')]);
      }
      if (renewLeaf) {
        write(path.join(keysDir, 'node.ext'), 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
        await ssl(['x509', '-x509toreq', '-in', path.join(certDir, 'node.crt.pem'), '-signkey', path.join(keysDir, 'node.pem'),
          '-passin', 'stdin', '-out', path.join(keysDir, 'node.csr')]);
        await ssl(['x509', '-req', '-in', path.join(keysDir, 'node.csr'), '-CA', path.join(staged, 'ca.cert.pem'),
          '-CAkey', path.join(keysDir, 'ca.pem'), '-passin', 'stdin', '-days', String(nodeDays),
          '-set_serial', '0x' + crypto.randomBytes(19).toString('hex'), '-extfile', path.join(keysDir, 'node.ext'),
          '-out', path.join(staged, 'node.crt.pem')]);
      }
      const newCa = new crypto.X509Certificate(fs.readFileSync(path.join(staged, 'ca.cert.pem')));
      const newLeaf = new crypto.X509Certificate(fs.readFileSync(path.join(staged, 'node.crt.pem')));
      if (!publicKey(newCa.publicKey).equals(publicKey(ca.publicKey)) || !publicKey(newLeaf.publicKey).equals(publicKey(leaf.publicKey))
          || newCa.subject !== ca.subject || newLeaf.subject !== leaf.subject || !newCa.ca || newLeaf.ca
          || !newCa.verify(newCa.publicKey) || !newLeaf.verify(newCa.publicKey)
          || Date.parse(newLeaf.validTo) > Date.parse(newCa.validTo)) fail('CERTIFICATE_VALIDATION_FAILED', 500);
      await ssl(['verify', '-CAfile', path.join(staged, 'ca.cert.pem'), path.join(staged, 'node.crt.pem')]);
      write(path.join(staged, 'node.full.crt.pem'), fs.readFileSync(path.join(staged, 'node.crt.pem'), 'utf8').trimEnd()
        + '\n' + fs.readFileSync(path.join(staged, 'ca.cert.pem'), 'utf8'));
      // Never retain bootstrap signing keys or stale signing work files in the live cert directory.
      for (const name of ['ca.key.pem', 'ca.der', 'node.der', 'node.csr.pem']) fs.rmSync(path.join(staged, name), { force: true });
      const sources = new Map([[certDir, originalHash]]);
      const gateways = path.join(this.target, 'gateways');
      if (fs.existsSync(gateways)) {
        directory(gateways);
        for (const name of fs.readdirSync(gateways)) {
          if (!/^[a-zA-Z0-9_-]+$/.test(name)) fail('UNSUPPORTED_CERTIFICATE_LAYOUT');
          const live = path.join(gateways, name, 'api-node-config', 'cert');
          sources.set(live, fingerprint(live));
          const dest = path.join(work, 'gateway-' + name);
          fs.cpSync(live, dest, { recursive: true });
          for (const file of ['ca.cert.pem', 'node.crt.pem', 'node.key.pem', 'node.full.crt.pem']) {
            write(path.join(dest, file), fs.readFileSync(path.join(staged, file)));
          }
          for (const file of ['rest-ca.key.pem', 'rest-ca.cert.pem', 'rest-ca.cert.srl', 'node.csr.pem']) fs.rmSync(path.join(dest, file), { force: true });
          this.job.pairs.push([live, dest, path.join(originals, 'gateway-' + name)]);
        }
      }
      fs.rmSync(keysDir, { recursive: true });
      keysDir = '';
      // Flush all staged files before writing the applying journal and renaming.
      for (const [live, dir] of this.job.pairs) {
        const owner = fs.statSync(live);
        fs.chmodSync(dir, owner.mode & 0o777);
        if (process.platform !== 'win32') fs.chownSync(dir, owner.uid, owner.gid);
        for (const name of fs.readdirSync(dir)) {
          const original = path.join(live, name);
          const permissions = fs.existsSync(original) ? fs.statSync(original) : owner;
          if (process.platform !== 'win32') fs.chownSync(path.join(dir, name), permissions.uid, permissions.gid);
          fs.chmodSync(path.join(dir, name), fs.existsSync(original) ? permissions.mode & 0o777 : 0o600);
          const fd = fs.openSync(path.join(dir, name), process.platform === 'win32' ? 'r+' : 'r');
          try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        syncDir(dir);
      }
      syncDir(work); syncDir(backupRoot);
      await this.stopped();
      for (const [dir, hash] of sources) if (fingerprint(dir) !== hash) fail('CERTIFICATES_CHANGED', 409);
      this.job.state = 'applying';
      this.save();
      applying = true;
      this.switchDirs(this.job.pairs);
      this.job.state = 'complete';
      this.save();
      this.log('[Cert] Certificate transaction complete; original certificates retained. Restart node and REST.\n');
      return { success: true, renewed: renewLeaf, caRenewed: mode === 'ca', backupDir: originals };
    } catch (error) {
      const code = error instanceof CertificateError ? error.code : 'CERTIFICATE_RENEWAL_FAILED';
      if (this.job && this.job.state !== 'complete') {
        this.job.state = applying ? 'manual' : 'failed'; this.job.error = code;
        try { this.save(); } catch { this.job.state = 'manual'; }
      } else if (applying && this.job) {
        this.job.state = 'manual'; this.job.error = code;
        try { this.save(); } catch { /* Applying journal remains the restart guard. */ }
      }
      this.log(`[Cert] ${code}${this.job?.state === 'manual' ? '; manual inspection required.' : ''}\n`);
      throw error instanceof CertificateError ? error : new CertificateError(code, 500);
    } finally {
      if (keysDir) { try { fs.rmSync(keysDir, { recursive: true, force: true }); } catch { /* Keys are encrypted with an ephemeral password. */ } }
      this.executing = false;
    }
  }
}
