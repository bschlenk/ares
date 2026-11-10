import fs from 'node:fs';
import path from 'node:path';
import {publishJson, readJson} from '../sessions/files.js';
import {KernelLock, withLock} from '../sessions/locks.js';

export interface SavedSettings { version: 1; revision: number; values: Record<string, unknown> }
export function readSettings(filename: string): SavedSettings {
  try {
    const value = readJson<SavedSettings>(filename);
    if (!value || value.version !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values) ||
      (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0))) throw new Error('invalid_settings_file');
    return {version: 1, revision: value.revision ?? 0, values: Object.assign(Object.create(null), value.values)};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, revision: 0, values: Object.create(null)};
    throw error;
  }
}
export function settingsTransaction<T>(filename: string, operation: (settings: SavedSettings, commit: () => void) => T): Promise<T> {
  fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  return withLock(path.join(path.dirname(filename), '.settings-locks', path.basename(filename) + '.lock'), lock => {
    return transaction(filename, operation, lock);
  });
}
function transaction<T>(filename: string, operation: (settings: SavedSettings, commit: () => void) => T, lock: KernelLock): T {
  const settings = readSettings(filename);
  return operation(settings, () => {
    lock.assertHeld();
    settings.revision++;
    if (Buffer.byteLength(JSON.stringify(settings)) > 1024 * 1024) throw new Error('settings_file_too_large');
    publishJson(filename, settings);
  });
}
export function settingsSnapshotSync<T>(filename: string, snapshot: (settings: SavedSettings) => T): T {
  fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  const lock = KernelLock.acquireSync(path.join(path.dirname(filename), '.settings-locks', path.basename(filename) + '.lock'));
  try { lock.assertHeld(); return snapshot(readSettings(filename)); }
  finally { void lock.release(); }
}
