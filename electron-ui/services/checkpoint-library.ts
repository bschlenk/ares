import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {checkpointStem, localOffset} from './checkpoint-format.js';

import type {CheckpointGame,CheckpointMetadata,CheckpointEntry} from './checkpoint-contracts.js';
export type {CheckpointGame,CheckpointMetadata,CheckpointEntry} from './checkpoint-contracts.js';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = (id: string) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{4}(?:_[2-9]\d*|_1\d+)?$/.test(id);
const slug = (title: string) => title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'game';
function validateGame(game: CheckpointGame) {
  if (!validHash(game.hash) || !game.system || typeof game.title !== 'string') throw new Error('invalid_game_identity');
}
function validMetadata(value: any, game: CheckpointGame): value is CheckpointMetadata {
  return value?.schema === 1 && value.game?.hash === game.hash && value.game?.system === game.system && typeof value.game?.title === 'string'
    && typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)) && /^[+-]\d{4}$/.test(value.offset)
    && typeof value.name === 'string' && value.name.length <= 256 && typeof value.permanent === 'boolean'
    && [value.state, value.screenshot].every(a => Number.isSafeInteger(a?.bytes) && a.bytes > 0 && a.bytes <= (a === value.state ? 67108864 : 8388608) && validHash(a.sha256))
    && (value.screenshot.aspect===undefined||Number.isFinite(value.screenshot.aspect)&&value.screenshot.aspect>0&&value.screenshot.aspect<=32)
    && value.compatibility && typeof value.compatibility === 'object' && !Array.isArray(value.compatibility);
}
/** A directory rename is the commit point for the three-file checkpoint. Hidden
 * staging directories are never listed; failed writes never trigger retention. */
export class CheckpointLibrary {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string, private trash: (file: string) => Promise<void>, private warn: (message:string)=>void = ()=>{}) {if(!path.isAbsolute(root))throw new Error('invalid_storage_root')}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run); this.tail = result.catch(() => {}); return result;
  }
  private async folder(game: CheckpointGame, create = false): Promise<string | null> {
    validateGame(game);
    if (create) await fs.mkdir(this.root, {recursive: true});
    let entries;
    try { entries = await fs.readdir(this.root, {withFileTypes: true}); }
    catch (error: any) { if (!create && error.code === 'ENOENT') return null; throw error; }
    // System is part of the identity hash. Never use a changed slug to create a
    // second collection, and never follow directory symlinks from a collection.
    const matches = entries.filter(e => e.isDirectory() && e.name.endsWith(`--${game.hash}`)).sort((a,b) => a.name.localeCompare(b.name));
    if (matches.length) return path.join(this.root, matches[0]!.name);
    if (!create) return null;
    const folder = path.join(this.root, `${slug(game.title)}--${game.hash}`);
    await fs.mkdir(folder, {recursive: true}); return folder;
  }
  private async entry(game: CheckpointGame, id: string): Promise<{directory: string; metadata: CheckpointMetadata}> {
    if (!validId(id)) throw new Error('invalid_checkpoint_id');
    const folder = await this.folder(game); if (!folder) throw new Error('checkpoint_not_found');
    const directory = path.join(folder, id);
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('invalid_checkpoint');
    const metadataFile=path.join(directory,`${id}.json`),stat=await fs.lstat(metadataFile);
    if(!stat.isFile()||stat.size>65536)throw new Error('invalid_checkpoint');
    const raw = await fs.readFile(metadataFile, 'utf8');
    if (raw.length > 65536) throw new Error('invalid_checkpoint');
    const metadata: unknown = JSON.parse(raw);
    if (!validMetadata(metadata, game)) throw new Error('invalid_checkpoint');
    return {directory, metadata};
  }
  async list(game: CheckpointGame, screenshots = false): Promise<CheckpointEntry[]> {
    const folder = await this.folder(game); if (!folder) return [];
    const entries: CheckpointEntry[] = [];
    for (const dir of await fs.readdir(folder, {withFileTypes: true})) {
      if (!dir.isDirectory() || !validId(dir.name)) continue;
      try {
        const {directory, metadata} = await this.entry(game, dir.name);
        const [state,imageStat]=await Promise.all([fs.lstat(path.join(directory,`${dir.name}.state`)),fs.lstat(path.join(directory,`${dir.name}.png`))]);
        if(!state.isFile()||!imageStat.isFile()||imageStat.size!==metadata.screenshot.bytes)continue;
        const screenshot=await fs.readFile(path.join(directory,`${dir.name}.png`));
        if (state.size !== metadata.state.bytes || screenshot.length !== metadata.screenshot.bytes || digest(screenshot) !== metadata.screenshot.sha256) continue;
        entries.push({...metadata, id: dir.name, ...(screenshots ? {screenshotUrl: `data:image/png;base64,${screenshot.toString('base64')}`} : {})});
      } catch { /* Incomplete or corrupt entries are never advertised as loadable. */ }
    }
    return entries.sort((a,b) => Number(b.permanent)-Number(a.permanent) || Date.parse(b.capturedAt)-Date.parse(a.capturedAt) || b.id.localeCompare(a.id));
  }
  publish(game: CheckpointGame, capture: {state: Uint8Array; screenshot: Uint8Array; capturedAt: Date; screenshotGeometry?: {width:number;height:number;aspect:number}; compatibility: Record<string, unknown>}, permanent: boolean, guard = () => {}): Promise<CheckpointEntry> {
    return this.serial(async () => {
      guard();
      if (!capture.state.length || !capture.screenshot.length) throw new Error('empty_checkpoint');
      const folder = (await this.folder(game, true))!, temporary = path.join(folder, `.pending-${randomUUID()}`);
      await fs.mkdir(temporary, {mode: 0o700});
      let published = false;
      try {
        const metadata: CheckpointMetadata = {schema: 1, capturedAt: capture.capturedAt.toISOString(), offset: localOffset(capture.capturedAt), game: {...game}, name: '', permanent,
          state: {bytes: capture.state.length, sha256: digest(capture.state)}, screenshot: {bytes: capture.screenshot.length, sha256: digest(capture.screenshot),...capture.screenshotGeometry}, compatibility: capture.compatibility};
        for (const [name, bytes] of [['capture.state', capture.state], ['screenshot.png', capture.screenshot], ['metadata.json', JSON.stringify(metadata)]] as const) {
          guard(); const file = await fs.open(path.join(temporary, name), 'wx', 0o600);
          try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        }
        const stem = checkpointStem(capture.capturedAt);
        let id = stem;
        // Reserve an empty target directory; rename replaces only our reservation.
        // mkdir is exclusive across processes and avoids overwrite on collisions.
        for (let suffix = 2;; suffix++) {
          try { await fs.mkdir(path.join(folder, id)); break; }
          catch (error: any) { if (error.code !== 'EEXIST') throw error; id = `${stem}_${suffix}`; }
        }
        try {
          for(const [from,to] of [['capture.state',`${id}.state`],['screenshot.png',`${id}.png`],['metadata.json',`${id}.json`]])await fs.rename(path.join(temporary,from!),path.join(temporary,to!));
          guard(); await fs.rename(temporary, path.join(folder, id)); published = true;
        }
        catch (error) { await fs.rmdir(path.join(folder, id)).catch(() => {}); throw error; }
        // The checkpoint is committed. Retention failures cannot reclassify a
        // successful capture as failed (or cause a Retry to duplicate it).
        if (!permanent) await this.prune(game).catch(error => {try{this.warn(`Older autosaves could not be moved to Trash: ${String(error)}`)}catch{}});
        return {...metadata, id};
      } finally { if (!published) await fs.rm(temporary, {recursive: true, force: true}); }
    });
  }
  rename(game: CheckpointGame, id: string, name: string): Promise<void> {
    return this.serial(async () => {
      if (typeof name !== 'string' || name.length > 256 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('invalid_checkpoint_name');
      const {directory, metadata} = await this.entry(game, id);
      metadata.name = name.trim(); if (metadata.name) metadata.permanent = true;
      const temporary = path.join(directory, `.metadata-${randomUUID()}`);
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(metadata)); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, path.join(directory, `${id}.json`));
      } finally { await fs.rm(temporary, {force: true}); }
    });
  }
  async read(game: CheckpointGame, id: string) {
    const {directory, metadata}=await this.entry(game,id),file=path.join(directory,`${id}.state`),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.size!==metadata.state.bytes)throw new Error('checkpoint_integrity_failed');
    const state=await fs.readFile(file);
    if (state.length !== metadata.state.bytes || digest(state) !== metadata.state.sha256) throw new Error('checkpoint_integrity_failed');
    return {state, metadata};
  }
  async revealPath(game: CheckpointGame, id: string): Promise<string> { return (await this.entry(game, id)).directory; }
  delete(game: CheckpointGame, id: string): Promise<void> { return this.serial(async () => this.trash((await this.entry(game, id)).directory)); }
  private async prune(game: CheckpointGame) {
    const autosaves = (await this.list(game)).filter(e => !e.permanent);
    for (const entry of autosaves.slice(10)) await this.trash((await this.entry(game, entry.id)).directory);
  }
}
