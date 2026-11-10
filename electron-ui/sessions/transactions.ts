import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalStoragePath} from './storage.js';
import {withLock, KernelLock} from './locks.js';

/** Stable lock identity also for symlinked roots and not-yet-created stores. */
export function storeLockFile(filename: string): string {
  const canonical = canonicalStoragePath(filename);
  return path.join(fs.realpathSync('/tmp'), `ares-stores-v1-${process.getuid?.() ?? 'user'}`, createHash('sha256').update(canonical).digest('hex') + '.lock');
}
export function storeTransaction<T>(filename: string, work: (lock: KernelLock) => T | Promise<T>): Promise<T> {
  return withLock(storeLockFile(filename), work);
}
export function storeTransactionSync<T>(filename: string, work: () => T): T {
  const lock = KernelLock.acquireSync(storeLockFile(filename));
  try { lock.assertHeld(); return work(); } finally { lock.releaseSync(); }
}
