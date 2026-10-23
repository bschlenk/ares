import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ServiceError, type SessionClient, type SessionIdentity } from '../services/contracts.js';
import { lossless } from './n64-tools.js';
import { screenshotSchema } from './screenshot-tools.js';
import type { BatchStep } from '../services/batch-contracts.js';
export function registerBatchTools(server: McpServer, client: SessionClient, status: () => Promise<SessionIdentity>) {
  const addr = z.union([z.number().int().nonnegative(), z.string()]);
  const buttons = ['a','b','z','start','up','down','left','right','c_up','c_down','c_left','c_right','l','r'];
  const inputFields = Object.fromEntries(buttons.map(b => [b, z.boolean().default(false)]));
  const steps = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('state_load'), path: z.string().min(1).max(4096) }).strict(),
    z.object({ kind: z.literal('write'), addr, hex: z.string().max(2048), view: z.enum(['cpu', 'rdram']).default('cpu') }).strict(),
    z.object({ kind: z.literal('read'), addr, length: z.number().int().min(1).max(1024).default(64), view: z.enum(['cpu', 'rdram']).default('rdram') }).strict(),
    z.object({ kind: z.literal('input'), ...inputFields, port: z.number().int().min(1).max(4).default(1), x: z.number().int().min(-32767).max(32767).default(0), y: z.number().int().min(-32767).max(32767).default(0), timeout_frames: z.number().int().min(1).max(100000).nullable().default(null), timeout_seconds: z.number().min(0.001).max(3600).nullable().default(null) }).strict(),
    z.object({ kind: z.literal('memory_record_start'), name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), reads: z.array(z.object({ region: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(65536) }).strict()).min(1).max(64), capacity: z.number().int().min(1).max(1024).default(60), duration: z.number().int().min(0).max(1000000).default(0) }).strict(),
    z.object({ kind: z.literal('memory_record_stop'), name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict(),
    z.object({ kind: z.literal('run'), n: z.number().int().min(0).max(1000000) }).strict(),
    screenshotSchema.extend({ kind: z.literal('screenshot'), path: z.string().min(1).max(4096), inline: z.literal(false).default(false) }).strict()
  ]);
  server.registerTool('batch', { description: 'Ordered native-reserved state_load/input/write/run/screenshot/read and memory_record_start/stop steps. Input replaces the whole port state and is released on every batch exit. Recorders use batch-local names; returned handles remain readable by this connection and stop on batch exit. State loads invalidate earlier captures; start recorders after loading. Bounds: 256 steps, 1M total VI frames, 16 KiB read/write bytes, 8 file screenshots, 600 seconds, 128 KiB result. No nesting/parallel execution or rollback. State loads remain paused; interrupted runs retain actual progress. UI pause, human input, deadline or disconnect revoke ownership. Reload a baseline explicitly for each candidate.', inputSchema: z.object({ steps: z.array(steps).min(1).max(256), max_seconds: z.number().min(0.001).max(600).default(60), stop_on_error: z.boolean().default(true) }).strict() }, async p => {
    const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    try {
      const normalized: BatchStep[] = p.steps.map(s => {
        if (s.kind === 'input') {
          const values = s as Record<string, unknown>;
          return { kind: 'input', port: s.port, buttons: buttons.reduce((mask,b,i) => mask | (values[b] ? 1 << i : 0), 0), x: s.x, y: s.y, timeoutFrames: s.timeout_frames ?? 0, timeoutMs: s.timeout_seconds === null ? 0 : Math.ceil(s.timeout_seconds * 1000) };
        }
        if (s.kind !== 'write' && s.kind !== 'read') return s;
        const { addr, ...rest } = s; return { ...rest, address: lossless(addr), ...(s.kind === 'write' ? { hex: s.hex.trim() } : {}) };
      });
      const r = await client.request('experiment.batch', await status(), { steps: normalized, timeoutMs: Math.ceil(p.max_seconds * 1000), stopOnError: p.stop_on_error });
      if (!r.ok || !r.result) throw new ServiceError(r.error || 'invalid_reply');
      return output({ ...r.result, steps: r.result.results });
    } catch (e) { return { ...output({ error: e instanceof ServiceError ? e.code : 'batch_failed' }), isError: true }; }
  });
}
