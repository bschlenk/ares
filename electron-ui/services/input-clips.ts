import {buildInfo} from './build-info.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {ServiceError,type SessionClient,type SessionIdentity} from './contracts.js';
import {validDemonstration,type InputEvent} from './demonstration-contracts.js';
import {publishArtifact} from './artifact-writer.js';
export class InputClips {
 private states=new Map<number,{path:string;sha256:string}>();
 private jobs=new Map<number,{owner:string;requester:string;directory:string;state:any;timer?:ReturnType<typeof setInterval>;busy:boolean;artifacts:any;warnings:string[];publication:string}>();
 ownerFor(owner:string){const job=[...this.jobs.values()].at(-1);return job&&(owner===job.requester||owner==='ui')?job.owner:owner;}
 metadata(id:number){const j=this.jobs.get(id);return j?{publication:j.publication,artifacts:j.artifacts,warnings:j.warnings,initial_state:j.state}:{};}
 close(){for(const j of this.jobs.values())clearInterval(j.timer);this.jobs.clear();this.states.clear();}
 async run(client:SessionClient,identity:SessionIdentity,method:string,p:any,owner:string,current:()=>boolean){
  const deadline=Date.now()+25000;
  const requester=owner;
  const request=async(method:any,params?:any)=>{if(Date.now()>deadline)throw new ServiceError('input_clip_timeout');if(!current())throw new ServiceError('disconnected');const r=await client.request(method,identity,params,owner);if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');identity.epoch=r.epoch;return r.result as any;};
  if(method==='artifact.inputRetry'){
   const status=await request('n64.demo.status'),job=this.jobs.get(status.job_id);
   if(!job||![job.owner,job.requester,'ui'].includes(owner))throw new ServiceError('wrong_owner');
   if(job.publication==='failed'){job.publication='waiting';job.warnings=[];}
   return {...status,...this.metadata(status.job_id)};
  }
  if(method==='artifact.inputRequest'){
   if(p.initialStatePath){
    const directory=path.resolve(p.outputDirectory);
    // Reserve an empty directory before any emulator mutation. Never overwrite a recording.
    const status=await request('session.status');
    let scriptPreparation=false;if(status.operation_id!=null){const op=await request('execution.status',{operationId:status.operation_id});scriptPreparation=op.kind==='script'&&op.owner===owner&&status.paused;}if((status.operation_id!=null||status.batch_id!=null)&&!scriptPreparation)throw new ServiceError('busy');
    const existing=await request('n64.demo.status');if(['armed','recording','replaying'].includes(existing.state))throw new ServiceError('busy');
    await request('state.info',{path:p.initialStatePath});
    await fs.mkdir(directory,{mode:0o700});
    const durableOwner='human-'+randomUUID();
    try {
     if(!scriptPreparation)await request('session.pause');
     await request('state.load',{path:p.initialStatePath,resume:false,keepOverrides:false});
     const writes=p.setup??[];
     if(writes.length){const layout=await request('n64.state.layout');for(const w of writes){const address=BigInt(w.address),physical=address&0x1fffffffn;if(!((address<=0x7fffffn)||(address>=0x80000000n&&address<=0x807fffffn)||(address>=0xa0000000n&&address<=0xa07fffffn))||physical+BigInt(w.hex.length/2)>BigInt(layout.size))throw new ServiceError('setup_write_out_of_rdram');}}
     for(const write of writes)await request('n64.memory.write',{address:write.address,hex:write.hex,view:'rdram'});
     const state=await request('state.save',{path:path.join(directory,'initial.state'),overwrite:false,metadata:true});
     if(p.video)await request('video.record.scriptStart',{maxFrames:p.maxFrames,maxBytes:1073741824,fps:60,timeoutMs:3600000,discard:false,source:'framebuffer'});
     const result=await request('n64.demo.request',{maxFrames:p.maxFrames,timeoutMs:p.timeoutMs,waitingMs:p.waitingMs??p.timeoutMs,port:p.port,source:p.source,prompt:p.prompt,stateHash:state.sha256});
     await request('n64.demo.handoff',{owner:durableOwner});owner=durableOwner;
     this.states.set(result.job_id,{path:state.path,sha256:state.sha256});
     const job={owner,requester,directory,state:{path:state.path,sha256:state.sha256},busy:false,artifacts:{} as any,warnings:[] as string[],publication:'waiting',timer:undefined as ReturnType<typeof setInterval>|undefined};
     this.jobs.set(result.job_id,job);
     const jobIdentity={...identity};
     job.timer=setInterval(async()=>{
      if(!current()){clearInterval(job.timer);return;}if(job.busy)return;job.busy=true;
      const call=async(method:any,params?:any)=>{const r=await client.request(method,jobIdentity,params,owner);if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result as any;};
      try {
       const status=await call('n64.demo.status');if(status.job_id!==result.job_id)throw new ServiceError('demo_replaced');
       if(['armed','recording'].includes(status.state))return;
       if(!['waiting'].includes(job.publication))return;
       job.publication='finalizing';
       if(status.state==='ready'){
        if(!job.artifacts.input)job.artifacts.input=await this.run(client,{...jobIdentity},'artifact.inputExport',{path:path.join(directory,'input.json')},owner,current);
        if(p.video&&!job.artifacts.video)try{job.artifacts.video=await call('artifact.videoStop',{path:path.join(directory,'video.avi'),overwrite:false});}catch(e){job.warnings.push('video: '+String(e));}
        const manifest={format:'ares-demonstration',version:1,build:buildInfo(),status,initial_state:job.state,artifacts:job.artifacts,warnings:job.warnings};
        job.artifacts.manifest=await publishArtifact(path.join(directory,'manifest.json'),false,async write=>{await write(JSON.stringify(manifest)+'\n');},()=>{if(!current())throw new ServiceError('disconnected');});
        job.publication='committed';
       }else{job.publication='cancelled';await call('video.record.cancel').catch(()=>{});}
       clearInterval(job.timer);
      }catch(e){job.publication='failed';job.warnings=[String(e)];}
      finally{job.busy=false;}
     },100);job.timer.unref();
     while(this.jobs.size>8){const first=this.jobs.keys().next().value!;clearInterval(this.jobs.get(first)?.timer);this.jobs.delete(first);}
     return {...result,...this.metadata(result.job_id)};
    }catch(e){if(!scriptPreparation)await request('session.pause').catch(()=>{});await request('video.record.cancel').catch(()=>{});throw e;}
   }
   await request('session.pause');
   let state:any;if(p.statePath)state=await request('state.save',{path:p.statePath,overwrite:false,metadata:true});
   const {statePath,initialStatePath,outputDirectory,setup,video,...params}=p;
   const result=await request('n64.demo.request',{...params,stateHash:state?.sha256??'-'});
   if(state)this.states.set(result.job_id,{path:state.path,sha256:state.sha256});while(this.states.size>8)this.states.delete(this.states.keys().next().value!);
   return result;
  }
  if(method==='artifact.inputExport'){
   const status=await request('n64.demo.status');if(status.state!=='ready'||!status.events||!status.duration_frames)throw new ServiceError('input_clip_incomplete');
   const events:InputEvent[]=[];
   for(let offset=0;offset<status.events;offset+=128){const page=await request('n64.demo.read',{offset,length:128});if(page.status.job_id!==status.job_id||page.status.state!=='ready')throw new ServiceError('stale_input_clip');if(page.events.some((e:InputEvent)=>e.frame>=status.duration_frames))throw new ServiceError('input_clip_incomplete');events.push(...page.events.map((e:InputEvent)=>({...e,held:heldButtons(e.buttons)})));}
   const clip={format:'ares-input-clip',version:1,system:'Nintendo 64',status,start_state:this.states.get(status.job_id)??null,events};
   const guard=()=>{if(!current())throw new ServiceError('disconnected');};
   return publishArtifact(p.path,false,async write=>{await write(JSON.stringify(clip)+'\n');const final=await request('n64.demo.read',{offset:status.events,length:1});if(final.status.job_id!==status.job_id||final.status.state!=='ready')throw new ServiceError('stale_input_clip');},guard,24*1024*1024);
  }
  const file=await fs.open(p.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let clip:any;
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>24*1024*1024)throw new ServiceError('input_clip_limit');const bytes=Buffer.alloc(stat.size+1);const read=await file.read(bytes,0,bytes.length,0);const after=await file.stat();if(read.bytesRead!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new ServiceError('input_clip_changed');clip=JSON.parse(bytes.subarray(0,read.bytesRead).toString('utf8'));}finally{await file.close();}
  if(clip?.format!=='ares-input-clip'||clip.version!==1||clip.system!=='Nintendo 64'||!validDemonstration('n64.demo.status',clip.status)||!clip.status.complete||clip.status.overflow||!Array.isArray(clip.events)||clip.events.length<1||clip.events.length>120000||clip.events.length!==clip.status.events||!clip.status.duration_frames)throw new ServiceError('invalid_input_clip');
  let previous=0;
  for(const [i,e]of clip.events.entries()){if(!validDemonstration('n64.demo.read',{status:clip.status,offset:i,events:[e]})||e.sequence!==i||e.frame<previous||e.frame>=clip.status.duration_frames||e.port!==clip.status.port)throw new ServiceError('invalid_input_clip');previous=e.frame;}
  const status=await request('session.status');if(status.game?.sha256&&status.game.sha256!==clip.status.rom_sha256)throw new ServiceError('input_clip_rom_mismatch');
  if(clip.start_state!==null&&(!clip.start_state||typeof clip.start_state.path!=='string'||clip.start_state.path.length>4096||typeof clip.start_state.sha256!=='string'||!/^[a-f0-9]{64}$/.test(clip.start_state.sha256)))throw new ServiceError('invalid_input_clip');
  await request('n64.demo.importBegin',{frames:clip.status.duration_frames,port:clip.status.port,stateHash:clip.status.state_sha256??'-'});
  for(let i=0;i<clip.events.length;i+=32)await request('n64.demo.append',{events:clip.events.slice(i,i+32).map(({frame,port,raw}:InputEvent)=>({frame,port,raw}))});
  const result=await request('n64.demo.importCommit');if(clip.start_state)this.states.set(result.job_id,clip.start_state);return result;
 }
}

const wireButtons:[[string,number],...[string,number][]]=[['a',0x8000],['b',0x4000],['z',0x2000],['start',0x1000],['up',0x800],['down',0x400],['left',0x200],['right',0x100],['l',0x20],['r',0x10],['c_up',8],['c_down',4],['c_left',2],['c_right',1]];
export const heldButtons=(buttons:number)=>wireButtons.filter(([,mask])=>buttons&mask).map(([name])=>name);
