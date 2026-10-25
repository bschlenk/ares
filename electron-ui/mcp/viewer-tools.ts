import type { ToolRegistrar } from '../tools/registry.js';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ServiceError, type SessionClient, type SessionIdentity, type SessionReply } from '../services/contracts.js';
export async function readViewerCapture(client: SessionClient, identity: SessionIdentity, kind: 'rsp' | 'rdp', requested: number) {
  const unwrap = <T>(r: SessionReply<T>): T => { if (!r.ok || !r.result) throw new ServiceError(r.error || 'invalid_reply'); return r.result; };
  const method = kind === 'rsp' ? 'n64.capture.rsp' : 'n64.capture.rdp', effective = Math.min(requested, 1024);
  const first = unwrap(await client.request(method, identity, { generation: null, offset: 0, limit: Math.max(1, Math.min(effective, 64)) }));
  const entries = first.entries.slice(0, effective);
  while (entries.length < Math.min(effective, first.retained)) {
    const page = unwrap(await client.request(method, identity, { generation: first.generation, offset: entries.length, limit: Math.min(64, effective - entries.length) }));
    if (page.generation !== first.generation || page.retained !== first.retained || page.epoch !== first.epoch) throw new ServiceError('stale_capture');
    entries.push(...page.entries);
  }
  const { offset, next_offset, ...summary } = first;
  return { ...summary, entries, count: entries.length, truncated: first.truncated || first.committed > entries.length, inline_limit_effective: effective, next_offset: entries.length < first.retained ? entries.length : null };
}
export function registerViewerTools(server: ToolRegistrar, client: SessionClient, status: () => Promise<SessionIdentity>) {
  const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const call = (fn: () => Promise<unknown>) => fn().then(output, e => ({ ...output({ error: e instanceof ServiceError ? e.code : 'request_failed' }), isError: true }));
  server.registerTool('matrix_capture',{description:'Read immutable actual RSP matrix-stack snapshots for hash-verified F3DEX2 FIFO 2.04H. Captures modelview, projection, valid combined matrix, viewport, segment table and observed RSP stack pushes. Join IDs from rsp_capture; draw vertices link to the state used at vertex transformation, which can differ from the current stack. Bounds: 512 states per generation, 32 saved levels, 8 states per page; overflow and unknown saved levels are explicit. Unsupported microcode yields no fabricated state.',inputSchema:z.object({generation:z.number().int().positive().nullable().default(null),offset:z.number().int().min(0).max(512).default(0),limit:z.number().int().min(1).max(8).default(4)}).strict(),annotations:{readOnlyHint:true}},p=>call(async()=>{const r=await client.request('n64.capture.matrices',await status(),p);if(!r.ok)throw new ServiceError(r.error||'invalid_reply');return r.result;}));
  server.registerTool('rsp_capture', { description: 'Read completed RSP command/dispatch segments from the last VI-origin-swap viewer buffer. Live F3DEX2 signature-validated dispatch hooks preserve command words before reuse, timing and DMA byte counts; traced JIT and interpreter supported. At most 4096 stored/1024 inline rows. Unknown microcode yields no fabricated command records. RSPQ uses companion ELF-validated queue hooks, bounded overlay descriptors and frozen semantic arguments. Signature-gated Matrix rows include raw 64-byte operands copied at actual RSP DMA reads; these are consumed inputs. For full-hash verified F3DEX2 FIFO 2.04H, join matrix_before_id/matrix_after_id and cached draw vertex transform_state_id to matrix_capture for actual RSP state. This is not exact next-VI capture.', inputSchema: z.object({ limit: z.number().int().min(0).max(1048576).default(4096) }).strict(), annotations: { readOnlyHint: true } }, p => call(async () => readViewerCapture(client, await status(), 'rsp', p.limit)));
  server.registerTool('capture_control', { description: 'Query or enable/disable bounded native RSP/RDP viewer buffers (both disabled by default). Non-null channel changes require idle execution and channel owner/UI. RSP supports signature-detected F3DEX2 dispatch capture; RSPQ companion ELF/config discovery and runtime overlay resolution are supported. RDP captures decoded software/Vulkan commands. Nonzero VI-origin swaps commit immutable double buffers. Disconnect disables owned channels; reset/load clear them. Does not execute guest code or change configured JIT flags.', inputSchema: z.object({ rsp: z.boolean().nullable().default(null), rdp: z.boolean().nullable().default(null) }).strict() }, p => call(async () => {
    const r = await client.request('n64.capture.control', await status(), p); if (!r.ok || !r.result) throw new ServiceError(r.error || 'invalid_reply'); return r.result;
  }));
}
