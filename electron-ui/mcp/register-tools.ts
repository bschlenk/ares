import { buildInfo } from '../services/build-info.js';
import { scriptStatus, waitForScript } from '../services/script-wait.js';
import type { ToolRegistrar } from '../tools/registry.js';
import { registerMemoryTools } from './memory-tools.js';
import { registerViewerTools } from './viewer-tools.js';
import { registerCallTools } from './call-tools.js';
import { registerInspectionTools } from './inspection-tools.js';
import { registerRdpCaptureTools } from './rdp-capture-tools.js';
import { registerRspTools } from './rsp-tools.js';
import { registerMachineTools } from './machine-tools.js';
import { registerBatchTools } from './batch-tools.js';
import { registerStateTools } from './state-tools.js';
import { registerRecordingTools } from './recording-tools.js';
import { registerAudioTools } from './audio-tools.js';
import { screenshotSchema, registerScreenshotTools } from './screenshot-tools.js';
import { runFramesWithScreenshot } from './run-screenshot.js';
import { registerProfilerTools } from './profiler-tools.js';
import { registerDmaTools } from './dma-tools.js';
import { registerTraceTools } from './trace-tools.js';
import { registerInputTools } from './input-tools.js';
import { registerN64Tools, formatOperation, formatStop } from './n64-tools.js';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { MAX_TRANSFER, ServiceError, type ExecutionOperation, type SessionIdentity, type SessionReply } from '../services/contracts.js';
import { AutomaticServiceClient } from '../services/automatic-client.js';
import { defaultServiceDirectory, LocalServiceClient } from '../services/local-endpoint.js';
import { MemoryClient, hexToBytes, type RegionHandle } from '../services/memory.js';

export function registerTools(server: ToolRegistrar, local: LocalServiceClient) {
const memory = new MemoryClient(local);
let regions: RegionHandle[] | undefined;
// Retain identity with recent operation handles, just as region handles do.
const operationIdentities = new Map<number, SessionIdentity>();
const scriptOperations = new Set<number>();
local.onDisconnect = () => { regions = undefined; operationIdentities.clear(); scriptOperations.clear(); };
function unwrap<T>(r: SessionReply<T>): T { if (!r.ok || !r.result) throw new ServiceError(r.error || 'invalid_reply'); return r.result; }
function address(value: number | string): number {
  const text = typeof value === 'string' ? value.trim().replace(/_/g, '') : String(value);
  if (!/^(?:0x[0-9a-f]+|0o[0-7]+|0b[01]+|[0-9]+)$/i.test(text)) throw new ServiceError('invalid_address');
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < 0 || result > 0xffffffff) throw new ServiceError('invalid_address');
  return result;
}
async function region(name: string): Promise<RegionHandle> {
  regions ??= await memory.regions();
  const matches = regions.filter(r => r.id === name || r.name === name);
  if (matches.length !== 1) throw new ServiceError(matches.length ? 'ambiguous_region' : 'unknown_region');
  return matches[0];
}
const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const failure = (error: unknown) => ({ ...output({ error: error instanceof ServiceError ? error.code : 'request_failed', message: error instanceof Error ? error.message : String(error) }), isError: true });

  const status = async () => { let reply = await local.request('session.status');for(let i=0;!reply.ok&&reply.error==='stale_epoch'&&i<2;i++)reply=await local.request('session.status'); return { ...unwrap(reply), session: reply.session, epoch: reply.epoch }; };
  const call = (fn: () => Promise<unknown>) => fn().then(output, failure);
  server.registerTool('run_script', {description:'Run a confined JavaScript/TypeScript module on the native emulation thread. Exactly one of path/source. Returns an operation handle promptly; poll operation_status and use script_result after completion. frames(n) advances exact VIs; memory uses explicit CPU/RDRAM views and big-endian types. Completion leaves paused; cancellation retains earlier effects. No filesystem/network/Node globals.',inputSchema:z.object({path:z.string().min(1).max(4096).optional(),source:z.string().min(1).max(131072).optional(),args:z.unknown().default({}),max_seconds:z.number().min(0.001).max(600).default(60),wait_ms:z.number().int().min(0).max(1000).default(0),output_path:z.string().min(1).max(4096).optional(),video_path:z.string().min(1).max(4096).optional(),file_base:z.string().min(1).max(4096).optional(),state_paths:z.array(z.string().min(1).max(4096)).max(32).default([]),output_paths:z.array(z.string().min(1).max(4096)).max(32).default([]),max_frames:z.number().int().min(0).max(1000000).default(1000000)}).strict().refine(p=>(p.path===undefined)!==(p.source===undefined),'Supply exactly one of path/source')},p=>call(async()=>{
    let r=unwrap(await local.request('scripts.run',await status(),{...(p.path?{path:p.path}:{source:p.source}),args:p.args,timeoutMs:Math.ceil(p.max_seconds*1000),maxFrames:p.max_frames,videoPath:p.video_path,fileBase:p.file_base,statePaths:p.state_paths,outputPaths:p.output_paths,...(p.output_path?{outputPath:p.output_path}:{})}));
    rememberOperation(r.operation_id,local.identity!);scriptOperations.add(r.operation_id);
    if(p.wait_ms) {
      const identity={...local.identity!};
      // A short MCP wait returns the handle when its budget expires.
      try { r=await waitForScript(local,r,identity,{timeoutMs:p.wait_ms}); }
      catch(error) { if(!(error instanceof ServiceError)||error.code!=='script_wait_timeout')throw error; }
      operationIdentities.set(r.operation_id,identity);
    }
    return r;
  }));
  server.registerTool('script_result',{description:'Read an immutable completed script result retained for 15 minutes (16 results / 16 MiB). Prefer result_handle; operation_id=0 selects the latest completed result in the current native session. Available to fresh authorized local clients.',inputSchema:z.object({result_handle:z.string().uuid().optional(),operation_id:z.number().int().nonnegative().default(0),offset:z.number().int().min(0).max(4194304).default(0),length:z.number().int().min(1).max(16384).default(16384)}).strict()},p=>call(()=>local.manage({operation:'script_result',...(p.result_handle?{handle:p.result_handle}:{}),operation_id:p.operation_id,offset:p.offset,length:p.length})));
  server.registerTool('script_result_release',{description:'Release an immutable completed result handle. Does not cancel or mutate active execution.',inputSchema:z.object({result_handle:z.string().uuid()}).strict()},p=>call(()=>local.manage({operation:'script_result',release:true,handle:p.result_handle})));
  server.registerTool('owner_lease',{description:'Explicit durable ownership across local clients, bounded to 10 minutes. Create, then use lease_id on each connection before starting/running/stopping resources. list discovers status; release cancels execution and frees inputs/recordings. Ordinary disconnect cleanup remains enabled for connections without a lease.',inputSchema:z.object({action:z.enum(['create','use','list','release']),lease_id:z.string().uuid().optional(),name:z.string().min(1).max(64).default('agent job'),seconds:z.number().int().min(1).max(600).default(300)}).strict()},p=>call(()=>local.manage({operation:'owner_lease',...p})));
  registerMemoryTools(server, local, status);
  server.registerTool('provenance_control', { description: 'Query or explicitly enable/disable bounded N64 ROM-to-RAM DMA provenance. Omit enabled to query. Applies immediately and to subsequent ROM loads, so enable before loading/resetting the ROM to capture boot transfers. Disabling frees the history. Reading overlay_log never enables recording.', inputSchema: z.object({ enabled: z.boolean().optional() }).strict() }, p => call(() => local.manage({ operation: 'provenance', ...p })));
  server.registerTool('build_info',{description:'Adapter build provenance and, when requested, the connected app build for mixed-install diagnosis.',inputSchema:z.object({app:z.boolean().default(false)}).strict(),annotations:{readOnlyHint:true}},p=>call(async()=>({adapter:buildInfo(),...(p.app?{app:await local.manage({operation:'build_info'})}:{})})));
  server.registerTool('plugin_exports',{description:'Inspect bounded user-authorized plugin export jobs and committed artifact metadata. Does not grant a destination or mutate/cancel another plugin job.',inputSchema:z.object({job_id:z.string().uuid().optional(),offset:z.number().int().min(0).max(32).default(0),limit:z.number().int().min(1).max(8).default(8)}).strict(),annotations:{readOnlyHint:true}},p=>call(()=>local.manage({operation:'plugin_exports',...p})));
  server.registerTool('app_logs', { description: 'Bounded app diagnostics, available without a ROM. Returns log directory, generation, loss and expiry metadata.', inputSchema: z.object({cursor:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(64).default(32),generation:z.string().optional(),source:z.string().max(128).optional()}).strict(),annotations:{readOnlyHint:true}}, p => call(() => local.manage({operation:'app_logs',...p})));
  server.registerTool('app_health', { description: 'Read native connectivity/recent errors and independent watchdog observations. During a main-event-loop stall, fresh clients read a private bounded cached snapshot without waiting for main IPC. Missing heartbeat progress, stale observer and parent disconnection are distinct; no dialog/cause is guessed.', inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true}}, () => call(() => local.manage({operation:'app_health'})));
  server.registerTool('plugin_logs', { description: 'Bounded plugin runtime logs with generation and loss counters.', inputSchema: z.object({ id: z.string(), cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(32).default(32), generation: z.string().optional() }).strict(), annotations: {readOnlyHint:true} }, p => call(() => local.manage({operation:'logs',...p})));
  server.registerTool('ui_screenshot', { description: 'Explicit app window or open plugin panel screenshot, separate from game framebuffer capture. Writes a new PNG file. Returns renderer-submit frame and overlay crop/rotation/DPR geometry only when both stay stable across capture.', inputSchema: z.object({path:z.string(),panel:z.string().optional()}).strict() }, p => call(() => local.manage({operation:'screenshot',...p})));
  server.registerTool('emu_status', { description: 'Native safe-point status: system, VI/epoch/PC, execution/debug ownership, input, save metadata and presentation counters. Verbose retains renderer/configuration details.', inputSchema: z.object({ verbose: z.boolean().default(false) }).strict(), annotations: { readOnlyHint: true } }, async ({verbose}) => call(async()=>{
    const result=await status() as Awaited<ReturnType<typeof status>> & {last_stop?:import('../services/n64-contracts.js').Stop;debug_mode?:Record<string,unknown>};
    if(result.last_stop) result.last_stop=formatStop(result.last_stop) as any;
    if(result.debug_mode && !verbose) {const {renderer,expansion_pak,rdram_size,rsp_debugger_active,run_ahead_during_operations,rewind_during_operations,...mode}=result.debug_mode;result.debug_mode=mode;}
    return { ...result, adapter_launched_app: local instanceof AutomaticServiceClient && local.launchedApp };
  }));
  server.registerTool('load_rom', { description: 'Open a ROM in the connected Ares app. If the same ROM content is already loaded, returns already_loaded=true without pausing, resetting or changing the current state. Otherwise returns already_loaded=false, replaces the current game, pauses it and invalidates old session/capture handles. Supply system when identification is ambiguous. Returns the new session status.', inputSchema: z.object({ path: z.string().min(1).max(4096), system: z.string().max(128).optional() }).strict() }, p => call(async () => {
    const result = await local.manage({ operation: 'load_rom', ...p }); if (!result.already_loaded) { regions = undefined; operationIdentities.clear();scriptOperations.clear(); } await status(); return result;
  }));
  server.registerTool('close_rom', { description: 'Close the current ROM and return to the empty app. Invalidates session and capture handles.', inputSchema: z.object({}).strict() }, () => call(async () => {
    const result = await local.manage({ operation: 'close_rom' }); regions = undefined; operationIdentities.clear();scriptOperations.clear(); return result;
  }));
  server.registerTool('pause', { description: 'Pause at a native slice boundary and finish an owned operation with reason paused.', inputSchema: z.object({}).strict() }, async () => call(async () => {
    if (!local.identity) await status(); const reply = await local.request('session.pause'); return { ...unwrap(reply), session: reply.session, epoch: reply.epoch };
  }));
  server.registerTool('resume', { description: 'Resume ordinary execution; N64 keep_overrides preserves held controller leases.', inputSchema: z.object({ keep_overrides: z.boolean().default(false) }).strict() }, async ({ keep_overrides }) => call(async () => {
    if (!local.identity) await status(); const reply = await local.request('session.resume', undefined, keep_overrides ? { keepOverrides: true } : undefined); return { ...unwrap(reply), session: reply.session, epoch: reply.epoch };
  }));
  server.registerTool('memory_regions', { description: 'List debugger-region names, sizes, opaque IDs, access flags and session identity. Offsets are region-relative.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, async () => call(async () => {
    regions = await memory.regions(); return { regions: regions.map(({ identity, ...r }) => r), ...local.identity, max_transfer: MAX_TRANSFER };
  }));
  const addr = z.union([z.number().int().nonnegative(), z.string()]);
  server.registerTool('read_memory', { description: 'Read 1–1024 bytes at region-relative addr. Region accepts an exact name or opaque ID.', inputSchema: z.object({ region: z.string(), addr, length: z.number().int().min(1).max(MAX_TRANSFER).default(64) }).strict(), annotations: { readOnlyHint: true } }, async ({ region: name, addr, length }) => call(async () => {
    const r = await region(name), result = await memory.read(r, address(addr), length);
    return { region: r.name, region_id: r.id, addr: `0x${result.offset.toString(16).toUpperCase()}`, len: result.length, hex: result.hex, ...r.identity };
  }));
  server.registerTool('read_memory_many', { description: 'Atomic native safe-point sample: 1–64 ordered region ranges, 64 KiB total. Does not advance paused execution. Returns frame/boundary/sample identity.', inputSchema: z.object({ reads: z.array(z.object({ region: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(65536) }).strict()).min(1).max(64) }).strict(), annotations: { readOnlyHint: true } }, ({ reads }) => call(async () => {
    const ranges = [];
    for (const r of reads) ranges.push({ ...r, region: await region(r.region) });
    return memory.readMany(ranges);
  }));
  server.registerTool('read_memory_many_va', { description: 'N64 CPU/cache or raw RDRAM view atomic safe-point sample; 64 ranges, 64 KiB total.', inputSchema: z.object({ reads: z.array(z.object({ address: z.string(), view: z.enum(['cpu', 'rdram']).default('cpu'), length: z.number().int().min(1).max(65536) }).strict()).min(1).max(64) }).strict(), annotations: { readOnlyHint: true } }, p => call(async () => unwrap(await local.request('n64.memory.readMany', await status(), p))));
  server.registerTool('write_memory', { description: 'EXPERIMENTAL: write 1–1024 hex bytes at region-relative addr. Unavailable/read-only regions reject writes; no cache-coherence promise.', inputSchema: z.object({ region: z.string(), addr, hex_bytes: z.string().max(4096) }).strict(), annotations: { destructiveHint: true } }, async ({ region: name, addr, hex_bytes }) => call(async () => {
    const hex = hex_bytes.trim();
    if (!hex.length || hex.length > MAX_TRANSFER * 2) throw new ServiceError('invalid_request');
    const r = await region(name), result = await memory.write(r, address(addr), hexToBytes(hex));
    return { region: r.name, region_id: r.id, addr: `0x${result.offset.toString(16).toUpperCase()}`, written: result.written, ...r.identity };
  }));
  const maxSeconds = z.number().min(0.001).max(600).default(60);
  const flags = { fpr: z.boolean().default(false), cop0: z.boolean().default(false), verbose: z.boolean().default(false) };
  function rememberOperation(id: number, identity: SessionIdentity) {
    operationIdentities.delete(id); operationIdentities.set(id, identity);
    if (operationIdentities.size > 32) {const oldest=operationIdentities.keys().next().value!;operationIdentities.delete(oldest);scriptOperations.delete(oldest);}
  }
  async function operation(method: 'execution.runFrames' | 'execution.runUntilFrame' | 'execution.stepInstructions', amount: number, seconds: number): Promise<ExecutionOperation> {
    if (!local.identity) await status();
    // Keep the starting identity through every poll. A ROM/reset never silently
    // rebinds this operation to the replacement session.
    const identity = { ...local.identity! };
    const params = method !== 'execution.runUntilFrame' ? { count: amount, timeoutMs: Math.ceil(seconds * 1000) } : { frame: amount, timeoutMs: Math.ceil(seconds * 1000) };
    let result = unwrap(await local.request(method, identity, params));
    rememberOperation(result.operation_id, identity);
    while (result.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 20));
      result = unwrap(await local.request('execution.status', identity, { operationId: result.operation_id }));
    }
    return result;
  }
  server.registerTool('run_frames', { description: 'Run exactly n active VI boundaries and stop; zero advances nothing. A partial starting frame counts toward the next boundary. N64 only (plus synthetic fixture).', inputSchema: z.object({ n: z.number().int().min(0).max(1000000), max_seconds: maxSeconds, screenshot_after: z.record(z.string(), z.unknown()).nullable().default(null), ...flags }).strict() }, async ({ n, max_seconds, screenshot_after, fpr, cop0, verbose }) => call(async () => {
    if ((fpr || cop0) && (await status()).system !== 'Nintendo 64') throw new ServiceError('unavailable');
    const capture = screenshot_after === null ? null : screenshotSchema.parse(screenshot_after);
    if (capture?.inline) throw new ServiceError('invalid_request');
    const result = await runFramesWithScreenshot(local, () => operation('execution.runFrames', n, max_seconds), capture, id => operationIdentities.get(id)!);
    return formatOperation(result,fpr,cop0,verbose);
  }));
  server.registerTool('run_until_frame', { description: 'Run to absolute VI frame k in this epoch; past targets reject.', inputSchema: z.object({ k: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), max_seconds: maxSeconds }).strict() }, async ({ k, max_seconds }) => call(() => operation('execution.runUntilFrame', k, max_seconds)));
  server.registerTool('step', { description: 'Alias for run_frames(1), advancing to the next VI boundary.', inputSchema: z.object({}).strict() }, async () => call(() => operation('execution.runFrames', 1, 60)));
  server.registerTool('operation_status', { description: 'Poll running state or the immutable final result. The last 16 completed operations are retained.', inputSchema: z.object({ operation_id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ...flags }).strict(), annotations: { readOnlyHint: true } }, async ({ operation_id, fpr, cop0, verbose }) => call(async () => {
    if ((fpr || cop0) && (await status()).system !== 'Nintendo 64') throw new ServiceError('unavailable');
    if (!local.identity) await status();
    if(scriptOperations.has(operation_id))return formatOperation(await scriptStatus(local,operation_id,operationIdentities.get(operation_id)!),fpr,cop0,verbose);
    const reply=await local.request('execution.status',operationIdentities.get(operation_id),{operationId:operation_id});
    return formatOperation(unwrap(reply),fpr,cop0,verbose);
  }));
  server.registerTool('cancel_operation', { description: 'Cancel this connection’s current operation, or a specific ID. UI pause can interrupt any owner.', inputSchema: z.object({ operation_id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().default(null) }).strict() }, async ({ operation_id }) => call(async () => {
    if (operation_id === null || !local.identity) await status();
    if(operation_id!==null&&scriptOperations.has(operation_id))await scriptStatus(local,operation_id,operationIdentities.get(operation_id)!);
    return unwrap(await local.request('execution.cancel', operation_id === null ? undefined : operationIdentities.get(operation_id), { operationId: operation_id ?? 0 }));
  }));
  registerViewerTools(server, local, status);
  registerCallTools(server, local, status, rememberOperation);
  registerInspectionTools(server, local, status);
  registerRdpCaptureTools(server, local, status, rememberOperation);
  registerRspTools(server, local, status, rememberOperation);
  registerMachineTools(server, local, status);
  registerBatchTools(server, local, status);
  registerN64Tools(server, local, status, operation, rememberOperation);
  registerInputTools(server, local, status, rememberOperation);
  registerTraceTools(server, local, status, rememberOperation, id => operationIdentities.get(id));
  registerDmaTools(server, local, status);
  registerProfilerTools(server, local, status);
  registerScreenshotTools(server, local, status);
  registerAudioTools(server, local, status);
  registerRecordingTools(server, local, status);
  registerStateTools(server, local, status);
}
