import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';

export interface BackupFile {
  id: string;
  filename: string;
  full: boolean;
  createdAt: string;
  state: 'creating' | 'ready' | 'failed';
  bytes: number;
  processedFiles: number;
  error?: string;
}

interface Source { diskPath: string; zipPath: string }

/** Completed archives outlive the HTTP request and the node's target directory. */
export class BackupFiles {
  private jobs = new Map<string, BackupFile>();
  private active = false;
  private archive: ReturnType<typeof archiver> | null = null;

  constructor(private directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const id = name.slice(0, -5);
      let job: BackupFile;
      try { job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); }
      catch (error) { console.error(`[Backup] Cannot read ${name}:`, error); continue; }
      if (job.id !== id) continue;
      if (job.state === 'creating') {
        // Never advertise an archive that did not complete before shutdown.
        job.state = 'failed';
        job.error = 'Backup creation was interrupted. Please create it again.';
        fs.rmSync(this.filePath(id) + '.part', { force: true });
        fs.rmSync(this.filePath(id), { force: true });
        this.save(job);
      } else if (job.state === 'ready' && !fs.existsSync(this.filePath(id))) {
        job.state = 'failed';
        job.error = 'Backup file is missing.';
        this.save(job);
      }
      this.jobs.set(id, job);
    }
  }

  get busy() { return this.active; }
  private snapshot(job: BackupFile) {
    return { ...job, bytes: job.state === 'creating' ? this.archive?.pointer() ?? job.bytes : job.bytes };
  }
  list() { return [...this.jobs.values()].map(j => this.snapshot(j)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string) { const j = this.jobs.get(id); return j ? this.snapshot(j) : undefined; }
  filePath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid backup ID');
    return path.join(this.directory, `${id}.zip`);
  }
  private save(job: BackupFile) {
    const file = path.join(this.directory, `${job.id}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  start(full: boolean, files: Source[], directories: Source[], metadata: unknown): BackupFile {
    if (this.active) throw new Error('A backup is already being created.');
    const createdAt = new Date().toISOString();
    const job: BackupFile = {
      id: crypto.randomUUID(), full, createdAt, state: 'creating', bytes: 0, processedFiles: 0,
      filename: `node-${full ? 'full-' : ''}backup-${createdAt.replace(/[:.]/g, '-').slice(0, 19)}.zip`,
    };
    this.save(job);
    this.jobs.set(job.id, job);
    this.active = true;
    void this.create(job, files, directories, metadata);
    return { ...job };
  }

  private async create(job: BackupFile, files: Source[], directories: Source[], metadata: unknown) {
    const partial = this.filePath(job.id) + '.part';
    const archive = archiver('zip', { forceZip64: true, zlib: { level: 6 } });
    this.archive = archive;
    const output = fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 });
    archive.on('progress', progress => {
      job.bytes = archive.pointer();
      job.processedFiles = progress.entries.processed;
    });
    // Missing/unreadable input must fail, not silently produce an incomplete backup.
    archive.on('warning', error => archive.destroy(error));
    const written = pipeline(archive, output);
    // Attach immediately: input discovery and output errors can happen before finalize.
    void written.catch(() => {});
    try {
      archive.append(JSON.stringify(metadata, null, 2), { name: 'backup-meta.json' });
      for (const file of files) archive.file(file.diskPath, { name: file.zipPath });
      for (const dir of directories) {
        archive.directory(dir.diskPath, dir.zipPath, entry => {
          const name = entry.name;
          return name.endsWith('.lock') || name.endsWith('server-recovery.started') ? false : entry;
        });
      }
      // pipeline observes both archive and disk errors; finalize need not resolve after an abort.
      void archive.finalize().catch(error => archive.destroy(error));
      await written;
      job.bytes = fs.statSync(partial).size;
      fs.renameSync(partial, this.filePath(job.id));
      job.state = 'ready';
      this.save(job);
    } catch (error) {
      archive.abort();
      archive.destroy();
      output.destroy();
      await written.catch(() => {});
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      try {
        fs.rmSync(partial, { force: true });
        fs.rmSync(this.filePath(job.id), { force: true });
        this.save(job);
      } catch (cleanupError) { console.error('[Backup] Failed to persist failure:', cleanupError); }
    } finally {
      this.archive = null;
      this.active = false;
    }
  }

  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Backup not found');
    if (job.state === 'creating') throw new Error('Backup is being created');
    fs.rmSync(this.filePath(id), { force: true });
    fs.rmSync(this.filePath(id) + '.part', { force: true });
    fs.rmSync(path.join(this.directory, `${id}.json`), { force: true });
    this.jobs.delete(id);
  }
}
