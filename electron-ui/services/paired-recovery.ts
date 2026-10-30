import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ServiceError,type SessionClient,type SessionIdentity,type SessionReply} from './contracts.js';
import {PluginJournals} from '../plugins/journal.js';
import type {RecoveryNamespace,RecoveryPoint,RecoveryStatus} from '../plugins/recovery-contracts.js';
export interface RecoveryAccess extends RecoveryNamespace {journalFile:string}
interface Manifest extends RecoveryPoint {schema:1;pluginId:string;storageVersion:number;configuration:string;paused:boolean;state:{bytes:number;sha256:string};journal:{bytes:number;sha256:string}}
interface Index {schema:1;pointId:string;previousId?:string;gameHash:string;armed:boolean;activeSession:string;restored?:RecoveryStatus['restored']}
const MAX_STATE=64*1024*1024,MAX_JOURNAL=4*1024*1024,MAX_STORE=512*1024*1024;
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const token=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(s);
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const n=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const unwrap=<T>(r:SessionReply<T>):T=>{if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result;};
export class PairedRecovery {
  private busy?:Promise<unknown>;
  private monitors=new Map<string,{timer:ReturnType<typeof setInterval>;intervalMs:number}>();
  private errors=new Map<string,string>();
  private maintenanceErrors=new Map<string,string>();
  constructor(private root:string,private journals:PluginJournals){}
  private key(ns:RecoveryNamespace){if(!/^[A-Za-z0-9_.-]{1,96}$/.test(ns.pluginId)||!n(ns.storageVersion)||ns.storageVersion<1||ns.storageVersion>10000)throw new ServiceError('recovery_invalid_namespace');return `${ns.pluginId}-v${ns.storageVersion}`;}
  private async folder(ns:RecoveryNamespace){await fs.mkdir(this.root,{recursive:true,mode:0o700});if(!(await fs.lstat(this.root)).isDirectory()||(await fs.lstat(this.root)).isSymbolicLink())throw new ServiceError('recovery_invalid_store');const folder=path.join(this.root,this.key(ns));if((await fs.readdir(this.root)).length>=128){try{await fs.stat(folder);}catch{throw new ServiceError('recovery_namespace_limit');}}await fs.mkdir(folder,{recursive:true,mode:0o700});const stat=await fs.lstat(folder);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ServiceError('recovery_invalid_store');return folder;}
  private async read(file:string,max:number){const f=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const s=await f.stat();if(!s.isFile()||s.size>max)throw new ServiceError('recovery_invalid_file');const b=await f.readFile();if(b.length>max)throw new ServiceError('recovery_invalid_file');return b;}finally{await f.close();}}
  private async sync(folder:string){const f=await fs.open(folder,'r');try{await f.sync();}finally{await f.close();}}
  private async write(file:string,bytes:Uint8Array|string){const f=await fs.open(file,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
  private async index(folder:string):Promise<Index|undefined>{try{const i=JSON.parse((await this.read(path.join(folder,'latest.json'),16384)).toString());if(i.schema!==1||!uuid(i.pointId)||(i.previousId!==undefined&&!uuid(i.previousId))||!hash(i.gameHash)||typeof i.armed!=='boolean'||!token(i.activeSession))throw new ServiceError('recovery_invalid_index');return i;}catch(e:any){if(e.code==='ENOENT')return;throw e;}}
  private async publishIndex(folder:string,index:Index,guard:()=>void=()=>{}){const temp=path.join(folder,'.index-'+randomUUID());let renamed=false;try{await this.write(temp,JSON.stringify(index));guard();await fs.rename(temp,path.join(folder,'latest.json'));renamed=true;await this.sync(folder);}catch(e){if(renamed)throw new ServiceError('recovery_durability_uncertain');throw e;}finally{await fs.rm(temp,{force:true});}}
  private async manifest(folder:string,id:string):Promise<Manifest>{if(!uuid(id))throw new ServiceError('recovery_invalid_point');const file=path.join(folder,id);const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ServiceError('recovery_invalid_point');const m=JSON.parse((await this.read(path.join(file,'manifest.json'),16384)).toString()) as Manifest;if(m.schema!==1||m.id!==id||!hash(m.gameHash)||!hash(m.configuration)||!token(m.sourceSession)||!n(m.sourceEpoch)||!m.sourceEpoch||!n(m.frame)||typeof m.frameKind!=='string'||!Number.isFinite(m.capturedAt)||!n(m.journalSequence)||typeof m.paused!=='boolean'||!Number.isFinite(m.captureMs)||!n(m.state?.bytes)||m.state.bytes<=533||m.state.bytes>MAX_STATE||!hash(m.state.sha256)||!n(m.journal?.bytes)||m.journal.bytes>MAX_JOURNAL||!hash(m.journal.sha256))throw new ServiceError('recovery_invalid_manifest');return m;}
  private async clean(folder:string,index?:Index){for(const e of await fs.readdir(folder,{withFileTypes:true})){if(e.isDirectory()&&(uuid(e.name)||/^\.pending-[a-f0-9-]{36}$/.test(e.name))&&e.name!==index?.pointId&&e.name!==index?.previousId)await fs.rm(path.join(folder,e.name),{recursive:true,force:true});else if(e.isFile()&&/^\.index-[a-f0-9-]{36}$/.test(e.name))await fs.rm(path.join(folder,e.name),{force:true});}}
  private async usage(){let bytes=0,files=0;const walk=async(dir:string)=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){if(++files>2048)throw new ServiceError('recovery_store_limit');const file=path.join(dir,e.name);if(e.isSymbolicLink())throw new ServiceError('recovery_invalid_store');if(e.isDirectory())await walk(file);else bytes+=(await fs.stat(file)).size;}};await walk(this.root);return bytes;}
  private exclusive<T>(work:()=>Promise<T>):Promise<T>{if(this.busy)return Promise.reject(new ServiceError('recovery_busy'));const job=work();this.busy=job;return job.finally(()=>{if(this.busy===job)this.busy=undefined;});}
  async idle(){await this.busy?.catch(()=>{});}
  stop(owner:string){const m=this.monitors.get(owner);if(m)clearInterval(m.timer);this.monitors.delete(owner);this.errors.delete(owner);}
  start(owner:string,intervalMs:number,capture:()=>Promise<unknown>){if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>300000)throw new ServiceError('recovery_invalid_interval');this.stop(owner);const timer=setInterval(()=>{void capture().then(()=>this.errors.delete(owner),e=>{this.errors.set(owner,String(e.message??e));if(/stale_plugin_scope|stale_session|stale_epoch|disconnected|recovery_session_changed/.test(String(e)))this.stop(owner);});},intervalMs);timer.unref();this.monitors.set(owner,{timer,intervalMs});}
  async status(ns:RecoveryNamespace,owner:string,identity?:SessionIdentity,frame?:number):Promise<RecoveryStatus>{const folder=await this.folder(ns),i=await this.index(folder),m=i?await this.manifest(folder,i.pointId):undefined,monitor=this.monitors.get(owner);return {monitoring:!!monitor,...(monitor?{intervalMs:monitor.intervalMs}:{}),point:m?this.point(m):null,ageMs:m?Math.max(0,Date.now()-m.capturedAt):null,framesSincePoint:m&&identity?.session===m.sourceSession&&identity.epoch===m.sourceEpoch&&frame!==undefined?Math.max(0,frame-m.frame):null,lastError:this.errors.get(owner)??this.maintenanceErrors.get(this.key(ns)),...(i?.restored?{restored:i.restored}:{})};}
  private point(m:Manifest):RecoveryPoint{const {id,gameHash,sourceSession,sourceEpoch,frame,frameKind,capturedAt,journalSequence,captureMs}=m;return {id,gameHash,sourceSession,sourceEpoch,frame,frameKind,capturedAt,journalSequence,captureMs};}
  async capture(ns:RecoveryAccess,client:SessionClient,identity:SessionIdentity,guard:()=>void):Promise<RecoveryPoint>{return this.exclusive(()=>this.journals.withSnapshot(ns.journalFile,guard,async(journal,journalSequence)=>{
    guard();const folder=await this.folder(ns),previous=await this.index(folder);await this.clean(folder,previous);
    const info=unwrap(await client.request('checkpoint.info',identity)),status=unwrap(await client.request('session.status',identity));if(!info.available)throw new ServiceError('recovery_unavailable');
    // One coordinator per live game; two plugins cannot publish competing views.
    for(const name of await fs.readdir(this.root)){if(name===this.key(ns))continue;const s=await fs.lstat(path.join(this.root,name));if(!s.isDirectory()||s.isSymbolicLink())continue;const other=await this.index(path.join(this.root,name));if(other?.armed&&other.gameHash===info.hash&&other.activeSession===identity.session)throw new ServiceError('recovery_owner_conflict');}
    const snapshot=unwrap(await client.request('checkpoint.capture',identity,{requireIdle:true},'recovery'));
    try{
      const state=Buffer.alloc(snapshot.stateBytes);for(let offset=0;offset<state.length;){guard();const length=Math.min(16384,state.length-offset),page=unwrap(await client.request('checkpoint.read',identity,{id:snapshot.id,offset,length},'recovery')),b=Buffer.from(page.hex,'hex');if(b.length!==length)throw new ServiceError('invalid_reply');b.copy(state,offset);offset+=length;}
      const id=randomUUID(),manifest:Manifest={schema:1,pluginId:ns.pluginId,storageVersion:ns.storageVersion,id,gameHash:info.hash,configuration:info.configuration,sourceSession:identity.session,sourceEpoch:identity.epoch,frame:snapshot.start_frame??status.frame??0,frameKind:status.frame_kind??'unavailable',capturedAt:snapshot.capturedAt,journalSequence,captureMs:snapshot.capture_ms??0,paused:snapshot.paused??status.paused,state:{bytes:state.length,sha256:digest(state)},journal:{bytes:journal.length,sha256:digest(journal)}};
      if(await this.usage()+state.length+journal.length+16384>MAX_STORE)throw new ServiceError('recovery_quota_exceeded');
      const temp=path.join(folder,'.pending-'+id);await fs.mkdir(temp,{mode:0o700});let moved=false;
      try{await this.write(path.join(temp,'state.bin'),state);await this.write(path.join(temp,'journal.json'),journal);await this.write(path.join(temp,'manifest.json'),JSON.stringify(manifest));await this.sync(temp);guard();await fs.rename(temp,path.join(folder,id));moved=true;await this.sync(folder);await this.publishIndex(folder,{schema:1,pointId:id,...(previous?{previousId:previous.pointId}:{}),gameHash:info.hash,armed:true,activeSession:identity.session,...(previous?.restored?{restored:previous.restored}:{})},guard);this.maintenanceErrors.delete(this.key(ns));await this.clean(folder,await this.index(folder)).catch(e=>this.maintenanceErrors.set(this.key(ns),'recovery_retention_failed: '+String(e)));return this.point(manifest);}finally{if(!moved)await fs.rm(temp,{recursive:true,force:true});}
    }finally{await client.request('checkpoint.release',identity,{id:snapshot.id},'recovery').catch(()=>{});}
  }));}
  async disarmGame(gameHash:string){await this.idle();await fs.mkdir(this.root,{recursive:true,mode:0o700});const rootStat=await fs.lstat(this.root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new ServiceError('recovery_invalid_store');for(const e of await fs.readdir(this.root,{withFileTypes:true})){if(!e.isDirectory())continue;const folder=path.join(this.root,e.name),index=await this.index(folder);if(index?.gameHash===gameHash&&index.armed)await this.publishIndex(folder,{...index,armed:false});}}
  /** Called only during host startup, before plugins receive a session. */
  async restoreStartup(allowed:RecoveryAccess[],client:SessionClient,identity:SessionIdentity):Promise<{restored:boolean;paused?:boolean}>{return this.exclusive(async()=>{
    const info=unwrap(await client.request('checkpoint.info',identity));if(!info.available)return {restored:false};
    const candidates:{access:RecoveryAccess;folder:string;index:Index;m:Manifest}[]=[];
    for(const access of allowed){const folder=await this.folder(access),index=await this.index(folder);await this.clean(folder,index);if(!index?.armed||index.gameHash!==info.hash||index.activeSession===identity.session)continue;const m=await this.manifest(folder,index.pointId);if(m.gameHash!==index.gameHash)throw new ServiceError('recovery_game_mismatch');if(m.pluginId!==access.pluginId||m.storageVersion!==access.storageVersion)throw new ServiceError('recovery_namespace_mismatch');candidates.push({access,folder,index,m});}
    candidates.sort((a,b)=>b.m.capturedAt-a.m.capturedAt);const c=candidates[0];if(!c)return {restored:false};
    if(c.m.configuration!==info.configuration)throw new ServiceError('recovery_configuration_mismatch');
    const state=await this.read(path.join(c.folder,c.m.id,'state.bin'),MAX_STATE),journal=await this.read(path.join(c.folder,c.m.id,'journal.json'),MAX_JOURNAL);
    if(state.length!==c.m.state.bytes||digest(state)!==c.m.state.sha256||journal.length!==c.m.journal.bytes||digest(journal)!==c.m.journal.sha256)throw new ServiceError('recovery_integrity_failed');
    const frozen=JSON.parse(journal.toString());if(frozen.nextSequence-1!==c.m.journalSequence)throw new ServiceError('recovery_journal_mismatch');
    await this.journals.verifyRecovery(c.access.journalFile,journal);
    // Mark the target before touching RAM. A second crash retries this same pair.
    await this.publishIndex(c.folder,{...c.index,activeSession:identity.session});
    const upload=unwrap(await client.request('checkpoint.upload',identity,{bytes:state.length,recovery:true},'recovery'));
    try{
      for(let offset=0;offset<state.length;offset+=1800)unwrap(await client.request('checkpoint.write',identity,{id:upload.id,offset,hex:state.subarray(offset,offset+1800).toString('hex')},'recovery'));
      unwrap(await client.request('checkpoint.commit',identity,{id:upload.id,resume:false},'recovery'));
      await this.journals.applyRecovery(c.access.journalFile,journal,c.m.id,identity.session,()=>{});
      await this.publishIndex(c.folder,{...c.index,activeSession:identity.session,restored:{pointId:c.m.id,journalSequence:c.m.journalSequence,targetSession:identity.session,at:Date.now()}});
      return {restored:true,paused:c.m.paused};
    }finally{await client.request('checkpoint.abort',undefined,{id:upload.id},'recovery').catch(()=>{});}
  });}
}
