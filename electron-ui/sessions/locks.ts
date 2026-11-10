import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectory} from './files.js';

export function lockExecutable(): string {
  if (process.env.ARES_HOST) return process.env.ARES_HOST;
  const packaged = path.join((process as NodeJS.Process & {resourcesPath?: string}).resourcesPath ?? '', 'native/bin/ares-electron-host');
  if (fs.existsSync(packaged)) return packaged;
  return fileURLToPath(new URL('../../../build-electron-make/bin/ares-electron-host', import.meta.url));
}

/** Kernel lock in a stable inode. Records and PID liveness never grant ownership. */
export class KernelLock {
  private released = false;
  private lost = false;
  private constructor(private child: ChildProcess, private onLost: () => void, private acknowledgement?: {fd: number; filename: string}, private descriptor?: number) {
    child.once('exit', () => { if (!this.released) { this.lost = true; this.onLost(); } });
  }
  /** Inherit this open description into the actual native writer. A helper or
   * Electron crash then cannot release ownership before that writer exits. */
  get fd(): number { this.assertHeld(); if (this.descriptor === undefined) throw new Error('storage_lock_not_inheritable'); return this.descriptor; }
  private closeDescriptor(): void { if (this.descriptor !== undefined) { fs.closeSync(this.descriptor); this.descriptor = undefined; } }
  assertHeld(): void { if (this.released || this.lost || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('storage_lock_lost'); }
  async release(): Promise<void> {
    if (this.acknowledgement) { this.releaseSync(); return; }
    if (this.released) return;
    this.released = true;
    this.closeDescriptor();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => { this.child.once('exit', () => resolve()); this.child.stdin!.end(); });
  }
  releaseSync(): void {
    if (this.released) return;
    if (!this.acknowledgement) throw new Error('async_lock_requires_async_release');
    this.released = true;
    this.closeDescriptor();
    const {fd, filename} = this.acknowledgement;
    try {
      this.child.stdin!.destroy();
      const deadline = Date.now() + 3000, wait = new Int32Array(new SharedArrayBuffer(4));
      while (Date.now() < deadline) {
        const buffer = Buffer.alloc(32), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (buffer.subarray(0, size).toString().includes('released\n')) return;
        Atomics.wait(wait, 0, 0, 5);
      }
      this.child.kill();
      throw new Error('storage_unlock_timeout');
    } finally { fs.closeSync(fd); fs.rmSync(filename, {force: true}); this.acknowledgement = undefined; }
  }
  /** Startup must select durable data before constructing any consumers. Electron
   * does not pump child I/O during synchronous module evaluation before ready. A
   * bounded, private acknowledgement file permits kernel locking at that boundary. */
  static acquireSync(filename: string, options: {executable?: string; onLost?: () => void; timeoutMs?: number} = {}): KernelLock {
    privateDirectory(path.dirname(filename));
    const executable = options.executable ?? lockExecutable();
    fs.accessSync(executable, fs.constants.X_OK);
    const busyDeadline = Date.now() + (options.timeoutMs ?? 10000);
    for (;;) {
      const acknowledgement = path.join(path.dirname(filename), `.claim-${randomUUID()}`);
      const fd = fs.openSync(acknowledgement, 'wx+', 0o600);
      let child: ChildProcess | undefined, acquired = false;
      try {
        const descriptor = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
        child = spawn(executable, ['--storage-lock-fd', '4'], {stdio: ['pipe', fd, 'ignore', 'ignore', descriptor]});
        // The parent retains the same open description, which writers can inherit.
        (child as ChildProcess & {storageDescriptor: number}).storageDescriptor = descriptor;
        child.on('error', () => {});
        const deadline = Date.now() + 3000, wait = new Int32Array(new SharedArrayBuffer(4));
        while (Date.now() < deadline) {
          const buffer = Buffer.alloc(32), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
          const result = buffer.subarray(0, size).toString();
          if (result === 'locked\n') {
            fs.unlinkSync(acknowledgement);
            acquired = true;
            return new KernelLock(child, options.onLost ?? (() => {}), {fd, filename: acknowledgement}, (child as ChildProcess & {storageDescriptor: number}).storageDescriptor);
          }
          if (result === 'busy\n') {
            if (Date.now() >= busyDeadline) throw new Error('storage_busy');
            child.stdin!.destroy();
            break;
          }
          Atomics.wait(wait, 0, 0, 5);
        }
        if (Date.now() >= deadline) throw new Error('storage_lock_timeout');
      } catch (error) { child?.stdin?.end(); child?.kill(); throw error; }
      finally { if (!acquired) { const descriptor = (child as (ChildProcess & {storageDescriptor?: number}) | undefined)?.storageDescriptor; if (descriptor !== undefined) fs.closeSync(descriptor); fs.closeSync(fd); fs.rmSync(acknowledgement, {force: true}); } }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  static async acquire(filename: string, options: {executable?: string; timeoutMs?: number; onLost?: () => void; shared?: boolean} = {}): Promise<KernelLock> {
    privateDirectory(path.dirname(filename));
    const deadline = Date.now() + (options.timeoutMs ?? 10000);
    for (;;) {
      const descriptor = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
      const child = spawn(options.executable ?? lockExecutable(), [options.shared ? '--storage-shared-fd' : '--storage-lock-fd', '4'], {stdio: ['pipe', 'pipe', 'pipe', 'ignore', descriptor]});
      let diagnostic = '';
      child.stderr!.on('data', data => { diagnostic = (diagnostic + data).slice(-4096); });
      let acquired: boolean;
      try { acquired = await new Promise<boolean>((resolve, reject) => {
        let line = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('storage_lock_timeout')); }, 3000);
        const done = (value: boolean) => { clearTimeout(timer); child.removeListener('error', error); child.removeListener('exit', exited); child.stdout!.removeListener('data', data); resolve(value); };
        const error = (error: Error) => { clearTimeout(timer); reject(error); };
        const exited = (code: number | null) => { if (code === 3) done(false); else { clearTimeout(timer); reject(new Error(`storage_lock_failed: ${diagnostic}`)); } };
        const data = (value: Buffer) => { line += value.toString(); if (line === 'locked\n') done(true); else if(line === 'busy\n') done(false); };
        child.once('error', error); child.once('exit', exited); child.stdout!.on('data', data);
      }); } catch (error) { fs.closeSync(descriptor); child.stdin!.end(); throw error; }
      if (acquired) return new KernelLock(child, options.onLost ?? (() => {}), undefined, descriptor);
      fs.closeSync(descriptor); child.stdin!.end();
      if (Date.now() >= deadline) throw new Error('storage_busy');
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }
}

export async function withLock<T>(filename: string, operation: (lock: KernelLock) => T | Promise<T>): Promise<T> {
  const lock = await KernelLock.acquire(filename);
  try { lock.assertHeld(); return await operation(lock); } finally { await lock.release(); }
}
