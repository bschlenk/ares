export const CHECKPOINT_NATIVE_METHODS = ['checkpoint.info','checkpoint.capture','checkpoint.read','checkpoint.release','checkpoint.upload','checkpoint.write','checkpoint.commit','checkpoint.abort'] as const;
export interface CheckpointNativeMap {
  'checkpoint.info': {params: undefined; result: {available: boolean; reason: string; hash: string; configuration: string}};
  'checkpoint.capture': {params: undefined|{requireIdle:true}; result: {id: number; bytes: number; stateBytes: number; width: number; height: number; aspect?: number; capture_ms?:number; start_frame?:number; paused?:boolean; capturedAt: number}};
  'checkpoint.read': {params: {id: number; offset: number; length: number}; result: {hex: string}};
  'checkpoint.release': {params: {id: number}; result: {released: true}};
  'checkpoint.upload': {params: {bytes: number;recovery?:true}; result: {id: number}};
  'checkpoint.write': {params: {id: number; offset: number; hex: string}; result: {written: number}};
  'checkpoint.commit': {params: {id: number; resume: boolean}; result: {loaded: true}};
  'checkpoint.abort': {params: {id: number}; result: {released: true}};
}
const int = (n: unknown, max = 80 * 1024 * 1024): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max;
const keys = (p: any, names: string) => p && Object.keys(p).sort().join(',') === names;
export function encodeCheckpoint(method: string, p: any): string | undefined {
  if(method==='checkpoint.info')return p===undefined?'':undefined;
  if(method==='checkpoint.capture')return p===undefined?'':keys(p,'requireIdle')&&p.requireIdle===true?' 1':undefined;
  if (method === 'checkpoint.upload') return (keys(p,'bytes')||keys(p,'bytes,recovery')&&p.recovery===true) && int(p.bytes,64*1024*1024) && p.bytes > 533 ? ` ${p.bytes}${p.recovery?' 1':''}` : undefined;
  if (!p || !int(p.id) || p.id < 1) return;
  if (method === 'checkpoint.read') return keys(p,'id,length,offset') && int(p.offset) && int(p.length,16384) && p.length > 0 ? ` ${p.id} ${p.offset} ${p.length}` : undefined;
  if (method === 'checkpoint.write') return keys(p,'hex,id,offset') && int(p.offset) && typeof p.hex === 'string' && /^(?:[a-f0-9]{2}){1,1800}$/.test(p.hex) ? ` ${p.id} ${p.offset} ${p.hex}` : undefined;
  if (method === 'checkpoint.commit') return keys(p,'id,resume') && typeof p.resume === 'boolean' ? ` ${p.id} ${p.resume ? 1 : 0}` : undefined;
  return keys(p,'id') ? ` ${p.id}` : undefined;
}
export function validCheckpointResult(method: string, p: any): boolean {
  if (!p) return false;
  if (method === 'checkpoint.info') return typeof p.available === 'boolean' && typeof p.reason === 'string' && typeof p.hash === 'string' && (p.hash === '' || /^[a-f0-9]{64}$/.test(p.hash)) && typeof p.configuration==='string' && (p.configuration===''||/^[a-f0-9]{64}$/.test(p.configuration));
  if (method === 'checkpoint.capture') return int(p.id) && p.id > 0 && int(p.bytes) && int(p.stateBytes,64*1024*1024) && p.stateBytes > 533 && int(p.width,4096) && int(p.height,4096) && p.width > 0 && p.height > 0 && p.bytes === p.stateBytes+p.width*p.height*4 && (p.aspect===undefined||Number.isFinite(p.aspect)&&p.aspect>0&&p.aspect<=32) && (p.capture_ms===undefined||Number.isFinite(p.capture_ms)&&p.capture_ms>=0) && (p.start_frame===undefined||Number.isSafeInteger(p.start_frame)&&p.start_frame>=0) && (p.paused===undefined||typeof p.paused==='boolean') && Number.isFinite(p.capturedAt) && p.capturedAt > 0;
  if (method === 'checkpoint.upload') return int(p.id) && p.id > 0;
  if (method === 'checkpoint.read') return typeof p.hex === 'string' && /^(?:[a-f0-9]{2}){1,16384}$/.test(p.hex);
  if (method === 'checkpoint.write') return int(p.written,1800) && p.written > 0;
  if (method === 'checkpoint.commit') return p.loaded === true;
  return p.released === true;
}
