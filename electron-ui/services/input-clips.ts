import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {ServiceError,type SessionClient,type SessionIdentity} from './contracts.js';
import {validDemonstration,type InputEvent} from './demonstration-contracts.js';
import {publishArtifact} from './artifact-writer.js';
export class InputClips {
 private states=new Map<number,{path:string;sha256:string}>();
 async run(client:SessionClient,identity:SessionIdentity,method:string,p:any,owner:string,current:()=>boolean){
  const deadline=Date.now()+25000;
  const request=async(method:any,params?:any)=>{if(Date.now()>deadline)throw new ServiceError('input_clip_timeout');if(!current())throw new ServiceError('disconnected');const r=await client.request(method,identity,params,owner);if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result as any;};
  if(method==='artifact.inputRequest'){
   await request('session.pause');
   let state:any;if(p.statePath)state=await request('state.save',{path:p.statePath,overwrite:false,metadata:true});
   const {statePath,...params}=p;
   const result=await request('n64.demo.request',{...params,stateHash:state?.sha256??'-'});
   if(state)this.states.set(result.job_id,{path:state.path,sha256:state.sha256});while(this.states.size>8)this.states.delete(this.states.keys().next().value!);
   return result;
  }
  if(method==='artifact.inputExport'){
   const status=await request('n64.demo.status');if(status.state!=='ready'||!status.complete||status.overflow||!status.events)throw new ServiceError('input_clip_incomplete');
   const events:InputEvent[]=[];
   for(let offset=0;offset<status.events;offset+=128){const page=await request('n64.demo.read',{offset,length:128});if(page.status.job_id!==status.job_id||page.status.state!=='ready')throw new ServiceError('stale_input_clip');events.push(...page.events);}
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
