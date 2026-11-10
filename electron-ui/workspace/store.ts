import fs from 'node:fs';
import path from 'node:path';
import {publishJson} from '../sessions/files.js';
import {storeTransactionSync} from '../sessions/transactions.js';
import { defaultLayout, validateLayout, type WorkspaceLayout, type WorkspaceSnapshot } from './model.js';
/** Whole layouts use last committed write; invalid provisioning is never overwritten. */
export class WorkspaceStore {
  private layout = defaultLayout();
  private error?: string;
  constructor(readonly filename: string) { this.refresh(); }
  private refresh(): void {
    try {
      if (fs.statSync(this.filename).size > 65536) throw new Error('workspace_file_too_large');
      this.layout = validateLayout(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
      this.error = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.layout = defaultLayout(); this.error = undefined; }
      else this.error = `Cannot read workspace: ${String(error)}. Repair ${this.filename} and restart.`;
    }
  }
  load(): WorkspaceSnapshot { this.refresh(); return { layout: structuredClone(this.layout), ...(this.error ? { error: this.error } : {}) }; }
  save(value: WorkspaceLayout): WorkspaceSnapshot {
    const layout = validateLayout(value);
    return storeTransactionSync(this.filename, () => {
      this.refresh();
      if (this.error) throw new Error(this.error);
      const text = JSON.stringify(layout);
      if (Buffer.byteLength(text) > 65536) throw new Error('workspace_file_too_large');
      fs.mkdirSync(path.dirname(this.filename), {recursive: true});
      publishJson(this.filename, layout);
      this.layout = layout;
      return this.load();
    });
  }
}
