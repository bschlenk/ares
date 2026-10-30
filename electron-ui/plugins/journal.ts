import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ServiceError} from '../services/contracts.js';
import {JOURNAL_LIMITS,type JournalRecord,type JournalReceipt,type JournalPage} from './journal-contracts.js';
interface Data {format:1;nextSequence:number;records:JournalRecord[];excluded?:[number,number][];recovery?:{pointId:string;journalSequence:number;targetSession:string;at:string}}
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
    return this.serial(file,()=>this.run(file,stream,operation,params,guard));
  }
  private serial<T>(file:string,work:()=>Promise<T>):Promise<T>{
    let queue=this.queues.get(file);if(!queue){queue={tail:Promise.resolve(),pending:0};this.queues.set(file,queue);}
    if(queue.pending>=JOURNAL_LIMITS.pending)return Promise.reject(new ServiceError('journal_overload'));
    ++queue.pending;const owned=queue;
    const job=queue.tail.then(work);
    queue.tail=job.catch(()=>{});
    return job.finally(()=>{if(--owned.pending===0&&this.queues.get(file)===owned)this.queues.delete(file);});
  }
  /** Holds the namespace queue until the paired state is published. */
  withSnapshot<T>(file:string,guard:()=>void,work:(bytes:Buffer,sequence:number)=>Promise<T>):Promise<T>{
    return this.serial(file,async()=>{guard();await this.cleanStaging(file);const {data}=await this.load(file);guard();
      const bytes=Buffer.from(JSON.stringify(data));if(bytes.length>JOURNAL_LIMITS.bytes-65536)throw new ServiceError('recovery_journal_needs_space');
      return work(bytes,data.nextSequence-1);
    });
  }
  verifyRecovery(file:string,snapshot:Buffer):Promise<void>{return this.serial(file,async()=>{const {data}=await this.load(file);this.verifyPrefix(data,snapshot);});}
  private verifyPrefix(data:Data,snapshot:Buffer){const frozen=JSON.parse(snapshot.toString('utf8')) as Data;const cutoff=frozen.nextSequence-1;
    if(frozen.format!==1||(frozen.excluded!==undefined&&(!Array.isArray(frozen.excluded)||frozen.excluded.length>1024||frozen.excluded.some(r=>!Array.isArray(r)||r.length!==2||!integer(r[0])||!integer(r[1])||r[0]<1||r[0]>r[1]||r[1]>cutoff)))||!integer(cutoff)||!Array.isArray(frozen.records)||cutoff!==frozen.records.length||JSON.stringify(data.records.slice(0,cutoff))!==JSON.stringify(frozen.records))throw new ServiceError('recovery_journal_diverged');return cutoff;
  }
  applyRecovery(file:string,snapshot:Buffer,pointId:string,targetSession:string,guard:()=>void):Promise<void>{
    return this.serial(file,async()=>{
      guard();const {data}=await this.load(file);const cutoff=this.verifyPrefix(data,snapshot);
      const frozen=JSON.parse(snapshot.toString('utf8')) as Data;
      const ranges:[number,number][]=[...(frozen.excluded??[])];if(cutoff<data.records.length)ranges.push([cutoff+1,data.records.length]);
      ranges.sort((a,b)=>a[0]-b[0]);const merged:[number,number][]=[];
      for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1]+1)last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
      if(merged.length>1024)throw new ServiceError('recovery_history_limit');
      data.excluded=merged;data.recovery={pointId,journalSequence:cutoff,targetSession,at:new Date().toISOString()};
      await this.publish(file,JSON.stringify(data),guard);
    });
  }
  private visible(data:Data,sequence:number){return !(data.excluded??[]).some(([first,last])=>sequence>=first&&sequence<=last);}
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
      if(data.excluded!==undefined&&(!Array.isArray(data.excluded)||data.excluded.length>1024||data.excluded.some(r=>!Array.isArray(r)||r.length!==2||!integer(r[0])||!integer(r[1])||r[0]<1||r[0]>r[1]||r[1]>=data.nextSequence)))throw new ServiceError('journal_invalid_file');
      if(data.recovery!==undefined&&(!data.recovery||!token(data.recovery.pointId)||!token(data.recovery.targetSession)||!integer(data.recovery.journalSequence)||data.recovery.journalSequence>=data.nextSequence||typeof data.recovery.at!=='string'||!Number.isFinite(Date.parse(data.recovery.at))))throw new ServiceError('journal_invalid_file');
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
      const eligible=data.records.filter(r=>r.stream===stream&&r.sequence>p.afterSequence&&this.visible(data,r.sequence)),records:JournalRecord[]=[];let pageBytes=0;
      for(const record of eligible){const size=Buffer.byteLength(JSON.stringify(record));if(records.length>=p.limit||pageBytes+size>JOURNAL_LIMITS.pageBytes)break;records.push(record);pageBytes+=size;}
      return {records,cursor:records.at(-1)?.sequence??p.afterSequence,hasMore:eligible.length>records.length,nextSequence:data.nextSequence,...(data.recovery?{recovery:data.recovery}:{}),bytes,quotaBytes:JOURNAL_LIMITS.bytes};
    }
    if(!p||Object.keys(p).sort().join(',')!=='id,schemaVersion,value'||!token(p.id)||!integer(p.schemaVersion)||!p.schemaVersion||p.schemaVersion>0x7fffffff)throw new ServiceError('journal_invalid_request');
    const text=valueText(p.value),existing=data.records.find(r=>r.stream===stream&&r.id===p.id);
    if(existing){if(existing.schemaVersion!==p.schemaVersion||valueText(existing.value)!==text)throw new ServiceError('journal_id_conflict');await this.syncDirectory(file);return {sequence:existing.sequence,duplicate:true,...(!this.visible(data,existing.sequence)?{superseded:true}:{}),bytes,quotaBytes:JOURNAL_LIMITS.bytes};}
    if(data.records.length>=JOURNAL_LIMITS.records)throw new ServiceError('journal_quota_exceeded');
    const sequence=data.nextSequence++;data.records.push({sequence,stream,id:p.id,schemaVersion:p.schemaVersion,value:JSON.parse(text)});
    const serialized=JSON.stringify(data);const size=Buffer.byteLength(serialized);if(size>JOURNAL_LIMITS.bytes-65536)throw new ServiceError('journal_quota_exceeded');
    await this.publish(file,serialized,guard);return {sequence,duplicate:false,bytes:size,quotaBytes:JOURNAL_LIMITS.bytes};
  }
  private async publish(file:string,serialized:string,guard:()=>void){
    if(Buffer.byteLength(serialized)>JOURNAL_LIMITS.bytes)throw new ServiceError('journal_quota_exceeded');
    const temporary=file+'.'+randomUUID();let published=false;
    try{
      const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(serialized);await output.sync();}finally{await output.close();}
      guard();await fs.rename(temporary,file);published=true;
      await this.syncDirectory(file);

    }catch(error){if(published)throw new ServiceError('journal_durability_uncertain');throw error;}
    finally{await fs.rm(temporary,{force:true});}
  }
}
