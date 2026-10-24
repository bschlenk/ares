export const SCRIPT_NATIVE_METHODS = ['script.pending','script.resolve','script.prepare','script.write','script.start','script.read','script.observerPrepare','script.observerWrite','script.observerStart','script.observerRead','script.observerStop'] as const;
export interface ScriptRunParams { path?: string; source?: string; args: unknown; timeoutMs: number; maxFrames: number; statePaths?: string[]; outputPaths?: string[]; outputPath?: string }
export interface ScriptServiceMap {
  'script.pending': {params:undefined;result:{running:boolean;pending:{id:number;kind:'state_load'|'state_save'|'screenshot';path:string}|null}};
  'script.resolve': {params:{id:number;ok:boolean;hex:string};result:{resolved:true}};

  'script.observerPrepare': ScriptServiceMap['script.prepare'];
  'script.observerWrite': ScriptServiceMap['script.write'];
  'script.observerRead': ScriptServiceMap['script.read'];
  'script.observerStart': {params:{timeoutMs:number;maxFrames:number};result:{observer_id:number}};
  'script.observerStop': {params:undefined;result:{stopped:true}};
  'scripts.observe': {params:ScriptRunParams;result:{observer_id:number}};

  'script.prepare': {params:{bytes:number};result:{ready:true}};
  'script.write': {params:{hex:string};result:{written:true}};
  'script.start': {params:{timeoutMs:number;maxFrames:number};result:import('./contracts.js').ExecutionOperation};
  'script.read': {params:{offset:number;length:number;operationId?:number};result:{native_reads:number;native_read_bytes:number;native_read_ns:number;operation_id:number;hex:string;bytes:number;error:string;logs:string[];active?:boolean;frame?:number;artifacts?:{id:number;kind:string;path:string}[]}};
  'scripts.run': {params:ScriptRunParams;result:import('./contracts.js').ExecutionOperation};
}
export function encodeScript(method:string,p:any):string|undefined {
  if(method==='script.pending')return p===undefined?'':undefined;
  if(method==='script.resolve')return p&&Object.keys(p).sort().join(',')==='hex,id,ok'&&Number.isSafeInteger(p.id)&&p.id>0&&typeof p.ok==='boolean'&&typeof p.hex==='string'&&/^(?:[0-9a-f]{2}){1,1536}$/.test(p.hex)?` ${p.id} ${p.ok?1:0} ${p.hex}`:undefined;
  if(method==='script.observerStop')return p===undefined?'':undefined;
  method=method.replace('script.observerPrepare','script.prepare').replace('script.observerWrite','script.write').replace('script.observerRead','script.read').replace('script.observerStart','script.start');
  const keys=(k:string)=>p&&Object.keys(p).sort().join(',')===k;
  const n=(v:any,max:number)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
  if(method==='script.prepare')return keys('bytes')&&n(p.bytes,262144)&&p.bytes?` ${p.bytes}`:undefined;
  if(method==='script.write')return keys('hex')&&typeof p.hex==='string'&&/^(?:[0-9a-f]{2}){1,1024}$/.test(p.hex)?` ${p.hex}`:undefined;
  if(method==='script.start')return keys('maxFrames,timeoutMs')&&n(p.timeoutMs,600000)&&p.timeoutMs&&n(p.maxFrames,1000000)?` ${p.timeoutMs} ${p.maxFrames}`:undefined;
  if(method==='script.read')return (keys('length,offset')||keys('length,offset,operationId')&&n(p.operationId,Number.MAX_SAFE_INTEGER))&&n(p.offset,4194304)&&n(p.length,16384)&&p.length?` ${p.offset} ${p.length}${p.operationId===undefined?'':' '+p.operationId}`:undefined;
}
export function validScriptRun(p:any):p is ScriptRunParams {
  return p&&typeof p==='object'&&Object.keys(p).every(k=>['path','source','args','timeoutMs','maxFrames','statePaths','outputPaths','outputPath'].includes(k))&&((typeof p.path==='string'&&p.path.length>0&&p.path.length<=4096&&!p.path.includes('\0')&&p.source===undefined)||(typeof p.source==='string'&&p.source.length>0&&p.source.length<=131072&&p.path===undefined))&&Number.isInteger(p.timeoutMs)&&p.timeoutMs>0&&p.timeoutMs<=600000&&Number.isInteger(p.maxFrames)&&p.maxFrames>=0&&p.maxFrames<=1000000&&[p.statePaths,p.outputPaths].every(a=>a===undefined||Array.isArray(a)&&a.length<=32&&a.every(v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!v.includes('\0')))&&(p.outputPath===undefined||typeof p.outputPath==='string'&&p.outputPath.length>0&&p.outputPath.length<=4096&&!p.outputPath.includes('\0'))&&Object.hasOwn(p,'args')&&new TextEncoder().encode(JSON.stringify(p.args)).length<=65536;
}
