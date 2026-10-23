import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalServiceClient, readConnection, namedConnection } from './local-endpoint.js';
import { ServiceError } from './contracts.js';

/** Discover a running app before launching. A launched GUI outlives this adapter. */
export class AutomaticServiceClient extends LocalServiceClient {
  launchedApp = false;
  private launchedInstance?: string;
  constructor(private directory: string, private name?: string) { super('', ''); }
  private async discover() {
    let files: string[];
    try { files = this.name ? [path.basename(namedConnection(this.directory, this.name))] :
      (await fs.readdir(this.directory)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const live: { file: string; instance: string; ready: boolean }[] = [];
    for (const file of files) {
      const metadata = path.join(this.directory, file);
      let probe: LocalServiceClient | undefined;
      try {
        // readConnection validates permissions and shape before credentials are used.
        // Named selection obtains the instance through the same validated reader.
        probe = this.name ? LocalServiceClient.named(this.directory, this.name, 1000) :
          new LocalServiceClient(metadata, path.basename(file, '.json'), 1000);
        const status = await probe.manage({ operation: 'app_status' });
        const instance = this.name ? JSON.parse(await fs.readFile(metadata, 'utf8')).instance : path.basename(file, '.json');
        await readConnection(metadata, instance);
        live.push({ file: metadata, instance, ready: status.ready === true });
      } catch (e) {
        if (!(e instanceof ServiceError && ['app_not_running', 'instance_not_running', 'app_disconnected'].includes(e.code))) throw e;
      } finally { probe?.close(); }
    }
    if (live.length > 1) throw new ServiceError('multiple_apps_running');
    return live[0];
  }
  protected override async resolveConnection() {
    const found = await this.discover();
    if (found) {
      const deadline = Date.now() + 20000;
      let target = found;
      while (!target.ready && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const next = await this.discover();
        if (!next) throw new ServiceError('app_disconnected');
        target = next;
      }
      if (!target.ready) throw new ServiceError('app_startup_timeout');
      this.launchedApp = target.instance === this.launchedInstance;
      return target;
    }
    const appRoot = fileURLToPath(new URL('../../', import.meta.url));
    const bundled = appRoot.includes(`${path.sep}Contents${path.sep}Resources${path.sep}`);
    const executable = bundled ? path.resolve(appRoot, '../../MacOS/Ares') :
      process.versions.electron ? process.execPath : path.join(appRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const env: NodeJS.ProcessEnv = { ...process.env, ARES_SERVICE_DIR: this.directory };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const logDirectory = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : (await import('node:os')).tmpdir(), 'ares-launch-'));
    const logPath = path.join(logDirectory, 'stderr.log');
    const log = await fs.open(logPath, 'wx', 0o600);
    try {
      const child = spawn(executable, [...(bundled ? [] : [appRoot]), '--services', ...(this.name ? ['--instance-name', this.name] : [])],
        { env, detached: true, stdio: ['ignore', 'ignore', log.fd] });
      let failure = '', exited = false;
      child.on('error', e => { failure = e.message; exited = true; });
      child.on('exit', () => { exited = true; });
      child.unref();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const target = await this.discover();
        if (target?.ready) { this.launchedInstance = !exited ? target.instance : undefined; this.launchedApp = !exited; return target; }
        if (exited) {
          failure += await fs.readFile(logPath, 'utf8');
          throw new ServiceError(failure.includes('profile_in_use') ? 'profile_in_use' : 'app_launch_failed');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new ServiceError('app_launch_timeout');
    } finally {
      await log.close();
      // The app retains its own descriptor, so adapter exit cannot break stderr.
      await fs.rm(logDirectory, { recursive: true, force: true });
    }
  }
}
