export interface FixedMatrix {raw:string;fixed:number[];values:number[]}
export interface RspMatrixState {
 id:number;code_sha256:string;task_id:number|null;source_vi:number;command_seq:number;profile:'f3dex2_fifo_2_04h';provenance:'actual_rsp_state';boundary:'before_command'|'after_command';
 modelview:FixedMatrix;projection:FixedMatrix;combined:FixedMatrix|null;combined_raw:string;
 viewport:{raw:string;s16:number[];xy_subpixel_bits:2};segments:string[];
 stack:{base:string;pointer:string;depth:number|null;complete:boolean;saved_source:'observed_rsp_dma_writes';saved_ram_current:false;saved:(FixedMatrix|null)[]};
}
export interface MatrixPage {epoch:number;generation:number;profile:'f3dex2_fifo_2_04h';live_profile_supported:boolean;capacity:512;stack_capacity:32;overflow:boolean;retained:number;offset:number;entries:RspMatrixState[];next_offset:number|null}
const n=(v:any,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const hex=(v:any)=>typeof v==='string'&&/^0x[0-9a-f]{1,8}$/.test(v);
const raw=(v:any,bytes:number)=>typeof v==='string'&&v.length===bytes*2&&/^[0-9a-f]+$/.test(v);
export function validFixedMatrix(m:any):m is FixedMatrix {
 return !!m&&raw(m.raw,64)&&Array.isArray(m.fixed)&&m.fixed.length===16&&Array.isArray(m.values)&&m.values.length===16&&m.fixed.every((v:any,i:number)=>Number.isInteger(v)&&v===(parseInt(m.raw.slice(i*4,i*4+4),16)<<16|parseInt(m.raw.slice(64+i*4,68+i*4),16))&&m.values[i]===v/65536);
}
export function validMatrixState(s:any):s is RspMatrixState {
 if(!s||!raw(s.code_sha256,32)||!n(s.id)||!s.id||!(s.task_id===null||n(s.task_id)&&s.task_id>0)||!n(s.source_vi)||!n(s.command_seq)||s.profile!=='f3dex2_fifo_2_04h'||s.provenance!=='actual_rsp_state'||!['before_command','after_command'].includes(s.boundary)||!validFixedMatrix(s.modelview)||!validFixedMatrix(s.projection)||!(s.combined===null||validFixedMatrix(s.combined))||!raw(s.combined_raw,64)||s.combined!==null&&s.combined.raw!==s.combined_raw||!raw(s.viewport?.raw,16)||s.viewport.xy_subpixel_bits!==2||!Array.isArray(s.viewport.s16)||s.viewport.s16.length!==8||!s.viewport.s16.every((v:any,i:number)=>v===(parseInt(s.viewport.raw.slice(i*4,i*4+4),16)<<16>>16))||!Array.isArray(s.segments)||s.segments.length!==16||!s.segments.every(hex))return false;
 const stack=s.stack;
 return !!stack&&hex(stack.base)&&hex(stack.pointer)&&(stack.depth===null||n(stack.depth,32))&&Array.isArray(stack.saved)&&stack.saved.length<=32&&stack.saved.length===(stack.depth??0)&&stack.saved.every((v:any)=>v===null||validFixedMatrix(v))&&stack.complete===(stack.depth!==null&&stack.saved.every((v:any)=>v!==null))&&stack.saved_source==='observed_rsp_dma_writes'&&stack.saved_ram_current===false;
}
export function validMatrixPage(s:any):s is MatrixPage {
 if(!s||!n(s.epoch)||!s.epoch||!n(s.generation)||!s.generation||s.profile!=='f3dex2_fifo_2_04h'||typeof s.live_profile_supported!=='boolean'||s.capacity!==512||s.stack_capacity!==32||typeof s.overflow!=='boolean'||!n(s.retained,512)||!n(s.offset,s.retained)||!Array.isArray(s.entries)||s.entries.length>8||s.offset+s.entries.length>s.retained||!s.entries.every(validMatrixState))return false;
 const end=s.offset+s.entries.length;return end<s.retained?s.next_offset===end&&end>s.offset:s.next_offset===null;
}
export interface DrawVertex {index:number;transform_state_id:number|null;modified:boolean;raw:string;clip_fixed:number[];screen_xy:number[]}
export function validDrawVertex(v:any):v is DrawVertex {
 return !!v&&n(v.index,31)&&(v.transform_state_id===null||n(v.transform_state_id)&&v.transform_state_id>0)&&typeof v.modified==='boolean'&&raw(v.raw,40)&&Array.isArray(v.clip_fixed)&&v.clip_fixed.length===4&&v.clip_fixed.every((x:any,i:number)=>x===(parseInt(v.raw.slice(i*4,i*4+4),16)<<16|parseInt(v.raw.slice(16+i*4,20+i*4),16)))&&Array.isArray(v.screen_xy)&&v.screen_xy.length===2&&v.screen_xy.every((x:any,i:number)=>x===(parseInt(v.raw.slice(48+i*4,52+i*4),16)<<16>>16)/4);
}
