import {lstatSync} from 'node:fs';
import type {TextExport,FrameExport,ExportStatus} from './export-contracts.js';
import {randomUUID} from 'node:crypto';
import {publishArtifact} from './artifact-writer.js';
import {ServiceError,type SessionIdentity} from './contracts.js';
import type {ObserverSample} from './observer-contracts.js';
interface Job {status:ExportStatus;token:string;identity:SessionIdentity;owner:string;queue:ObserverSample[];queuedBytes:number;lastSequence:number;nativeSkipped:number;wake?:()=>void;failure?:string;done?:Promise<void>;finishedAt?:number;observerId?:number;stopping?:Promise<unknown>;destination?:{path:string;ino:number;dev:number;size:number;mtimeMs:number;ctimeMs:number;overwrite:boolean}}
export interface ExportHost {
  authorize(token:string,capability:'clipboard.write'|'files.export'|'memory.read'):{pluginId:string;identity:SessionIdentity};
  choose(name:string):Promise<string|undefined>;
  clipboard(text:string):void;
  start(owner:string,identity:SessionIdentity,params:{source:string;args:unknown;every:number;boundary?:'vi'|'vi_origin';timeoutMs:number;maxFrames:number;push:true}):Promise<number>;
  stop(owner:string):Promise<unknown>;
}
/** Single-destination tickets. Native samples go directly to a bounded writer,
 * before renderer coalescing. Loss fails the export instead of claiming completeness. */
export class PluginExports {
  private jobs=new Map<string,Job>();
  constructor(private host:ExportHost){}
  private checkText(text:unknown,max:number){if(typeof text!=='string'||text.length>max||Buffer.byteLength(text)>max)throw new ServiceError('export_size_limit');}
  private name(name:unknown){if(typeof name!=='string'||!name.length||name.length>80||/[\\/\x00-\x1f]/.test(name)||name==='.'||name==='..')throw new ServiceError('invalid_export_name');}
  private target(job:Job,path:string,replace:boolean){
    try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw new ServiceError('export_requires_regular_file');job.destination={path,ino:stat.ino,dev:stat.dev,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,overwrite:replace};return replace;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  }
  private guard(job:Job){const now=this.host.authorize(job.token,'files.export');if(now.identity.session!==job.identity.session||now.identity.epoch!==job.identity.epoch)throw new ServiceError('stale_export_ticket');if(job.status.kind==='frames')this.host.authorize(job.token,'memory.read');if(job.failure)throw new ServiceError(job.failure);if(job.destination?.overwrite){try{const stat=lstatSync(job.destination.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.ino!==job.destination.ino||stat.dev!==job.destination.dev||stat.size!==job.destination.size||stat.mtimeMs!==job.destination.mtimeMs||stat.ctimeMs!==job.destination.ctimeMs)throw new Error();}catch{throw new ServiceError('export_destination_changed');}}}
  private create(token:string,kind:'text'|'frames',gesture:boolean){
    const auth=this.host.authorize(token,'files.export');if(!gesture)throw new ServiceError('user_gesture_required');
    for(const [id,job]of this.jobs)if(job.finishedAt&&Date.now()-job.finishedAt>900000)this.jobs.delete(id);
    const live=[...this.jobs.values()].filter(job=>!job.finishedAt);if(live.length>=2||live.some(job=>job.status.pluginId===auth.pluginId))throw new ServiceError('export_busy');
    while(this.jobs.size>=32){const old=[...this.jobs].find(([,job])=>job.finishedAt);if(!old)throw new ServiceError('export_busy');this.jobs.delete(old[0]);}
    const jobId=randomUUID();const job:Job={status:{jobId,pluginId:auth.pluginId,state:'choosing',kind,frames:0,bytes:0,lost:0},token,identity:{...auth.identity},owner:'export-'+jobId,queue:[],queuedBytes:0,lastSequence:0,nativeSkipped:0};this.jobs.set(jobId,job);return job;
  }
  private stop(job:Job){return job.stopping??=this.host.stop(job.owner).catch(()=>{});}
  private fail(job:Job,error:unknown){job.status.state=job.failure==='export_cancelled'?'cancelled':'failed';job.status.reason=error instanceof ServiceError?error.code:'export_failed';job.finishedAt=Date.now();job.queue=[];job.queuedBytes=0;}
  clipboard(token:string,text:string,gesture:boolean){this.host.authorize(token,'clipboard.write');if(!gesture)throw new ServiceError('user_gesture_required');this.checkText(text,65536);this.host.authorize(token,'clipboard.write');this.host.clipboard(text);return {copied:true,bytes:Buffer.byteLength(text)};}
  async save(token:string,p:TextExport,gesture:boolean){
    if(!p||Object.keys(p).some(k=>!['suggestedName','text','overwrite'].includes(k))||p.overwrite!==undefined&&typeof p.overwrite!=='boolean')throw new ServiceError('invalid_export_request');this.name(p.suggestedName);this.checkText(p.text,1048576);
    const job=this.create(token,'text',gesture);
    try{const destination=await this.host.choose(p.suggestedName);this.guard(job);if(!destination){job.status.state='cancelled';job.status.reason='picker_cancelled';job.finishedAt=Date.now();return {...job.status};}
      job.status.state='finishing';const overwrite=this.target(job,destination,p.overwrite===true);const artifact=await publishArtifact(destination,overwrite,async write=>{await write(p.text);},()=>this.guard(job),1048576);
      job.status.state='committed';job.status.artifact=artifact;job.status.bytes=artifact.bytes;job.finishedAt=Date.now();return {...job.status};
    }catch(error){this.fail(job,error);throw error;}
  }
  async record(token:string,p:FrameExport,gesture:boolean){
    if(!p||Object.keys(p).some(k=>!['suggestedName','source','args','every','boundary','maxFrames','maxBytes','maxSeconds','overwrite'].includes(k)))throw new ServiceError('invalid_export_request');if(p.boundary!==undefined&&!['vi','vi_origin'].includes(p.boundary))throw new ServiceError('invalid_export_boundary');this.name(p.suggestedName);this.checkText(p.source,131072);if(!p.source.length)throw new ServiceError('invalid_export_source');
    try{this.checkText(JSON.stringify(p.args??{}),65536);}catch{throw new ServiceError('invalid_export_args');}
    const maxFrames=p.maxFrames??600,maxBytes=p.maxBytes??8388608,maxSeconds=p.maxSeconds??60,every=p.every??1;
    if(!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>3600||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>16777216||!Number.isFinite(maxSeconds)||maxSeconds<0.1||maxSeconds>600||!Number.isInteger(every)||every<1||every>120||p.overwrite!==undefined&&typeof p.overwrite!=='boolean')throw new ServiceError('invalid_export_limits');
    this.host.authorize(token,'memory.read');const job=this.create(token,'frames',gesture);
    let watchdog:ReturnType<typeof setInterval>|undefined;
    try{
      const destination=await this.host.choose(p.suggestedName);this.guard(job);if(!destination){job.status.state='cancelled';job.status.reason='picker_cancelled';job.finishedAt=Date.now();return {...job.status};}
      const overwrite=this.target(job,destination,p.overwrite===true);const until=Date.now()+maxSeconds*1000;job.status.state='recording';
      watchdog=setInterval(()=>{try{this.guard(job);if(Date.now()>=until){job.status.state='finishing';job.status.reason='seconds_limit';void this.stop(job);job.wake?.();}}catch(error){job.failure=error instanceof ServiceError?error.code:'stale_export_ticket';void this.stop(job);job.wake?.();}},50);
      job.done=publishArtifact(destination,overwrite,async write=>{
        const emit=async(value:unknown)=>{const line=JSON.stringify(value)+'\n';if(job.status.bytes+Buffer.byteLength(line)>maxBytes-512)throw new ServiceError('export_byte_limit');await write(line);job.status.bytes+=Buffer.byteLength(line);};
        await emit({kind:'header',format:'ares-frame-sequence-v1',...job.identity,boundary:p.boundary??'vi',every,maxFrames,maxBytes,maxSeconds,loss_policy:'fail_without_publication'});
        while(job.status.state==='recording'||job.queue.length&&job.status.frames<maxFrames){
          this.guard(job);
          const sample=job.queue.shift();if(!sample){await new Promise<void>(resolve=>{job.wake=resolve;});job.wake=undefined;continue;}
          job.queuedBytes-=Buffer.byteLength(JSON.stringify(sample));
          await emit({kind:'frame',observer_id:sample.observer_id,sequence:sample.sequence,frame:sample.frame_reference,value:sample.value});++job.status.frames;
          if(job.status.frames>=maxFrames){job.status.state='finishing';job.status.reason='frames_limit';void this.stop(job);}
        }
        this.guard(job);await write(JSON.stringify({kind:'summary',frames:job.status.frames,lost:job.status.lost,complete:true,reason:job.status.reason??'stopped'})+'\n');
      },()=>this.guard(job),maxBytes).then(artifact=>{job.status.state='committed';job.status.artifact=artifact;job.status.bytes=artifact.bytes;job.finishedAt=Date.now();},error=>{this.fail(job,error);}).finally(()=>{if(watchdog)clearInterval(watchdog);job.queue=[];job.queuedBytes=0;return this.stop(job).then(()=>{});});
      // Start only after the writer exists. A unique native owner identifies even
      // samples arriving in the same pipe chunk as the start reply.
      const id=await this.host.start(job.owner,job.identity,{source:p.source,args:p.args??{},every,boundary:p.boundary??'vi',timeoutMs:600000,maxFrames:0,push:true});job.observerId=id;
      if(job.finishedAt){await this.stop(job);return {...job.status};}
      return {...job.status};
    }catch(error){job.failure=error instanceof ServiceError?error.code:'export_failed';void this.stop(job);job.wake?.();if(job.done)await job.done;else this.fail(job,error);throw error;}
  }
  observe(sample:ObserverSample){
    const job=[...this.jobs.values()].find(job=>job.owner===sample.owner&&job.status.state==='recording');if(!job)return;
    try{
      this.guard(job);if(sample.session!==job.identity.session||sample.epoch!==job.identity.epoch)throw new ServiceError('stale_export_ticket');
      const lost=Math.max(0,sample.sequence-job.lastSequence-1)+Math.max(0,(sample.native_skipped??0)-job.nativeSkipped);job.status.lost+=lost;job.lastSequence=sample.sequence;job.nativeSkipped=sample.native_skipped??0;
      if(lost)throw new ServiceError('native_sample_loss');if(sample.error)throw new ServiceError('native_observer_failed');
      const bytes=Buffer.byteLength(JSON.stringify(sample));if(job.queue.length>=32||job.queuedBytes+bytes>1048576)throw new ServiceError('export_queue_overflow');
      job.queue.push(sample);job.queuedBytes+=bytes;job.wake?.();
    }catch(error){job.failure=error instanceof ServiceError?error.code:'export_failed';void this.stop(job);job.wake?.();}
  }
  async finish(token:string,id:string,cancel=false){const job=this.jobs.get(id);if(!job||job.token!==token)throw new ServiceError('unknown_export_job');if(!job.finishedAt){this.guard(job);if(cancel)job.failure='export_cancelled';job.status.state='finishing';job.status.reason=cancel?'export_cancelled':'stopped';void this.stop(job);job.wake?.();await job.done;}return {...job.status};}
  list(id?:string){const jobs=[...this.jobs.values()].filter(job=>!id||job.status.jobId===id);if(id&&!jobs.length)throw new ServiceError('unknown_export_job');return jobs.map(job=>({...job.status}));}
  page(params:{job_id?:string;offset?:number;limit?:number}){const offset=params.offset??0,limit=params.limit??8;if(!Number.isInteger(offset)||offset<0||offset>32||!Number.isInteger(limit)||limit<1||limit>8||params.job_id!==undefined&&typeof params.job_id!=='string')throw new ServiceError('invalid_export_page');const jobs=this.list(params.job_id);return {jobs:jobs.slice(offset,offset+limit),next_offset:offset+limit<jobs.length?offset+limit:null};}
  waits(){return [...this.jobs.values()].map(job=>job.status).filter(job=>job.state==='choosing').map(job=>({component:'plugin_export',reason:'save_dialog',job_id:job.jobId,plugin_id:job.pluginId}));}
}
