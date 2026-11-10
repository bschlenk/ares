import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareManagementRoot, personalContext, sessionName, uuid, type AppContext} from './context.js';
import {privateDirectory, publish, publishJson, readJson, syncDirectory} from './files.js';
import {KernelLock, withLock} from './locks.js';
import {settingsSnapshotSync} from '../settings/transaction.js';

export type InheritancePolicy = 'inherit-personal' | 'fresh';
export type SessionManifest = {version: 1; id: string; name: string; generation: string};
type Registry = {version: 1; sessions: Record<string, string>};
export type GenerationData = {version: 1; policy: InheritancePolicy; initialized: Record<string, unknown>; personalStates: string};
export type SessionOwner = {version: 1; sessionId: string; instanceId: string; ready: boolean; serviceDirectory: string};

/** Namespace identity follows the personal data directory, never the checkout or service directory. */
export class SessionRepository {
  readonly root: string;
  constructor(readonly personalRoot: string, private fault: (point: string) => void = () => {}) {
    fs.mkdirSync(personalRoot, {recursive: true, mode: 0o700});
    this.personalRoot = fs.realpathSync(personalRoot);
    this.root = prepareManagementRoot(this.personalRoot);
  }
  private registry(): Registry {
    try {
      const registry = readJson<Registry>(path.join(this.root, 'registry.json'), 1024 * 1024, true);
      if (registry.version !== 1 || !registry.sessions || typeof registry.sessions !== 'object' || Array.isArray(registry.sessions)) throw new Error('invalid_session_registry');
      for (const [name, id] of Object.entries(registry.sessions)) { sessionName(name); if (!uuid(id)) throw new Error('invalid_session_registry'); }
      return registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, sessions: {}};
      throw error;
    }
  }
  directory(id: string): string {
    if (!uuid(id)) throw new Error('invalid_session_id');
    return privateDirectory(path.join(privateDirectory(path.join(this.root, 'sessions')), id));
  }
  manifest(id: string): SessionManifest {
    const manifest = readJson<SessionManifest>(path.join(this.directory(id), 'session.json'), 8192, true);
    if (manifest.version !== 1 || manifest.id !== id || !uuid(manifest.generation)) throw new Error('invalid_session_manifest');
    sessionName(manifest.name);
    const generations = privateDirectory(path.join(this.directory(id), 'generations'));
    const generation = path.join(generations, manifest.generation);
    if (!fs.lstatSync(generation).isDirectory()) throw new Error('invalid_session_generation');
    privateDirectory(generation);
    const data = readJson<GenerationData>(path.join(generation, 'data.json'), 1024 * 1024, true);
    if (data.version !== 1 || !['inherit-personal', 'fresh'].includes(data.policy) || !data.initialized || typeof data.initialized !== 'object' || Array.isArray(data.initialized) || !path.isAbsolute(data.personalStates)) throw new Error('invalid_session_generation');
    return manifest;
  }
  lifecycle(id: string, timeoutMs = 0, onLost?: () => void): Promise<KernelLock> {
    if (!uuid(id)) throw new Error('invalid_session_id');
    return KernelLock.acquire(path.join(this.root, 'locks', `session-${id}.lock`), {timeoutMs, onLost});
  }
  owner(id: string): SessionOwner | undefined {
    if (!uuid(id)) throw new Error('invalid_session_id');
    try {
      const owner = readJson<SessionOwner>(path.join(this.root, 'locks', `session-${id}.owner.json`), 8192, true);
      if (owner.version !== 1 || owner.sessionId !== id || !uuid(owner.instanceId) || typeof owner.ready !== 'boolean' ||
        typeof owner.serviceDirectory !== 'string' || !path.isAbsolute(owner.serviceDirectory)) throw new Error('invalid_session_owner');
      return owner;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  advertise(context: AppContext, lock: KernelLock, ready: boolean, serviceDirectory: string): void {
    if (context.kind !== 'named' || !context.sessionId) throw new Error('named_session_required');
    lock.assertHeld();
    publishJson(path.join(this.root, 'locks', `session-${context.sessionId}.owner.json`), {
      version: 1, sessionId: context.sessionId, instanceId: context.instanceId, ready, serviceDirectory: path.resolve(serviceDirectory),
    } satisfies SessionOwner);
  }
  async list(): Promise<SessionManifest[]> {
    return withLock(path.join(this.root, 'locks', 'registry.lock'), () => Object.values(this.registry().sessions).map(id => this.manifest(id)));
  }
  private buildGeneration(directory: string, policy: InheritancePolicy): void {
    privateDirectory(directory);
    for (const name of ['saves', 'states', 'plugins', 'paired-recovery']) privateDirectory(path.join(directory, name));
    settingsSnapshotSync(path.join(this.personalRoot, 'preferences.json'), settings => {
      const values = policy === 'fresh' ? Object.create(null) : {...settings.values};
      const personalStates = typeof settings.values['states.root'] === 'string' ? settings.values['states.root'] : path.join(this.personalRoot, 'states');
      const source = typeof values['paths.importBml'] === 'string' ? values['paths.importBml'] : path.join(this.personalRoot, 'settings.bml');
      if (policy === 'inherit-personal') {
        try { publish(path.join(directory, 'settings.bml'), fs.readFileSync(source)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      values['states.root'] = path.join(directory, 'states');
      values['paths.importBml'] = path.join(directory, 'settings.bml');
      publishJson(path.join(directory, 'preferences.json'), {version: 1, revision: 0, values});
      publishJson(path.join(directory, 'data.json'), {version: 1, policy, initialized: {}, personalStates} satisfies GenerationData);
    });
    syncDirectory(directory);
  }
  async resolve(name: string): Promise<SessionManifest> {
    sessionName(name);
    return withLock(path.join(this.root, 'locks', 'registry.lock'), lock => this.resolveLocked(name, lock));
  }
  resolveSync(name: string): SessionManifest {
    sessionName(name);
    const lock = KernelLock.acquireSync(path.join(this.root, 'locks', 'registry.lock'));
    try { return this.resolveLocked(name, lock); } finally { void lock.release(); }
  }
  private resolveLocked(name: string, lock: KernelLock): SessionManifest {
    const registry = this.registry();
    for (;;) {
      const journalFile = path.join(this.root, 'creating.json');
      let intent: {version: 1; name: string; id: string; generation: string};
      try {
        intent = readJson(journalFile, 8192, true);
        if (intent.version !== 1 || !uuid(intent.id) || !uuid(intent.generation)) throw new Error('invalid_creation_journal');
        sessionName(intent.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (Object.hasOwn(registry.sessions, name)) return this.manifest(registry.sessions[name]);
        intent = {version: 1, name, id: randomUUID(), generation: randomUUID()};
        publishJson(journalFile, intent);
        this.fault('creation-intent');
      }
      if (Object.hasOwn(registry.sessions, intent.name)) {
        if (registry.sessions[intent.name] !== intent.id) throw new Error('invalid_creation_journal');
        this.manifest(intent.id);
        fs.unlinkSync(journalFile); syncDirectory(this.root);
        continue;
      }
      const lifecycle = KernelLock.acquireSync(path.join(this.root, 'locks', `session-${intent.id}.lock`));
      try {
        const directory = this.directory(intent.id);
        const manifestFile = path.join(directory, 'session.json');
        if (!fs.existsSync(manifestFile)) {
          const generations = privateDirectory(path.join(directory, 'generations'));
          const generation = path.join(generations, intent.generation);
          fs.rmSync(generation, {recursive: true, force: true});
          this.buildGeneration(generation, 'inherit-personal');
          this.fault('generation-written');
          lock.assertHeld(); lifecycle.assertHeld();
          publishJson(manifestFile, {version: 1, id: intent.id, name: intent.name, generation: intent.generation});
          this.fault('manifest-published');
        }
        const manifest = this.manifest(intent.id);
        if (manifest.name !== intent.name || manifest.generation !== intent.generation) throw new Error('invalid_creation_journal');
        registry.sessions[intent.name] = intent.id;
        lock.assertHeld(); lifecycle.assertHeld();
        publishJson(path.join(this.root, 'registry.json'), registry);
        this.fault('registry-published');
        fs.unlinkSync(journalFile); syncDirectory(this.root);
      } finally { void lifecycle.release(); }
    }
  }
  openSync(name: string, onLost?: () => void): {context: AppContext; lock: KernelLock} {
    const resolved = this.resolveSync(name);
    let lock: KernelLock;
    try { lock = KernelLock.acquireSync(path.join(this.root, 'locks', `session-${resolved.id}.lock`), {onLost, timeoutMs: 0}); }
    catch (error) {
      if ((error as Error).message === 'storage_busy') throw Object.assign(error as Error, {existing: this.owner(resolved.id), sessionId: resolved.id});
      throw error;
    }
    try {
      const current = this.manifest(resolved.id);
      return {context: {...personalContext(this.personalRoot), kind: 'named', sessionId: current.id, sessionName: current.name,
        dataRoot: path.join(this.directory(current.id), 'generations', current.generation)}, lock};
    } catch (error) { void lock.release(); throw error; }
  }
  async open(name: string, onLost?: () => void): Promise<{context: AppContext; lock: KernelLock}> {
    const resolved = await this.resolve(name);
    const lock = await this.lifecycle(resolved.id, 0, onLost);
    try {
      // Resolve the active generation only AFTER acquiring lifecycle ownership.
      const current = this.manifest(resolved.id);
      const context = personalContext(this.personalRoot);
      return {context: {...context, kind: 'named', sessionId: current.id, sessionName: current.name,
        dataRoot: path.join(this.directory(current.id), 'generations', current.generation)}, lock};
    } catch (error) { await lock.release(); throw error; }
  }
}
