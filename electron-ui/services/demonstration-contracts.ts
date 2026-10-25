export const DEMONSTRATION_METHODS=['n64.demo.request','n64.demo.status','n64.demo.start','n64.demo.stop','n64.demo.cancel','n64.demo.read','n64.demo.importBegin','n64.demo.append','n64.demo.importCommit','n64.demo.replay'] as const;
export const INPUT_ARTIFACT_METHODS=['artifact.inputRequest','artifact.inputExport','artifact.inputImport'] as const;
export interface DemonstrationStatus {job_id:number;state:string;prompt:string;source:string;port:number;epoch:number;start_frame:number;end_frame:number;duration_frames:number;events:number;cursor:number;complete:boolean;overflow:boolean;stop_reason:string;rom_sha256:string;session:string;state_sha256:string|null;boundary:'n64_si_gamepad_read';axis_convention:'signed_8bit_after_gate';rate:'vi_relative_variable_latches';version:1}
export interface InputEvent {sequence:number;frame:number;port:number;raw:number;buttons:number;x:number;y:number}
export interface DemonstrationRequest {maxFrames:number;timeoutMs:number;port:number;source:'human'|'merged';prompt:string;stateHash:string}
export interface DemonstrationServiceMap {
 'n64.demo.request':{params:DemonstrationRequest;result:DemonstrationStatus};
 'n64.demo.status':{params:undefined;result:DemonstrationStatus};
 'n64.demo.start':{params:undefined;result:DemonstrationStatus};
 'n64.demo.stop':{params:undefined;result:DemonstrationStatus};
 'n64.demo.cancel':{params:undefined;result:DemonstrationStatus};
 'n64.demo.read':{params:{offset:number;length:number};result:{status:DemonstrationStatus;offset:number;events:InputEvent[]}};
 'n64.demo.importBegin':{params:{frames:number;port:number;stateHash:string};result:DemonstrationStatus};
 'n64.demo.append':{params:{events:{frame:number;port:number;raw:number}[]};result:DemonstrationStatus};
 'n64.demo.importCommit':{params:undefined;result:DemonstrationStatus};
 'n64.demo.replay':{params:undefined;result:DemonstrationStatus};
 'artifact.inputRequest':{params:Omit<DemonstrationRequest,'stateHash'>&{statePath?:string};result:DemonstrationStatus};
 'artifact.inputExport':{params:{path:string};result:{path:string;bytes:number;sha256:string}};
 'artifact.inputImport':{params:{path:string};result:DemonstrationStatus};
}
const n=(v:any,max:number)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const keys=(p:any,names:string[])=>p&&Object.keys(p).sort().join(',')===names.sort().join(',');
export function encodeDemonstration(method:string,p:any):string|undefined {
 if(method==='artifact.inputImport'||method==='artifact.inputExport')return keys(p,['path'])&&typeof p.path==='string'&&p.path.length>0&&p.path.length<=4096&&!p.path.includes('\0')?'':undefined;
 if(method==='artifact.inputRequest'){if(!p||Object.keys(p).some(k=>!['maxFrames','timeoutMs','port','source','prompt','statePath'].includes(k))||p.statePath!==undefined&&(typeof p.statePath!=='string'||!p.statePath.length||p.statePath.length>4096||p.statePath.includes('\0')))return;const {statePath,...request}=p;return encodeDemonstration('n64.demo.request',{...request,stateHash:'-'});}
 if(method==='n64.demo.request')return keys(p,['maxFrames','timeoutMs','port','source','prompt','stateHash'])&&n(p.maxFrames,36000)&&p.maxFrames>0&&n(p.timeoutMs,600000)&&p.timeoutMs>0&&n(p.port,4)&&p.port>0&&['human','merged'].includes(p.source)&&typeof p.prompt==='string'&&new TextEncoder().encode(p.prompt).length<=1024&&!p.prompt.includes('\0')&&typeof p.stateHash==='string'&&/^(?:-|[a-f0-9]{64})$/.test(p.stateHash)?` ${p.maxFrames} ${p.timeoutMs} ${p.port} ${p.source} ${Array.from(new TextEncoder().encode(p.prompt),b=>b.toString(16).padStart(2,'0')).join('')||'-'} ${p.stateHash}`:undefined;
 if(method==='n64.demo.read')return keys(p,['offset','length'])&&n(p.offset,120000)&&n(p.length,128)&&p.length>0?` ${p.offset} ${p.length}`:undefined;
 if(method==='n64.demo.importBegin')return keys(p,['frames','port','stateHash'])&&n(p.frames,36000)&&p.frames>0&&n(p.port,4)&&p.port>0&&typeof p.stateHash==='string'&&/^(?:-|[a-f0-9]{64})$/.test(p.stateHash)?` ${p.frames} ${p.port} ${p.stateHash}`:undefined;
 if(method==='n64.demo.append')return keys(p,['events'])&&Array.isArray(p.events)&&p.events.length>0&&p.events.length<=32&&p.events.every((e:any)=>keys(e,['frame','port','raw'])&&n(e.frame,35999)&&n(e.port,4)&&e.port>0&&n(e.raw,0xffffffff))?p.events.map((e:any)=>` ${e.frame} ${e.port} ${e.raw}`).join(''):undefined;
 return p===undefined?'':undefined;
}
export function validDemonstration(method:string,s:any):boolean {
 if(method==='n64.demo.read')return !!s&&validDemonstration('n64.demo.status',s.status)&&n(s.offset,120000)&&Array.isArray(s.events)&&s.events.length<=128&&s.events.every((e:any)=>n(e.sequence,119999)&&n(e.frame,35999)&&n(e.port,4)&&e.port>0&&n(e.raw,0xffffffff)&&e.buttons===e.raw>>>16&&e.x===(e.raw>>8<<24>>24)&&e.y===(e.raw<<24>>24));
 return !!s&&n(s.job_id,Number.MAX_SAFE_INTEGER)&&['idle','armed','recording','replaying','ready','cancelled','importing'].includes(s.state)&&typeof s.prompt==='string'&&n(s.port,4)&&s.port>0&&['human','merged'].includes(s.source)&&n(s.events,120000)&&n(s.cursor,120000)&&n(s.duration_frames,36000)&&n(s.epoch,Number.MAX_SAFE_INTEGER)&&n(s.start_frame,Number.MAX_SAFE_INTEGER)&&n(s.end_frame,Number.MAX_SAFE_INTEGER)&&typeof s.complete==='boolean'&&typeof s.overflow==='boolean'&&typeof s.stop_reason==='string'&&typeof s.rom_sha256==='string'&&typeof s.session==='string'&&(s.state_sha256===null||typeof s.state_sha256==='string')&&s.version===1&&s.boundary==='n64_si_gamepad_read'&&s.axis_convention==='signed_8bit_after_gate'&&s.rate==='vi_relative_variable_latches';
}
