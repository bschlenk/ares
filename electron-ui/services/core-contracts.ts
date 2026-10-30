/** Cross-core services use native button names and session-bound port discovery. */
export const CORE_METHODS = ['input.describe','input.set','input.release','input.state','clock.waitStart','clock.waitRead','clock.waitCancel'] as const;
export interface DigitalInputState {
  epoch:number; frame:number; human_takeovers:number; max_lease_frames:600; max_lease_ms:10000;
  ports:{port:number;path:string;buttons:string[];held:string[];owner:string|null;start_frame:number|null;latched_frame:number|null;expires_frame:number|null}[];
}
export interface ElapsedWait {
  wait_id:number; owner:string; epoch:number; start_frame:number; target_frame:number; frame:number; elapsed_frames:number;
  frame_kind:string; state:'waiting'|'done'; reason:''|'frames_elapsed'|'deadline'|'cancelled'|'reset'|'host_input';
}
export interface CoreServiceMap {
  'input.describe':{params:undefined;result:DigitalInputState};
  'input.state':{params:undefined;result:DigitalInputState};
  'input.set':{params:{port:number;buttons:string[];leaseFrames:number;leaseMs:number};result:DigitalInputState};
  'input.release':{params:{port:number};result:DigitalInputState};
  'clock.waitStart':{params:{frames:number;timeoutMs:number};result:ElapsedWait};
  'clock.waitRead':{params:{waitId:number};result:ElapsedWait};
  'clock.waitCancel':{params:{waitId:number};result:ElapsedWait};
}
const n=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=max;
const keys=(p:any,k:string)=>p&&typeof p==='object'&&Object.keys(p).sort().join(',')===k;
export function encodeCore(method:string,p:any):string|undefined {
  if(['input.describe','input.state'].includes(method))return p===undefined?'':undefined;
  if(method==='input.release')return keys(p,'port')&&n(p.port,256)?` ${p.port}`:undefined;
  if(method==='input.set')return keys(p,'buttons,leaseFrames,leaseMs,port')&&n(p.port,256)&&p.port>0&&n(p.leaseFrames,600)&&p.leaseFrames>0&&n(p.leaseMs,10000)&&p.leaseMs>0&&Array.isArray(p.buttons)&&p.buttons.length<=64&&p.buttons.every((s:unknown)=>typeof s==='string'&&s.length>0&&new TextEncoder().encode(s).length<=256)?` ${p.port} ${p.leaseFrames} ${p.leaseMs} ${p.buttons.length?p.buttons.map((s:string)=>Array.from(new TextEncoder().encode(s),b=>b.toString(16).padStart(2,'0')).join('')).join(' '):'-'}`:undefined;
  if(method==='clock.waitStart')return keys(p,'frames,timeoutMs')&&n(p.frames,600)&&n(p.timeoutMs,60000)&&p.timeoutMs>0?` ${p.frames} ${p.timeoutMs}`:undefined;
  return keys(p,'waitId')&&n(p.waitId)&&p.waitId>0?` ${p.waitId}`:undefined;
}
export function validCore(method:string,s:any):boolean {
  if(!s||!n(s.epoch)||!n(s.frame))return false;
  if(method.startsWith('clock.'))return n(s.wait_id)&&s.wait_id>0&&typeof s.owner==='string'&&n(s.start_frame)&&n(s.target_frame)&&s.target_frame>=s.start_frame&&s.frame>=s.start_frame&&s.elapsed_frames===s.frame-s.start_frame&&typeof s.frame_kind==='string'&&['waiting','done'].includes(s.state)&&['','frames_elapsed','deadline','cancelled','reset','host_input'].includes(s.reason)&&(s.state==='waiting')===(s.reason==='');
  return n(s.human_takeovers)&&s.max_lease_frames===600&&s.max_lease_ms===10000&&Array.isArray(s.ports)&&s.ports.length<=256&&s.ports.every((p:any,i:number)=>p.port===i+1&&typeof p.path==='string'&&Array.isArray(p.buttons)&&p.buttons.every((v:unknown)=>typeof v==='string')&&Array.isArray(p.held)&&p.held.every((v:unknown)=>p.buttons.includes(v))&&(p.owner===null||typeof p.owner==='string')&&(p.start_frame===null||n(p.start_frame))&&(p.latched_frame===null||n(p.latched_frame))&&(p.expires_frame===null||n(p.expires_frame)));
}
