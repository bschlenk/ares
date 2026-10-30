import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ServiceError} from '../services/contracts.js';
import {JOURNAL_LIMITS,type JournalRecord,type JournalReceipt,type JournalPage} from './journal-contracts.js';
interface Data {format:1;nextSequence:number;records:JournalRecord[]}
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,96}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
function canonical(value:unknown,depth=0,seen=new Set<object>(),budget={bytes:0,nodes:0}):unknown{
  if(++budget.nodes>8192)throw new ServiceError('journal_record_too_large');
  if(typeof value==='string'){if(value.length>JOURNAL_LIMITS.recordBytes)throw new ServiceError('journal_record_too_large');budget.bytes+=Buffer.byteLength(value);}
  else budget.bytes+=4;
  if(budget.bytes>JOURNAL_LIMITS.recordBytes)throw new ServiceError('journal_record_too_large');
  if(depth>32)throw new ServiceError('journal_invalid_json');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value!=='object'||!value||seen.has(value))throw new ServiceError('journal_invalid_json');
  seen.add(value);
  try{
    if(Array.isArray(value)&&value.length>8192)throw new ServiceError('journal_record_too_large');
    if(Array.isArray(value))return value.map(v=>canonical(v,depth+1,seen,budget));
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new ServiceError('journal_invalid_json');
    const keys=Object.keys(value);if(keys.length>8192)throw new ServiceError('journal_record_too_large');
    const result=Object.create(null);for(const key of keys.sort()){budget.bytes+=Buffer.byteLength(key);if(budget.bytes>JOURNAL_LIMITS.recordBytes)throw new ServiceError('journal_record_too_large');result[key]=canonical((value as any)[key],depth+1,seen,budget);}return result;
  }finally{seen.delete(value);}
}
function valueText(value:unknown){const text=JSON.stringify(canonical(value));if(Buffer.byteLength(text)>JOURNAL_LIMITS.recordBytes)throw new ServiceError('journal_record_too_large');return text;}
/** One durable, schema-versioned file per plugin/storageVersion. No filesystem paths escape this broker. */
export class PluginJournals {
  private queues=new Map<string,{tail:Promise<unknown>;pending:number}>();
  request(file:string,stream:string,operation:string,params:any,guard:()=>void):Promise<JournalReceipt|JournalPage>{
    if(!token(stream)||!['journal.append','journal.read'].includes(operation))return Promise.reject(new ServiceError('journal_invalid_request'));
    let queue=this.queues.get(file);if(!queue){queue={tail:Promise.resolve(),pending:0};this.queues.set(file,queue);}
    if(queue.pending>=JOURNAL_LIMITS.pending)return Promise.reject(new ServiceError('journal_overload'));
    ++queue.pending;const owned=queue;
    const job=queue.tail.then(()=>this.run(file,stream,operation,params,guard));
    queue.tail=job.catch(()=>{});
    return job.finally(()=>{if(--owned.pending===0&&this.queues.get(file)===owned)this.queues.delete(file);});
  }
  private async cleanStaging(file:string){
    const prefix=path.basename(file)+'.';
    for(const name of await fs.readdir(path.dirname(file))){
      if(!name.startsWith(prefix)||!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(name.slice(prefix.length))||name.slice(prefix.length).length!==36)continue;
      const candidate=path.join(path.dirname(file),name);
      const stat=await fs.lstat(candidate);if(stat.isFile()&&!stat.isSymbolicLink())await fs.rm(candidate,{force:true});
    }
  }
  private async syncDirectory(file:string){const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
  private async load(file:string):Promise<{data:Data;bytes:number}>{
    let handle;
    try{
      handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      const stat=await handle.stat();if(!stat.isFile()||stat.size>JOURNAL_LIMITS.bytes)throw new ServiceError('journal_invalid_file');
      const text=await handle.readFile('utf8');if(Buffer.byteLength(text)>JOURNAL_LIMITS.bytes)throw new ServiceError('journal_invalid_file');
      const data=JSON.parse(text) as Data;
      if(!data||typeof data!=='object'||Array.isArray(data)||data.format!==1||!Array.isArray(data.records)||data.records.length>JOURNAL_LIMITS.records||data.nextSequence!==data.records.length+1)throw new ServiceError('journal_invalid_file');
      const ids=new Set<string>();for(let i=0;i<data.records.length;i++){
        const r=data.records[i];if(!r||r.sequence!==i+1||!token(r.stream)||!token(r.id)||!integer(r.schemaVersion)||!r.schemaVersion||r.schemaVersion>0x7fffffff)throw new ServiceError('journal_invalid_file');
        const id=r.stream+'\0'+r.id;if(ids.has(id))throw new ServiceError('journal_invalid_file');ids.add(id);valueText(r.value);
      }
      return {data,bytes:Buffer.byteLength(text)};
    }catch(error:any){if(error instanceof SyntaxError)throw new ServiceError('journal_invalid_file');if(error.code==='ENOENT')return {data:{format:1,nextSequence:1,records:[]},bytes:0};throw error;}
    finally{await handle?.close();}
  }
  private async run(file:string,stream:string,operation:string,p:any,guard:()=>void):Promise<JournalReceipt|JournalPage>{
    guard();await this.cleanStaging(file);const {data,bytes}=await this.load(file);guard();
    if(operation==='journal.read'){
      if(!p||Object.keys(p).sort().join(',')!=='afterSequence,limit'||!integer(p.afterSequence)||!integer(p.limit)||!p.limit||p.limit>64)throw new ServiceError('journal_invalid_request');
      const eligible=data.records.filter(r=>r.stream===stream&&r.sequence>p.afterSequence),records:JournalRecord[]=[];let pageBytes=0;
      for(const record of eligible){const size=Buffer.byteLength(JSON.stringify(record));if(records.length>=p.limit||pageBytes+size>JOURNAL_LIMITS.pageBytes)break;records.push(record);pageBytes+=size;}
      return {records,cursor:records.at(-1)?.sequence??p.afterSequence,hasMore:eligible.length>records.length,nextSequence:data.nextSequence,bytes,quotaBytes:JOURNAL_LIMITS.bytes};
    }
    if(!p||Object.keys(p).sort().join(',')!=='id,schemaVersion,value'||!token(p.id)||!integer(p.schemaVersion)||!p.schemaVersion||p.schemaVersion>0x7fffffff)throw new ServiceError('journal_invalid_request');
    const text=valueText(p.value),existing=data.records.find(r=>r.stream===stream&&r.id===p.id);
    if(existing){if(existing.schemaVersion!==p.schemaVersion||valueText(existing.value)!==text)throw new ServiceError('journal_id_conflict');await this.syncDirectory(file);return {sequence:existing.sequence,duplicate:true,bytes,quotaBytes:JOURNAL_LIMITS.bytes};}
    if(data.records.length>=JOURNAL_LIMITS.records)throw new ServiceError('journal_quota_exceeded');
    const sequence=data.nextSequence++;data.records.push({sequence,stream,id:p.id,schemaVersion:p.schemaVersion,value:JSON.parse(text)});
    const serialized=JSON.stringify(data);const size=Buffer.byteLength(serialized);if(size>JOURNAL_LIMITS.bytes)throw new ServiceError('journal_quota_exceeded');
    const temporary=file+'.'+randomUUID();let published=false;
    try{
      const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(serialized);await output.sync();}finally{await output.close();}
      guard();await fs.rename(temporary,file);published=true;
      await this.syncDirectory(file);
      return {sequence,duplicate:false,bytes:size,quotaBytes:JOURNAL_LIMITS.bytes};
    }catch(error){if(published)throw new ServiceError('journal_durability_uncertain');throw error;}
    finally{await fs.rm(temporary,{force:true});}
  }
}
