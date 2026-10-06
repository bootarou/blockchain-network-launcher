import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const DEFAULT_NOFILE = 65536;
export type RuntimeSettings = { debug: boolean; nofile: number };
type Docker = (args: string[]) => Promise<string>;
const docker: Docker = async args => (await exec('docker', args, { timeout: 15000, maxBuffer: 2 * 1024 ** 2 })).stdout;

export function validateSettings(value: any): RuntimeSettings {
  if (!value || typeof value.debug !== 'boolean' || !Number.isSafeInteger(value.nofile)
      || value.nofile < 65536 || value.nofile > 1048576) {
    throw new Error('debug must be boolean; nofile must be an integer from 65536 to 1048576.');
  }
  return { debug: value.debug, nofile: value.nofile };
}

// Change only logging thresholds, retaining rotation, paths and sink types.
export function setLoggingLevel(text: string, debug: boolean): string {
  let section = '';
  const seen = new Set<string>();
  const result = text.split(/\r?\n/).map(line => {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1];
    if (['console', 'file'].includes(section) && /^\s*level\s*=/.test(line)) {
      seen.add(section);
      return `level = ${debug ? 'Debug' : 'Info'}`;
    }
    // Explicit component overrides otherwise mask the selected threshold.
    if (['console.component.levels', 'file.component.levels'].includes(section)
        && /^\s*[^#;\s][^=]*=/.test(line)) {
      return line.replace(/=.*/, `= ${debug ? 'Debug' : 'Info'}`);
    }
    return line;
  }).join('\n');
  if (seen.size !== 2) throw new Error('Logging configuration must contain console.level and file.level.');
  return result;
}

export function catapultServices(doc: any): [string, any][] {
  return Object.entries(doc?.services || {}).filter(([, value]: [string, any]) => {
    const volumes = value.volumes || [];
    return volumes.some((v: any) => typeof v === 'string'
      ? /:\/symbol-workdir(?::|$)/.test(v) : v?.target === '/symbol-workdir');
  });
}

export function patchNofile(doc: any, nofile: number): void {
  const services = catapultServices(doc);
  if (!services.length) throw new Error('No Catapult services with /symbol-workdir mount found.');
  for (const [, service] of services) {
    service.ulimits = { ...service.ulimits, nofile: { soft: nofile, hard: nofile } };
  }
}

export class NodeRuntime {
  constructor(private target: string, private settingsFile: string, private run: Docker = docker) {}
  settings(): RuntimeSettings {
    if (!fs.existsSync(this.settingsFile)) return { debug: false, nofile: DEFAULT_NOFILE };
    return validateSettings(JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')));
  }
  save(value: unknown): RuntimeSettings {
    const settings = validateSettings(value);
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    const tmp = this.settingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.settingsFile);
    return settings;
  }
  private composePath() { return path.join(this.target, 'docker/docker-compose.yml'); }
  private compose() { return yaml.load(fs.readFileSync(this.composePath(), 'utf8')) as any; }
  private resources(): string[] {
    const nodes = path.join(this.target, 'nodes');
    if (!fs.existsSync(nodes)) return [];
    return fs.readdirSync(nodes, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d =>
      ['server-config', 'broker-config'].map(c => path.join(nodes, d.name, c, 'resources'))
        .filter(p => fs.existsSync(p)));
  }
  // Called immediately before docker compose up, after bootstrap generation.
  apply(): void {
    const settings = this.settings();
    const doc = this.compose();
    patchNofile(doc, settings.nofile);
    const edits: [string, string][] = [];
    for (const dir of this.resources()) {
      for (const file of fs.readdirSync(dir).filter(f => /^config-logging-(server|broker|recovery)\.properties$/.test(f))) {
        const filename = path.join(dir, file);
        // Until the UI has been used, preserve custom log levels.
        if (fs.existsSync(this.settingsFile)) edits.push([filename, setLoggingLevel(fs.readFileSync(filename, 'utf8'), settings.debug)]);
      }
    }
    for (const [file, content] of edits) fs.writeFileSync(file, content);
    fs.writeFileSync(this.composePath(), yaml.dump(doc, { lineWidth: 120, noRefs: true }));
  }
  async status() {
    const configurations = this.resources().map(dir => {
      const node = path.join(dir, 'config-node.properties');
      const maxOpenFiles = fs.existsSync(node)
        ? fs.readFileSync(node, 'utf8').match(/^\s*maxOpenFiles\s*=\s*([^\r\n#]+)/m)?.[1]?.trim() ?? null : null;
      const logging = fs.readdirSync(dir).filter(f => /^config-logging-(server|broker|recovery)\.properties$/.test(f)).map(file => ({
        file, levels: [...fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/^\s*level\s*=\s*(\w+)/gm)].map(m => m[1]),
      }));
      return { resources: path.relative(this.target, dir), maxOpenFiles, logging };
    });
    const containers: any[] = [];
    if (fs.existsSync(this.composePath())) {
      for (const [service, config] of catapultServices(this.compose())) {
        const entry: any = { service, configuredNofile: config.ulimits?.nofile ?? null, processes: [] };
        try {
          const ids = (await this.run(['compose', '-f', this.composePath(), 'ps', '-a', '-q', service])).trim().split(/\s+/).filter(Boolean);
          if (!ids.length) { entry.state = 'not-created'; }
          for (const id of ids) {
            const [info] = JSON.parse(await this.run(['inspect', id]));
            entry.state = info.State.Status;
            entry.containerNofile = info.HostConfig.Ulimits?.find((u: any) => u.Name === 'nofile') ?? null;
            if (info.State.Running && !info.State.Paused) {
              const output = await this.run(['exec', id, 'sh', '-c',
                'for p in /proc/[0-9]*; do [ -r "$p/comm" ] || continue; n=$(cat "$p/comm"); case "$n" in catapult*) limits=$(awk \'/^Max open files/ {print $4, $5}\' "$p/limits"); count=$(ls -1 "$p/fd" 2>/dev/null | wc -l); echo "${p##*/} $n $limits $count";; esac; done']);
              entry.processes.push(...output.trim().split('\n').filter(Boolean).map(line => {
                const [pid, name, soft, hard, open] = line.trim().split(/\s+/);
                return { pid, name, soft, hard, open };
              }));
            }
          }
        } catch (e: any) { entry.error = e.message; }
        containers.push(entry);
      }
    }
    return { settings: this.settings(), managed: fs.existsSync(this.settingsFile), configurations, containers };
  }
}
