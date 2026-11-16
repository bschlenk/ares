import path from 'node:path';
import * as z from 'zod/v4';
import type {ToolRegistrar} from '../tools/registry.js';
import type {LocalServiceClient} from '../services/local-endpoint.js';
import type {SessionIdentity} from '../services/contracts.js';
import {SessionRepository} from '../sessions/repository.js';
export function registerSessionDataTools(server: ToolRegistrar, client: LocalServiceClient, status: () => Promise<SessionIdentity>) {
  const call = async (work: () => Promise<unknown>) => {
    try { return {content: [{type: 'text' as const, text: JSON.stringify(await work())}]}; }
    catch (error) { return {content: [{type: 'text' as const, text: JSON.stringify({error: (error as Error).message})}], isError: true}; }
  };
  const root = z.string().min(1).max(4096).refine(path.isAbsolute, 'Absolute personal data root required');
  const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/);
  server.registerTool('session_archives', {description: 'List retained recovery generations for an existing named session. Offline: requires its absolute personal data root; never launches an app.', inputSchema: z.object({personal_root: root, name}).strict(), annotations: {readOnlyHint: true}}, p => call(() => new SessionRepository(p.personal_root).archives(p.name)));
  server.registerTool('session_reset', {description: 'Reset an existing whole named session, archiving its data. Refuses running sessions, including windows with services disabled. inherit-personal clones current personal settings and lazily inherits saves; fresh uses defaults and persists fresh-save policy. Both retain explicit personal managed states.', inputSchema: z.object({personal_root: root, name, mode: z.enum(['inherit-personal', 'fresh'])}).strict()}, p => call(() => new SessionRepository(p.personal_root).replace(p.name,p.mode)));
  server.registerTool('session_restore', {description: 'Restore a selected recovery archive into an existing closed named session. Retains the selected archive and archives displaced current data. Never stops an app or deletes backups.', inputSchema: z.object({personal_root: root, name, archive_id: z.string().uuid()}).strict()}, p => call(() => new SessionRepository(p.personal_root).replace(p.name,'restore',p.archive_id)));
  const managed = async (action: string, params = {}) => {const {session,epoch}=await status(); return client.manage({operation: 'managed_states', action, ...params, session, epoch});};
  server.registerTool('managed_states', {description: 'List managed save states for the loaded game, with Personal/Session origin and source-qualified references. Requires core checkpoint support. Never automatically loads inherited states.', inputSchema: z.object({offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(20).default(20)}).strict(), annotations: {readOnlyHint: true}}, p => call(() => managed('list',p)));
  server.registerTool('managed_state_load', {description: 'Explicitly load a managed state reference from either origin, verifying checksum and current ROM/configuration. Requires core checkpoint support. Separate from path-based N64 state_load.', inputSchema: z.object({reference: z.string().min(1).max(256)}).strict()}, p => call(() => managed('load',{id:p.reference})));
  server.registerTool('managed_state_save', {description: 'Capture a permanent managed state in the writable local library. Requires checkpoint support from the loaded core.', inputSchema: z.object({}).strict()}, () => call(() => managed('save')));
  server.registerTool('managed_state_rename', {description: 'Rename a writable local managed state. Inherited personal references are read-only.', inputSchema: z.object({reference: z.string().min(1).max(256), name: z.string().max(256)}).strict()}, p => call(() => managed('rename',{id:p.reference,name:p.name})));
  server.registerTool('managed_state_delete', {description: 'Move a writable local managed state to Trash. Inherited personal references are read-only.', inputSchema: z.object({reference: z.string().min(1).max(256)}).strict()}, p => call(() => managed('delete',{id:p.reference})));
}
