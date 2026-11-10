import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {LocalServiceClient} from '../services/local-endpoint.js';
import {ServiceError} from '../services/contracts.js';
import {privateDirectory} from './files.js';
import {SessionRepository, type SessionManifest, type SessionOwner} from './repository.js';
import {lockExecutable} from './locks.js';
import {managementRoot, sessionName} from './context.js';

export interface LaunchInstallation { appRoot: string; executable: string; packaged: boolean }
export function launchPlan(installation: LaunchInstallation, personalRoot: string, name?: string, environment = process.env) {
  if (name !== undefined) sessionName(name);
  const env: NodeJS.ProcessEnv = {...environment, ARES_PROFILE_DIR: fs.realpathSync(personalRoot)};
  // A new window selects data explicitly; inherited game/target overrides cannot
  // turn a personal window into a named one or silently start its parent's game.
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'ARES_SAVE_DIR', 'ARES_SETTINGS',
    'ARES_ROM', 'ARES_SYSTEM', 'ARES_DEV_SESSION', 'ARES_TARGET', 'ARES_INSTANCE_NAME', 'ARES_SESSION_NAME']) delete env[key];
  const args = [...(installation.packaged ? [] : [installation.appRoot]), ...(name ? ['--session-name', name, '--services'] : [])];
  return {executable: installation.executable, args, env};
}

export function launchWindow(installation: LaunchInstallation, personalRoot: string, name?: string): number {
  const plan = launchPlan(installation, personalRoot, name);
  return spawnWindow(plan, personalRoot, installation);
}

export function spawnWindow(plan: {executable: string; args: string[]; env: NodeJS.ProcessEnv}, personalRoot: string, installation?: LaunchInstallation): number {
  fs.mkdirSync(personalRoot, {recursive: true, mode: 0o700});
  const launches = privateDirectory(path.join(managementRoot(personalRoot), 'launches'));
  const directory = privateDirectory(path.join(launches, randomUUID()));
  if (installation && !installation.packaged) snapshotCheckout(installation, plan, directory);
  const log = fs.openSync(path.join(directory, 'launch.log'), 'wx', 0o600);
  try {
    const child = spawn(plan.executable, plan.args, {env: plan.env, detached: true, stdio: ['ignore', log, log]});
    child.on('error', () => {});
    child.unref();
    if (!child.pid) throw new Error('app_launch_failed');
    return child.pid;
  } finally { fs.closeSync(log); }
}

/** A child must outlive a development launcher's temporary installation and
 * checkout rebuilds. Only dependencies/plugin sources refer to canonical stable
 * source paths; compiled UI, native executable and resources are copied. */
export function snapshotCheckout(installation: LaunchInstallation, plan: ReturnType<typeof launchPlan>, directory: string): void {
  const runtime = privateDirectory(path.join(directory, 'app'));
  const copy = (from: string, to: string) => fs.cpSync(from, to, {recursive: true, mode: fs.constants.COPYFILE_FICLONE});
  for (const name of ['dist', 'index.html', 'style.css', 'templates', 'assets']) {
    const source = path.join(installation.appRoot, name);
    if (fs.existsSync(source)) copy(source, path.join(runtime, name));
  }
  for (const name of ['node_modules', 'bundled-plugins']) {
    const source = path.join(installation.appRoot, name);
    if (fs.existsSync(source)) fs.symlinkSync(fs.realpathSync(source), path.join(runtime, name), 'dir');
  }
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({name:'ares',type:'module',main:'dist/main.js'}), {mode: 0o600});
  const native = privateDirectory(path.join(runtime, 'native', 'bin'));
  const sourceHost = plan.env.ARES_HOST || path.join(installation.appRoot, 'native', 'bin', 'ares-electron-host');
  const actualHost = fs.existsSync(sourceHost) ? sourceHost : lockExecutable();
  copy(actualHost, path.join(native, 'ares-electron-host'));
  const database = path.join(plan.env.ARES_RESOURCE_DIR || path.dirname(actualHost), 'Database');
  if (fs.existsSync(database)) {
    copy(database, path.join(native, 'Database'));
    copy(database, path.join(path.dirname(native), 'Database'));
  }
  plan.args[0] = runtime;
  plan.env.ARES_HOST = path.join(native, 'ares-electron-host');
  plan.env.ARES_RESOURCE_DIR = native;
  delete plan.env.ARES_DEV_RELOAD;
}

/** Called only after a kernel ownership check found the name busy. An owner
 * record is a hint for authenticated readiness, never permission to steal it. */
export async function waitForNamedOwner(repository: SessionRepository, manifest: SessionManifest, timeoutMs = 20000, signal?: AbortSignal): Promise<SessionOwner> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    signal?.throwIfAborted();
    const owner = repository.owner(manifest.id);
    if (owner) {
      const file = path.join(owner.serviceDirectory, `${owner.instanceId}.json`);
      const client = new LocalServiceClient(file, owner.instanceId, Math.min(1000, Math.max(1, deadline - Date.now())));
      const aborted = () => client.close();
      signal?.addEventListener('abort', aborted, {once: true});
      try {
        signal?.throwIfAborted();
        const status = await client.manage({operation: 'app_status'});
        signal?.throwIfAborted();
        if (status.instance !== owner.instanceId || status.kind !== 'named' || status.session_id !== manifest.id || status.session_name !== manifest.name)
          throw new Error('session_owner_mismatch');
        if (status.ready === true) return {...owner, ready: true};
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ServiceError && ['app_not_running', 'app_disconnected', 'instance_not_running', 'request_timeout'].includes(error.code))) throw error;
      } finally { signal?.removeEventListener('abort', aborted); client.close(); }
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      const timer = setTimeout(() => { cleanup(); resolve(); }, 25);
      const aborted = () => { clearTimeout(timer); cleanup(); reject(signal!.reason); };
      signal?.addEventListener('abort', aborted, {once: true});
      if (signal?.aborted) aborted();
    });
  }
  throw new Error('session_busy_unreachable');
}

export async function openNamedWindow(repository: SessionRepository, name: string, installation: LaunchInstallation, signal?: AbortSignal): Promise<SessionOwner> {
  signal?.throwIfAborted();
  const manifest = await repository.resolve(name);
  signal?.throwIfAborted();
  try {
    const lock = await repository.lifecycle(manifest.id);
    await lock.release();
  } catch (error) {
    if ((error as Error).message !== 'storage_busy') throw error;
    return waitForNamedOwner(repository, manifest, 20000, signal);
  }
  signal?.throwIfAborted();
  launchWindow(installation, repository.personalRoot, name);
  return waitForNamedOwner(repository, manifest, 20000, signal);
}
