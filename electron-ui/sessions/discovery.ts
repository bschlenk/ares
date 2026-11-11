import fs from 'node:fs/promises';
import path from 'node:path';
import {LocalServiceClient} from '../services/local-endpoint.js';
import {ServiceError} from '../services/contracts.js';
import {KernelLock} from './locks.js';
import {publishJson, readJson} from './files.js';
import {uuid} from './context.js';

/** Authenticated metadata only: never asks native session.status or launches. */
import type {InstanceMetadata} from '../services/management-contracts.js';
export type {InstanceMetadata, ManagementRequest} from '../services/management-contracts.js';
export async function discoverInstances(directory: string): Promise<InstanceMetadata[]> {
  let files: string[];
  try { files = await fs.readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const live: InstanceMetadata[] = [];
  for (const file of files.filter(file => uuid(file.slice(0,-5)) && file.endsWith('.json'))) {
    const instance = file.slice(0,-5), client = new LocalServiceClient(path.join(directory,file),instance,1000);
    try {
      const value = await client.management({operation:'app_status'});
      if(value.instance !== instance || !['personal','named'].includes(value.kind) || !Number.isSafeInteger(value.opened_order) || value.opened_order < 1)
        throw new ServiceError('invalid_discovery_metadata');
      live.push(value);
    } catch(error) {
      if (!(error instanceof ServiceError && ['app_not_running','app_disconnected','instance_not_running','request_timeout'].includes(error.code))) throw error;
    } finally { client.close(); }
  }
  return live.sort((a,b)=>a.opened_order-b.opened_order || a.instance.localeCompare(b.instance));
}
export function nextOpenSequence(root: string): number {
  const lock = KernelLock.acquireSync(path.join(root,'locks','open-sequence.lock'));
  try {
    const file = path.join(root,'open-sequence.json');
    let previous = 0;
    try { previous = readJson<{sequence:number}>(file,8192,true).sequence; }
    catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if(!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new Error('invalid_open_sequence');
    lock.assertHeld(); publishJson(file,{sequence:previous+1}); return previous+1;
  } finally { void lock.release(); }
}
