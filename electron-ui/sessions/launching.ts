import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {LocalServiceClient} from '../services/local-endpoint.js';
import {ServiceError} from '../services/contracts.js';
import {privateDirectory} from './files.js';
import {SessionRepository, type SessionManifest, type SessionOwner} from './repository.js';
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
  const launches = privateDirectory(path.join(managementRoot(personalRoot), 'launches'));
  const directory = privateDirectory(path.join(launches, randomUUID()));
  const log = fs.openSync(path.join(directory, 'launch.log'), 'wx', 0o600);
  try {
    const child = spawn(plan.executable, plan.args, {env: plan.env, detached: true, stdio: ['ignore', log, log]});
    child.on('error', () => {});
    child.unref();
    if (!child.pid) throw new Error('app_launch_failed');
    return child.pid;
  } finally { fs.closeSync(log); }
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
