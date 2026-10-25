import {validTransformPage,type TransformPage} from './transform-contracts.js';
import {validMatrixPage,validDrawVertex,type MatrixPage,type DrawVertex} from './matrix-contracts.js';
import { hex64 } from './n64-contracts.js';
export const VIEWER_METHODS = ['n64.capture.control', 'n64.capture.rsp', 'n64.capture.rdp','n64.capture.matrices','n64.capture.transforms'] as const;
export interface ViewerControl { rsp: boolean; rdp: boolean; rsp_owner: string | null; rdp_owner: string | null; rsp_mode: string; rspq_supported: boolean; configuration: string; capacity: 4096; presented_frame: number }
export interface ConsumedMatrixOperand {provenance:'consumed_dma_operand_only';microcode_gate:'f3dex2_dispatch_signature';dma_count:number;ambiguous:boolean;dram_address:string;dmem_address:string;raw:string|null;rsp_matrix_stack:null}
export interface RspCommand {matrix_before_id?:number|null;matrix_after_id?:number|null;command_complete?:boolean;draw_vertices?:DrawVertex[];task_id?:number|null;source_vi?:number;consumed_matrix?:ConsumedMatrixOperand|null; seq: number; frame: number; cycle: number; bytesIn: number; bytesOut: number; overlay: string; command: string; overhead: boolean; args: string | null; words: string[]; words_truncated: boolean }
export interface RdpCommand { seq: number; frame: number; opcode: string; name: string; word0: string; word1: string; wordCount: number; description: string }
export interface ViewerPage { epoch: number; generation: number; kind: 'rsp' | 'rdp'; mode: string; frame_kind: 'vi_origin_swaps'; presented_frame: number; configured: boolean; rspq_supported: boolean; committed: number; retained: number; dropped: number; truncated: boolean; capacity: 4096; offset: number; entries: (RspCommand | RdpCommand)[]; next_offset: number | null }
export interface ViewerServiceMap {
  'n64.capture.transforms':{params:{generation:number|null;offset:number;limit:number};result:TransformPage};
  'n64.capture.matrices':{params:{generation:number|null;offset:number;limit:number};result:MatrixPage};
  'n64.capture.control': { params: { rsp: boolean | null; rdp: boolean | null }; result: ViewerControl };
  'n64.capture.rsp': { params: { generation: number | null; offset: number; limit: number }; result: ViewerPage };
  'n64.capture.rdp': { params: { generation: number | null; offset: number; limit: number }; result: ViewerPage };
}
const n = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const owner = (v: unknown) => v === null || typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const keys = (p: any, expected: string) => !!p && typeof p === 'object' && Object.keys(p).sort().join(',') === expected;
export function encodeViewer(method: string, p: any): string | undefined {
  if (method === 'n64.capture.control') return keys(p, 'rdp,rsp') && [p.rsp, p.rdp].every(x => x === null || typeof x === 'boolean') ? ` ${p.rsp === null ? -1 : +p.rsp} ${p.rdp === null ? -1 : +p.rdp}` : undefined;
  return keys(p, 'generation,limit,offset') && (p.generation === null || n(p.generation) && p.generation > 0) && n(p.offset, method==='n64.capture.transforms'?256:method==='n64.capture.matrices'?512:4096) && n(p.limit, method==='n64.capture.transforms'?32:method==='n64.capture.matrices'?8:64) && p.limit > 0 ? ` ${p.generation ?? 0} ${p.offset} ${p.limit}` : undefined;
}
export function validViewer(method: string, s: any): boolean {
  if(method==='n64.capture.transforms')return validTransformPage(s);
  if(method==='n64.capture.matrices')return validMatrixPage(s);
  if (!s) return false;
  if (method === 'n64.capture.control') return typeof s.rsp === 'boolean' && typeof s.rdp === 'boolean' && owner(s.rsp_owner) && owner(s.rdp_owner) && typeof s.rsp_mode === 'string' && s.rsp_mode.length <= 64 && typeof s.configuration === 'string' && s.configuration.length <= 256 && s.rspq_supported === true && s.capacity === 4096 && n(s.presented_frame);
  if (!n(s.epoch) || !s.epoch || !n(s.generation) || !s.generation || s.kind !== (method === 'n64.capture.rsp' ? 'rsp' : 'rdp') || typeof s.mode !== 'string' || s.frame_kind !== 'vi_origin_swaps' || !n(s.presented_frame) || typeof s.configured !== 'boolean' || s.rspq_supported !== true || !n(s.committed) || !n(s.retained, 4096) || s.retained > s.committed || s.dropped !== s.committed - s.retained || s.truncated !== (s.dropped > 0) || s.capacity !== 4096 || !n(s.offset, 4096) || s.offset > s.retained || !Array.isArray(s.entries) || s.entries.length > 64 || s.offset + s.entries.length > s.retained) return false;
  const end = s.offset + s.entries.length;
  if (end < s.retained ? s.next_offset !== end || !s.entries.length : s.next_offset !== null) return false;
  return s.entries.every((r: any) => {
    if (!r || !n(r.seq) || !n(r.frame)) return false;
    if (s.kind === 'rdp') return hex64(r.opcode) && BigInt(r.opcode) < 64n && typeof r.name === 'string' && typeof r.description === 'string' && r.description.length <= 256 && hex64(r.word0) && hex64(r.word1) && n(r.wordCount, 22) && r.wordCount > 0;
    if(r.command_complete!==undefined&&typeof r.command_complete!=='boolean'||[r.matrix_before_id,r.matrix_after_id].some(id=>id!==undefined&&id!==null&&(!n(id)||!id))||r.draw_vertices!==undefined&&(!Array.isArray(r.draw_vertices)||r.draw_vertices.length>6||!r.draw_vertices.every(validDrawVertex)))return false;
    if(r.task_id!==undefined&&r.task_id!==null&&(!n(r.task_id)||!r.task_id)||r.source_vi!==undefined&&!n(r.source_vi))return false;
    if(r.consumed_matrix!==undefined&&r.consumed_matrix!==null){const m=r.consumed_matrix;if(m.provenance!=='consumed_dma_operand_only'||m.microcode_gate!=='f3dex2_dispatch_signature'||!n(m.dma_count,0xffffffff)||m.ambiguous!==(m.dma_count>1)||!hex64(m.dram_address)||!hex64(m.dmem_address)||m.rsp_matrix_stack!==null||!(m.dma_count?typeof m.raw==='string'&&/^[0-9a-f]{128}$/.test(m.raw):m.raw===null))return false;}
    return n(r.cycle, 0xffffffff) && n(r.bytesIn) && n(r.bytesOut) && typeof r.overlay === 'string' && typeof r.command === 'string' && typeof r.overhead === 'boolean' && (r.args === null || typeof r.args === 'string') && Array.isArray(r.words) && (r.overhead ? r.words.length === 0 : r.words.length > 0 && r.words.length <= 16) && typeof r.words_truncated === 'boolean' && r.words.every((w: unknown) => hex64(w) && BigInt(w as string) <= 0xffffffffn);
  });
}
