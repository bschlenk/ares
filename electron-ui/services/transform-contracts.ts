import type {FrameReference} from './frame-contracts.js';
export interface TransformState {id:number;code_sha256:string;modelview_raw:string;projection_raw:string;combined_raw:string|null;viewport_raw:string;segment4:string;depth:number|null}
export interface CapturedTransform {
 seq:number;task_id:number|null;source_vi:number;word0:string;word1:string;command_complete:boolean;before_depth:number|null;
 operand_raw:string|null;vertex_state:TransformState|null;vertex_batches:number;
 state:TransformState|null;
}
export interface TransformPage {
 epoch:number;generation:number;frame_reference:FrameReference|null;profile:'f3dex2_fifo_2_04h';capacity:256;history_capacity:4;
 committed:number;retained:number;dropped:number;truncated:boolean;matrix_overflow:boolean;offset:number;entries:CapturedTransform[];next_offset:number|null;
}
const n=(v:any,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const raw=(v:any,bytes:number)=>typeof v==='string'&&v.length===bytes*2&&/^[0-9a-f]+$/.test(v);
const word=(v:any)=>typeof v==='string'&&/^0x[0-9a-f]{1,8}$/.test(v);
const depth=(v:any)=>v===null||n(v,32);
export function validTransformPage(p:any):p is TransformPage {
 if(!p||!n(p.epoch)||!p.epoch||!n(p.generation)||!p.generation||p.profile!=='f3dex2_fifo_2_04h'||p.capacity!==256||p.history_capacity!==4||!n(p.committed)||!n(p.retained,256)||p.retained>p.committed||p.dropped!==p.committed-p.retained||p.truncated!==(p.dropped>0)||typeof p.matrix_overflow!=='boolean'||!n(p.offset,p.retained)||!Array.isArray(p.entries)||p.entries.length>32||p.offset+p.entries.length>p.retained)return false;
 const f=p.frame_reference;if(f!==null&&(!f||typeof f.native_session!=='string'||f.epoch!==p.epoch||!n(f.vi)||!n(f.origin,0xffffff)||!n(f.origin_commit)||f.boundary!=='capture_commit'||f.provenance!=='unmatched'||f.video_sequence!==null||f.presentation!==null))return false;
 const end=p.offset+p.entries.length;if(end<p.retained?p.next_offset!==end||end===p.offset:p.next_offset!==null)return false;
 return p.entries.every((r:any)=>{
  if(!r||!n(r.seq)||!(r.task_id===null||n(r.task_id)&&r.task_id>0)||!n(r.source_vi)||!word(r.word0)||(parseInt(r.word0,16)>>>24)!==0xda||!word(r.word1)||typeof r.command_complete!=='boolean'||!depth(r.before_depth)||!(r.operand_raw===null||raw(r.operand_raw,64)))return false;
  const validState=(s:any)=>s===null||s&&n(s.id)&&s.id>0&&raw(s.code_sha256,32)&&raw(s.modelview_raw,64)&&raw(s.projection_raw,64)&&(s.combined_raw===null||raw(s.combined_raw,64))&&raw(s.viewport_raw,16)&&word(s.segment4)&&depth(s.depth);
  return n(r.vertex_batches,0xffffffff)&&validState(r.state)&&validState(r.vertex_state)&&(r.command_complete||r.state===null&&r.vertex_state===null)&&(r.vertex_state===null?r.vertex_batches===0:r.vertex_batches>0);
 });
}
