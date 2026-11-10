import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {privateDirectory} from './files.js';

export type AppContext = {
  kind: 'personal' | 'named';
  instanceId: string;
  sessionId?: string;
  sessionName?: string;
  personalRoot: string;
  dataRoot: string;
  runtimeRoot: string;
};
export function managementRoot(personalRoot: string): string {
  const canonical = fs.realpathSync(personalRoot);
  const namespace = createHash('sha256').update(canonical).digest('hex');
  return path.join(path.dirname(canonical), '.ares-session-management', 'v1', namespace);
}
export function prepareManagementRoot(personalRoot: string): string {
  const root = managementRoot(personalRoot);
  privateDirectory(path.dirname(path.dirname(root)));
  privateDirectory(path.dirname(root));
  return privateDirectory(root);
}
export function personalContext(personalRoot: string): AppContext {
  fs.mkdirSync(personalRoot, {recursive: true, mode: 0o700});
  personalRoot = fs.realpathSync(personalRoot);
  const instanceId = randomUUID();
  const root = prepareManagementRoot(personalRoot);
  const instances = privateDirectory(path.join(root, 'instances'));
  const runtimeRoot = privateDirectory(path.join(instances, instanceId));
  return {kind: 'personal', instanceId, personalRoot, dataRoot: personalRoot, runtimeRoot};
}
export function sessionName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value)) throw new Error('invalid_session_name');
  return value;
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
