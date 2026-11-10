import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {KernelLock, withLock, lockExecutable} from './locks.js';
import {privateDirectory, publishJson, readJson, syncDirectory} from './files.js';
import {managementRoot, type AppContext} from './context.js';
import type {GenerationData} from './repository.js';

export type StorageResource = {source: string; scope: 'file' | 'directory'};
export type StorageInventory = {version: 1; resources: StorageResource[]};
type Resolved = StorageResource & {id: string; canonical: string; destination: string; identity?: string};
type Claim = {version: 1; id: string; instance: string; game: string; resources: Resolved[]};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Resolve existing ancestors too: realpath(file) alone misses absent saves. */
export function canonicalStoragePath(filename: string): string {
  if (!path.isAbsolute(filename) || filename.includes('\0')) throw new Error('invalid_storage_path');
  filename = path.resolve(filename);
  try { return fs.realpathSync.native(filename); }
  catch (error) {
    if (!missing(error) || path.dirname(filename) === filename) throw error;
    return path.join(canonicalStoragePath(path.dirname(filename)), path.basename(filename));
  }
}
/** A personal launch can select a contained save subtree. Remember that routing
 * separately from process-local arguments so a later named launch prepares the
 * same personal destinations, including when no personal window is open. */
export function personalStorageDirectory(context: AppContext, effective?: string, hold?: (lock: KernelLock) => void): string {
  const marker = path.join(context.personalRoot, 'storage-routing.json');
  const root = managementRoot(context.personalRoot);
  const transaction = KernelLock.acquireSync(path.join(root, 'locks', 'routing.lock'));
  try {
    const contained = (directory: string) => {
      const relative = path.relative(context.personalRoot, directory);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('invalid_personal_storage_routing');
      return relative;
    };
    let record: {version: number; directory: string} | undefined;
    try { record = readJson(marker, 8192, true); }
    catch (error) { if (!missing(error)) throw error; }
    if (record && (record.version !== 1 || typeof record.directory !== 'string' || path.isAbsolute(record.directory))) throw new Error('invalid_personal_storage_routing');
    let directory = canonicalStoragePath(path.resolve(context.personalRoot, record?.directory ?? 'saves'));
    contained(directory);
    if (context.kind === 'personal') {
      const requested = effective ? canonicalStoragePath(effective) : directory;
      contained(requested);
      if (!record || requested !== directory) {
        // A routing change must exclude every existing personal writer.
        const exclusive = KernelLock.acquireSync(path.join(root, 'locks', 'personal.lock'), {timeoutMs: 0});
        try { publishJson(marker, {version: 1, directory: contained(requested)}); }
        finally { exclusive.releaseSync(); }
        directory = requested;
      }
      if (hold) hold(KernelLock.acquireSync(path.join(root, 'locks', 'personal.lock'), {shared: true, timeoutMs: 0, onLost: () => process.exit(1)}));
    }
    return directory;
  } finally { transaction.releaseSync(); }
}

function inode(filename: string): string | undefined {
  try { const stat = fs.statSync(filename, {bigint: true}); return `${stat.dev}:${stat.ino}`; }
  catch (error) { if (!missing(error)) throw error; }
}
const caseSensitivity = new Map<number, boolean>();
function comparison(filename: string): string {
  let ancestor = filename;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const stat = fs.statSync(ancestor);
  let sensitive = caseSensitivity.get(stat.dev);
  if (sensitive === undefined) {
    if (process.platform === 'darwin') {
      const info = spawnSync(lockExecutable(), ['--storage-case-sensitive', ancestor], {encoding: 'utf8', timeout: 3000});
      if (info.status !== 0 || !/^[01]\n$/.test(info.stdout)) throw new Error('storage_case_rules_unavailable');
      sensitive = info.stdout === '1\n';
    } else sensitive = process.platform === 'linux';
    caseSensitivity.set(stat.dev, sensitive);
  }
  return sensitive ? filename : filename.toLowerCase();
}
function overlap(a: Resolved, b: Resolved): boolean {
  const left = comparison(a.destination), right = comparison(b.destination);
  if (left === right || (a.scope === 'directory' && right.startsWith(left + path.sep)) || (b.scope === 'directory' && left.startsWith(right + path.sep))) return true;
  const ai = inode(a.destination) ?? a.identity, bi = inode(b.destination) ?? b.identity;
  return ai !== undefined && ai === bi;
}
export class StorageReservation {
  constructor(readonly claim: Claim, readonly lock: KernelLock, private readonly manager: StorageCoordinator) {}
  get fd() { return this.lock.fd; }
  release() { this.manager.forget(this); return this.lock.release(); }
  nativeResources() {
    this.lock.assertHeld();
    return this.claim.resources.map(resource => ({...resource, identity: inode(resource.destination) ?? ''}));
  }
}

/** Namespace arbitration publishes complete sets protected by stable kernel lock
 * inodes. Records describe ownership; only the locks establish liveness. */
export class StorageCoordinator {
  readonly root: string;
  private held = new Set<StorageReservation>();
  constructor(root = path.join(fs.realpathSync('/tmp'), `ares-storage-v1-${process.getuid?.() ?? 'user'}`)) { this.root = privateDirectory(root); }
  barrierFile() { return path.join(this.root, 'snapshot.lock'); }
  forget(reservation: StorageReservation) { this.held.delete(reservation); }
  async reserve(inventory: StorageInventory, context: AppContext, game: string): Promise<StorageReservation> {
    if (inventory.version !== 1 || !Array.isArray(inventory.resources) || inventory.resources.length > 4096) throw new Error('invalid_storage_inventory');
    return withLock(path.join(this.root, 'namespace.lock'), async () => {
      const initialized = context.kind === 'named' ? readJson<GenerationData>(path.join(context.dataRoot, 'data.json')).initialized : {};
      const resources: Resolved[] = [];
      for (const resource of inventory.resources) {
        if (!['file', 'directory'].includes(resource.scope)) throw new Error('invalid_storage_scope');
        const canonical = canonicalStoragePath(resource.source);
        const sourceInode = inode(canonical);
        const alias = sourceInode ? resources.find(row => inode(row.canonical) === sourceInode) : undefined;
        const knownSources = (row: unknown) => {
          const value = row as {source?: string; sources?: string[]};
          return [value.source, ...(value.sources ?? [])].filter((source): source is string => typeof source === 'string');
        };
        const entries = Object.entries(initialized);
        // Prefer persisted path mappings before considering newly observed inode
        // aliases, so replacing a personal file cannot redirect existing progress.
        const previous = entries.find(([, row]) => knownSources(row).some(source => comparison(source) === comparison(canonical))) ??
          (sourceInode ? entries.find(([, row]) => knownSources(row).some(source => inode(source) === sourceInode)) : undefined);
        const id = previous?.[0] ?? alias?.id ?? digest(comparison(canonical));
        const destination = context.kind === 'named' ? path.join(context.dataRoot, 'storage', id, 'data') : canonical;
        resources.push({...resource, id, canonical, destination, identity: inode(destination)});
      }
      for (const name of fs.readdirSync(this.root).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
        const id = name.slice(0, -5), ours = [...this.held].find(value => value.claim.id === id);
        if (ours && ours.claim.instance === context.instanceId) { ours.lock.assertHeld(); continue; }
        let probe: KernelLock;
        try { probe = await KernelLock.acquire(path.join(this.root, `${id}.lock`), {timeoutMs: 0}); }
        catch (error) {
          if ((error as Error).message !== 'storage_busy') throw error;
          const claim = readJson<Claim>(path.join(this.root, name), 4 * 1024 * 1024, true);
          for (const resource of resources) for (const other of claim.resources) {
            const current = {...other, destination: canonicalStoragePath(other.destination)};
            if (overlap(resource, other) || overlap(resource, current)) throw Object.assign(new Error(`storage_conflict: ${claim.game} (${claim.instance}) owns ${other.destination}`), {owner: claim});
          }
          continue;
        }
        await probe.release();
        fs.unlinkSync(path.join(this.root, name)); // metadata only; stable lock inodes remain
      }
      const claim: Claim = {version: 1, id: randomUUID(), instance: context.instanceId, game, resources};
      const lock = await KernelLock.acquire(path.join(this.root, `${claim.id}.lock`), {timeoutMs: 0});
      try {
        publishJson(path.join(this.root, `${claim.id}.json`), claim);
        const reservation = new StorageReservation(claim, lock, this); this.held.add(reservation); return reservation;
      } catch (error) { await lock.release(); throw error; }
    });
  }
  /** Snapshot barriers are separate from lifetime ownership. No flush or pause
   * of a playing personal game is needed. Whole-group flushes take EX in native. */
  async initialize(reservation: StorageReservation, context: AppContext, fault: (point: string) => void = () => {}, signal?: AbortSignal): Promise<void> {
    if (context.kind !== 'named') return;
    const assertActive = () => { if (signal?.aborted) throw signal.reason ?? new Error('storage_snapshot_cancelled'); };
    assertActive();
    reservation.lock.assertHeld();
    const barrier = await KernelLock.acquire(this.barrierFile(), {shared: true});
    try {
      assertActive();
      const metadata = path.join(context.dataRoot, 'data.json');
      const data = readJson<GenerationData>(metadata, 4 * 1024 * 1024, true);
      if (data.version !== 1 || !['inherit-personal', 'fresh'].includes(data.policy)) throw new Error('invalid_session_generation');
      const storage = privateDirectory(path.join(context.dataRoot, 'storage'));
      const journal = path.join(storage, 'initializing.json');
      type Intent = {version: 1; resources: {id: string; source: string; destination: string; staged: string | null}[]};
      const recover = () => {
        let intent: Intent;
        try { intent = readJson(journal, 4 * 1024 * 1024, true); }
        catch (error) { if (missing(error)) return; throw error; }
        if (intent.version !== 1 || !Array.isArray(intent.resources)) throw new Error('invalid_storage_journal');
        for (const row of intent.resources) {
          if (!/^[a-f0-9]{64}$/.test(row.id) || row.destination !== path.join(storage, row.id, 'data') || (row.staged !== null && row.staged !== path.join(storage, row.id, 'initial'))) throw new Error('invalid_storage_journal');
          if (row.staged) {
            if (fs.existsSync(row.staged)) { fs.renameSync(row.staged, row.destination); syncDirectory(path.dirname(row.destination)); }
            if (!fs.lstatSync(row.destination).isFile()) throw new Error('storage_initialization_missing_file');
          }
          data.initialized[row.id] = {source: row.source};
          fault('resource-published');
        }
        publishJson(metadata, data); fault('ledger-published');
        fs.unlinkSync(journal); syncDirectory(storage);
      };
      recover();
      const rows: Intent['resources'] = [];
      for (const resource of reservation.claim.resources) {
        assertActive();
        if (resource.scope !== 'file') throw new Error('storage_directory_inheritance_not_supported');
        const id = resource.id;
        if (Object.hasOwn(data.initialized, id) || rows.some(row => row.id === id)) continue;
        const directory = privateDirectory(path.join(storage, id)), staged = path.join(directory, 'initial');
        fs.rmSync(staged, {force: true});
        let copied = false;
        if (data.policy === 'inherit-personal') {
          const source = canonicalStoragePath(resource.source);
          if (source !== resource.canonical) throw new Error('storage_source_changed');
          let input: number | undefined;
          try {
            input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const before = fs.fstatSync(input, {bigint: true});
            if (!before.isFile() || `${before.dev}:${before.ino}` !== inode(source) || canonicalStoragePath(resource.source) !== source) throw new Error('storage_source_changed');
            const output = fs.openSync(staged, 'wx', 0o600);
            try {
              const buffer = Buffer.alloc(65536);
              for (;;) {
                assertActive();
                const size = await new Promise<number>((resolve, reject) => fs.read(input!, buffer, 0, buffer.length, null, (error, size) => error ? reject(error) : resolve(size)));
                assertActive();
                if (!size) break;
                let written = 0;
                while (written < size) written += fs.writeSync(output, buffer, written, size-written);
              }
              fs.fsyncSync(output);
            } finally { fs.closeSync(output); }
            syncDirectory(directory); copied = true;
          } catch (error) { if (input !== undefined || !missing(error)) throw error; }
          finally { if (input !== undefined) fs.closeSync(input); }
        }
        rows.push({id, source: resource.canonical, destination: resource.destination, staged: copied ? staged : null}); fault('resource-staged');
      }
      assertActive();
      if (rows.length) { publishJson(journal, {version: 1, resources: rows} satisfies Intent); fault('initialization-intent'); recover(); fault('initialization-published'); }
      // Persist every observed path alias, even when that resource was already
      // initialized. Removing the first hard-link name must not cause recopying.
      for (const resource of reservation.claim.resources) {
        const entry = data.initialized[resource.id] as {source: string; sources?: string[]};
        entry.sources = [...new Set([entry.source, ...(entry.sources ?? []), resource.canonical])];
      }
      publishJson(metadata, data);
      const group = digest(JSON.stringify({game: reservation.claim.game, resources: reservation.claim.resources.map(row => row.id).sort()}));
      const groupsFile = path.join(storage, 'groups.json');
      let groups: Record<string, string[]> = {};
      try { groups = readJson(groupsFile); } catch (error) { if (!missing(error)) throw error; }
      groups[group] = reservation.claim.resources.map(row => row.id); publishJson(groupsFile, groups);
    } finally { await barrier.release(); }
  }
}
