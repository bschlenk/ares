export interface RspTask {
  task_id:number;dispatch_frame:number;origin_commit:number;cpu_pc:string;rsp_pc:string;
  descriptor_layout:'conventional_ostask_dmem_fc0_candidate';header:string;fields:Record<string,string>;
  classification:'declared_graphics_candidate'|'other_or_unknown';boot_imem_hash_xxh64:string;
  previous_identical_descriptor:number|null;resume_mapping:'unverified'|'verified_f3dex2_yield_dma';stopped:boolean;stopped_frame:number;stop_signal_bits:number;
  logical_task_id?:number;resume_from?:number|null;resumed_by?:number|null;resume_reason?:string|null;yield_capture?:{verified:boolean;profile:'f3dex2_fifo_2_04h'|null;address:string|null;bytes:0|3072;sha256:string|null};
  code_overflow:boolean;target_overflow:boolean;
  imem_revisions:{id:number;hash_xxh64:string;frame:number;dram_address:string;imem_address:string;bytes:number}[];
  render_targets:{address:string;width:number;color_depth:number;frame:number;origin_commit:number;draw_commands:number;association:'rsp_dpc_submission'}[];
}
export interface RspTaskResult {
  epoch:number;frame:number;executor:string;cpu_executor:string;capture:'sp_halt_clear_and_consumed_rdp';interpreter_required:false;retention:64;
  dropped_tasks:number;last_dispatch_id:number|null;task:RspTask|null;
  scanouts:{frame:number;origin_commit:number;origin:string;mapping:'candidate_only';reason:string;overflow:boolean;task_candidates:number[]}[];
  capture_cost:{scope:'descriptor_and_imem_snapshots_only';samples:number;total_ns:number;max_ns:number};matrix_state:{available:boolean;reason:string|null;profile?:string;service?:string};
}
const n=(v:any)=>Number.isSafeInteger(v)&&v>=0;
const hex=(v:any)=>typeof v==='string'&&/^0x[0-9a-f]{1,16}$/i.test(v);
const fields=['type','flags','ucode_boot','ucode_boot_size','ucode','ucode_size','ucode_data','ucode_data_size','dram_stack','dram_stack_size','output_buff','output_buff_size','data_ptr','data_size','yield_data_ptr','yield_data_size'];
export function validRspTaskResult(s:any):s is RspTaskResult {
  const t=s?.task;
  if(t?.resume_mapping==='verified_f3dex2_yield_dma'&&t.logical_task_id===undefined)return false;
  if(t?.logical_task_id!==undefined){
    const y=t.yield_capture;
    if(!n(t.logical_task_id)||!t.logical_task_id||![t.resume_from,t.resumed_by].every(v=>v===null||n(v)&&v>0)||!(t.resume_reason===null||typeof t.resume_reason==='string')||!y||typeof y.verified!=='boolean'||!((y.bytes===0&&y.profile===null&&y.address===null&&y.sha256===null&&!y.verified)||(y.bytes===3072&&y.profile==='f3dex2_fifo_2_04h'&&hex(y.address)&&typeof y.sha256==='string'&&/^[a-f0-9]{64}$/.test(y.sha256)))||(t.resume_mapping==='verified_f3dex2_yield_dma'?(t.resume_from===null||t.resume_reason!==null):t.resume_from!==null))return false;
  }
  return !!s&&n(s.epoch)&&s.epoch>0&&n(s.frame)&&['interpreter','recompiler'].includes(s.executor)&&typeof s.cpu_executor==='string'&&s.capture==='sp_halt_clear_and_consumed_rdp'&&s.interpreter_required===false&&s.retention===64&&n(s.dropped_tasks)&&(s.last_dispatch_id===null||n(s.last_dispatch_id)&&s.last_dispatch_id>0)&&
    (t===null||t&&n(t.task_id)&&t.task_id>0&&n(t.dispatch_frame)&&n(t.origin_commit)&&hex(t.cpu_pc)&&hex(t.rsp_pc)&&t.descriptor_layout==='conventional_ostask_dmem_fc0_candidate'&&typeof t.header==='string'&&/^[0-9a-f]{128}$/.test(t.header)&&fields.every(k=>hex(t.fields?.[k]))&&['declared_graphics_candidate','other_or_unknown'].includes(t.classification)&&hex(t.boot_imem_hash_xxh64)&&(t.previous_identical_descriptor===null||n(t.previous_identical_descriptor)&&t.previous_identical_descriptor>0)&&['unverified','verified_f3dex2_yield_dma'].includes(t.resume_mapping)&&typeof t.stopped==='boolean'&&n(t.stopped_frame)&&n(t.stop_signal_bits)&&t.stop_signal_bits<=255&&typeof t.code_overflow==='boolean'&&typeof t.target_overflow==='boolean'&&Array.isArray(t.imem_revisions)&&t.imem_revisions.length<=8&&t.imem_revisions.every((c:any)=>n(c.id)&&c.id>0&&hex(c.hash_xxh64)&&n(c.frame)&&hex(c.dram_address)&&hex(c.imem_address)&&n(c.bytes)&&c.bytes<=4096)&&Array.isArray(t.render_targets)&&t.render_targets.length<=16&&t.render_targets.every((r:any)=>hex(r.address)&&n(r.width)&&r.width>=1&&r.width<=1024&&n(r.color_depth)&&r.color_depth<=3&&n(r.frame)&&n(r.origin_commit)&&n(r.draw_commands)&&r.association==='rsp_dpc_submission'))&&
    Array.isArray(s.scanouts)&&s.scanouts.length<=8&&s.scanouts.every((v:any)=>n(v.frame)&&n(v.origin_commit)&&hex(v.origin)&&v.mapping==='candidate_only'&&typeof v.reason==='string'&&typeof v.overflow==='boolean'&&Array.isArray(v.task_candidates)&&v.task_candidates.length<=8&&v.task_candidates.every((id:any)=>n(id)&&id>0))&&s.capture_cost?.scope==='descriptor_and_imem_snapshots_only'&&n(s.capture_cost?.samples)&&n(s.capture_cost?.total_ns)&&n(s.capture_cost?.max_ns)&&typeof s.matrix_state?.available==='boolean'&&(s.matrix_state.available?s.matrix_state.reason===null:typeof s.matrix_state.reason==='string');
}
