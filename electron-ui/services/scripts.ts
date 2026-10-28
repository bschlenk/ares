import { ScriptResults } from './script-results.js';
import { constants } from 'node:fs';
import { publishArtifact } from './artifact-writer.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { ServiceError, type SessionIdentity, type ExecutionOperation } from './contracts.js';
import type { NativeSessionClient } from './native-client.js';
import type { ScriptRunParams } from './script-contracts.js';

const bootstrap = `
const aligned=(a,n)=>typeof a==='number'?a%n:BigInt(a)%BigInt(n);
const mem={writeHex:(a,hex,v='cpu')=>{if(typeof hex!=='string'||!/^(?:[0-9a-f]{2}){1,1024}$/i.test(hex))throw Error('invalid_hex');__write(a,Uint8Array.from(hex.match(/../g),b=>parseInt(b,16)).buffer,v)},region:(name,offset,length)=>new Uint8Array(__region(name,offset,length)),bytes:(a,n,v='cpu')=>new Uint8Array(__read(a,n,v)),hex:(a,n,v='cpu')=>Array.from(new Uint8Array(__read(a,n,v)),b=>b.toString(16).padStart(2,'0')).join(''),writeBytes:(a,b,v='cpu')=>__write(a,new Uint8Array(b).buffer,v)};
for(const [type,width,get,set] of [['u8',1,'getUint8','setUint8'],['i8',1,'getInt8','setInt8'],['u16',2,'getUint16','setUint16'],['i16',2,'getInt16','setInt16'],['u32',4,'getUint32','setUint32'],['i32',4,'getInt32','setInt32'],['u64',8,'getBigUint64','setBigUint64'],['i64',8,'getBigInt64','setBigInt64'],['f32',4,'getFloat32','setFloat32'],['f64',8,'getFloat64','setFloat64']]){
  mem[type]=(a,v='cpu')=>{if(aligned(a,width)!=0)throw Error('unaligned_address');return new DataView(__read(a,width,v))[get](0,false)};
  mem['write'+type[0].toUpperCase()+type.slice(1)]=(a,value,v='cpu')=>{if(aligned(a,width)!=0)throw Error('unaligned_address');const b=new ArrayBuffer(width);new DataView(b)[set](0,value,false);__write(a,b,v)};
}
const input=(state={})=>{const names=['a','b','z','start','up','down','left','right','c_up','c_down','c_left','c_right','l','r'];return __input(state.port??1,names.reduce((m,k,i)=>m|(state[k]?1<<i:0),0),state.x??0,state.y??0)};
input.set=(port,state={},stick={})=>input({...state,...stick,port});
const demoHex=text=>Array.from(unescape(encodeURIComponent(text)),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')||'-';
input.demonstration=Object.freeze({prepare:p=>__host('input_prepare',JSON.stringify(p)),request:(p={})=>__demo('request',[(p.maxFrames??600),(p.timeoutMs??300000),(p.port??1),(p.source??'human'),demoHex(p.prompt??'Please demonstrate the action.'),'-'].join(' ')),status:()=>__demo('status',''),start:()=>__demo('start',''),stop:()=>__demo('stop',''),cancel:()=>__demo('cancel',''),replay:()=>__demo('replay',''),export:path=>__host('input_export',path),import:path=>__host('input_import',path)});
for(const n of [8,16,32,64]){mem['s'+n]=mem['i'+n];mem['writeS'+n]=mem['writeI'+n]}
let seed=1;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};globalThis.Date=undefined;
`;

/** Bundle once with a confined file loader. No project configuration or plugins run. */
let preparations = 0;
export async function prepareScript(p: ScriptRunParams, observe=false) {
  if(preparations>=2)throw new ServiceError('busy');
  ++preparations;
  try{return await bundleScript(p,observe);}finally{--preparations;}
}
async function bundleScript(p: ScriptRunParams, observe=false) {
  const entry = p.path ? await fs.realpath(path.resolve(p.path)) : undefined;
  const root = p.projectRoot ? path.resolve(p.projectRoot) : entry ? path.dirname(entry) : undefined;
  if(root && await fs.realpath(root)!==root)throw new ServiceError('script_import_escape');
  if(entry && (!root || !entry.startsWith(root+path.sep) || !(await fs.stat(entry)).isFile()))throw new ServiceError('script_import_type');
  let bytes = 0, count = 0;
  const hashes: Record<string,string> = {};
  const output = await build({
    ...(entry ? {entryPoints:[entry]} : {stdin:{contents:p.source!,sourcefile:'inline.ts',loader:'ts',...(root?{resolveDir:root}:{})}}),
    tsconfigRaw:{compilerOptions:{}},bundle:true,write:false,platform:'neutral',format:'iife',globalName:'__aresModule',target:'es2020',logLevel:'silent',
    plugins:[{name:'confined-script',setup(b){
      b.onResolve({filter:/.*/},async args=>{
        if(!root || (!args.kind.startsWith('entry') && !args.path.startsWith('.')))throw new Error('script_import_denied');
        const base=path.resolve(args.resolveDir,args.path);
        if(base!==root&&!base.startsWith(root+path.sep))throw new Error('script_import_escape');
        const candidates=path.extname(base)?[base,...(base.endsWith('.js')?[base.slice(0,-3)+'.ts']:[])]:[base+'.ts',base+'.mts',base+'.js',base+'.mjs',base+'.json',path.join(base,'index.ts'),path.join(base,'index.js')];
        for(const candidate of candidates){
          let real:string;
          try{real=await fs.realpath(candidate);}catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))continue;throw error;}
          if(!real.startsWith(root+path.sep))throw new Error('script_import_escape');
          if(!(await fs.stat(real)).isFile())throw new Error('script_import_type');
          return {path:real};
        }
        throw new Error('script_import_not_found');
      });
      b.onLoad({filter:/.*/},async args=>{
        if(++count>64)throw new Error('script_import_limit');
        const real=await fs.realpath(args.path);
        if(!root || !real.startsWith(root+path.sep))throw new Error('script_import_escape');
        const file=await fs.open(real,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
        let contents:Buffer;
        try {
          const before=await file.stat();
          if(!before.isFile()||before.size>131072-bytes)throw new Error('script_source_limit');
          const buffer=Buffer.alloc(before.size+1),read=await file.read(buffer,0,buffer.length,0),after=await file.stat();
          const pinned=await fs.realpath(args.path),named=await fs.stat(pinned);
          if(!pinned.startsWith(root+path.sep)||named.ino!==before.ino||named.dev!==before.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||read.bytesRead!==before.size)throw new Error('script_module_changed');
          contents=buffer.subarray(0,read.bytesRead);
        } finally {await file.close();}
        bytes+=contents.length;if(bytes>131072)throw new Error('script_source_limit');
        hashes[path.relative(root!,args.path)]=createHash('sha256').update(contents).digest('hex');
        const ext=path.extname(args.path);if(!['.js','.mjs','.ts','.mts','.json'].includes(ext))throw new Error('script_import_type');
        return {contents:contents.toString('utf8'),loader:['.ts','.mts'].includes(ext)?'ts':ext==='.json'?'json':'js'};
      });
    }}]
  });
  const bundled=output.outputFiles[0].text;
  if(/(^|[^.$\w])import\s*\(/.test(bundled))throw new ServiceError('script_dynamic_import_denied');
  const args=JSON.stringify(p.args);
  const source=bootstrap+bundled+`\n${observe?'(()=>':'Promise.resolve().then(()=>'}__aresModule.default({args:${args},emu:Object.freeze({get frame(){return __info().frame},info:__info,loadState:path=>__host('state_load',path),saveState:path=>__host('state_save',path),screenshot:path=>__host('screenshot',path)}),mem,input,frames:__frames,cpu:Object.freeze({onExecute:(address,callback)=>{const id=__hook(address,r=>{Object.freeze(r.gpr);Object.freeze(r.cop0);Object.freeze(r.fpr);return callback(Object.freeze(r))});return ()=>__unhook(id)}}),log:(...v)=>__log(JSON.stringify(v))}));`;
  if(Buffer.byteLength(source)>262144)throw new ServiceError('script_source_limit');
  return {source,hashes,sha256:createHash('sha256').update(source).digest('hex')};
}
export async function startScript(client:NativeSessionClient,identity:SessionIdentity,p:ScriptRunParams,owner:string,current:()=>boolean,observe=false):Promise<any> {
  const prepared=await prepareScript(p,observe);
  const guard=()=>{if(!current())throw new ServiceError('disconnected');if(client.identity.session!==identity.session||client.identity.epoch!==identity.epoch)throw new ServiceError('stale_epoch');};
  const request=async(method:any,params:any)=>{guard();const r=await client.request(observe?method.replace('script.prepare','script.observerPrepare').replace('script.write','script.observerWrite').replace('script.start','script.observerStart'):method,identity,params,owner);if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result as any;};
  const data=Buffer.from(prepared.source);
  await request('script.prepare',{bytes:data.length});
  const status=await request('session.status',undefined);
  const config=await request('runtime.settings',undefined);
  for(let offset=0;offset<data.length;offset+=1024)await request('script.write',{hex:data.subarray(offset,offset+1024).toString('hex')});
  const op=await request('script.start',{timeoutMs:p.timeoutMs,maxFrames:p.maxFrames,...(observe?{every:p.every??4,boundary:p.boundary??'vi',push:p.push??false}:{})});
  return {...op,script_metadata:{rom_sha256:status.game?.sha256??null,runtime_settings_sha256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),source_sha256:prepared.sha256,module_sha256:prepared.hashes,args_sha256:createHash('sha256').update(JSON.stringify(p.args)).digest('hex')}};
}

/** File work runs in main; the native job retains the reservation while suspended. */
export class ScriptJobs {
  constructor(private diagnose:(error:unknown)=>void=()=>{}){}
  readonly results = new ScriptResults();
  private generation=0;
  readonly publications = new Map<number, Record<string,unknown>>();
  readonly lineages = new Map<number, {session:string;epochs:number[]}>();
  metadata(id:number) { const lineage=this.lineages.get(id);return {...(lineage?{script_lineage:lineage}:{}),...(this.publications.has(id)?{script_result:this.publications.get(id)}:{})}; }
  readonly outputs = new Map<number, Record<string, unknown>>();
  private jobs = new Map<string, { cancelled: boolean; id?: number }>();
  async readResult(params:any,scope?:SessionIdentity) {
    const until=Date.now()+2000;
    for(;;){
      const entries=[...this.publications].filter(([id,p])=>params.handle?p.result_handle===params.handle:scope?.session===this.lineages.get(id)?.session&&(!params.operation_id||id===params.operation_id));
      const pending=entries.at(-1)?.[1];
      if(pending?.state!=='pending')return this.results.read(params,scope);
      if(Date.now()>=until)throw new ServiceError('script_result_pending');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  release(owner:string) { const job=this.jobs.get(owner);if(job)job.cancelled=true; }
  close() { ++this.generation;for(const job of this.jobs.values())job.cancelled=true;this.jobs.clear();this.outputs.clear();this.lineages.clear(); }
  async start(client:NativeSessionClient,invoke:import('./contracts.js').SessionClient,identity:SessionIdentity,p:ScriptRunParams,owner:string,current:()=>boolean) {
    const generation=this.generation;
    const previous=this.jobs.get(owner);
    if(previous){
      if(!previous.id||this.outputs.get(previous.id)?.state==='pending')throw new ServiceError('busy');
      const status=await client.request('execution.status',client.identity,{operationId:previous.id},owner);
      if(!status.ok||status.result?.state!=='done')throw new ServiceError('busy');
      previous.cancelled=true;
    }
    const handle=this.results.reserve();
    const job:{cancelled:boolean;id?:number}={cancelled:false};this.jobs.set(owner,job);
    try {
      if(p.videoPath){
        const paused=await client.request('session.pause',identity,undefined,owner);if(!paused.ok)throw new ServiceError(paused.error!);
        const video=await client.request('video.record.scriptStart',identity,{maxFrames:36000,maxBytes:1073741824,source:p.videoSource??'framebuffer',fps:60,timeoutMs:p.timeoutMs,discard:false},owner);if(!video.ok)throw new ServiceError(video.error!);
      }
      const op=await startScript(client,identity,p,owner,()=>current()&&!job.cancelled);job.id=op.operation_id;
      this.publications.set(op.operation_id,{state:'pending',result_handle:handle});
      while(this.publications.size>32)this.publications.delete(this.publications.keys().next().value!);
      this.lineages.set(op.operation_id,{session:identity.session,epochs:[identity.epoch]});
      while(this.lineages.size>32)this.lineages.delete(this.lineages.keys().next().value!);
      if(generation!==this.generation){await client.request('execution.cancel',client.identity,{operationId:op.operation_id},owner).catch(()=>{});throw new ServiceError('native_host_disconnected');}
      if(p.outputPath||p.videoPath)this.outputs.set(op.operation_id,{state:'pending',path:path.resolve(p.outputPath??p.videoPath!)});
      while(this.outputs.size>32)this.outputs.delete(this.outputs.keys().next().value!);
      void this.drive(client,invoke,op.operation_id,p,owner,current,generation,handle,()=>current()&&!job.cancelled).finally(()=>{this.results.abort(handle);if(this.jobs.get(owner)===job)this.jobs.delete(owner);});
      return {...op,result_handle:handle,...this.metadata(op.operation_id)};
    } catch(error){if(p.videoPath)await client.request('video.record.cancel',client.identity,undefined,owner).catch(()=>{});this.results.abort(handle);if(this.jobs.get(owner)===job)this.jobs.delete(owner);throw error;}
  }
  private async drive(client:NativeSessionClient,invoke:import('./contracts.js').SessionClient,id:number,p:ScriptRunParams,owner:string,current:()=>boolean,generation:number,handle:string,executionCurrent:()=>boolean) {
    const resolveFile=(v:string)=>path.resolve(p.fileBase??process.cwd(),v);
    const inputs=new Set((p.statePaths??[]).map(resolveFile)),outputs=new Set((p.outputPaths??[]).map(resolveFile));
    const pending=async()=>{
      if(!current()||!executionCurrent())throw new ServiceError('script_interrupted');
      const r=await client.request('script.pending',client.identity,undefined,owner);
      if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result;
    };
    try {
      while(current()) {
        const completed=await client.request('execution.status',client.identity,{operationId:id},owner);
        const ticket=!completed.ok?await client.request('script.read',client.identity,{offset:0,length:16384,operationId:id},owner):undefined;
        if(!completed.ok&&!(ticket?.ok&&(ticket.result as any)?.complete))throw new ServiceError(completed.error??'invalid_reply');
        if(completed.result?.state==='done'||(ticket?.result as any)?.complete){
          const chunks:Buffer[]=[];let offset=0,page:any;
          do {
            const reply=await client.request('script.read',client.identity,{offset,length:16384,operationId:id},owner);
            if(!reply.ok||!reply.result)throw new ServiceError(reply.error??'invalid_reply');
            page=reply.result;const bytes=Buffer.from(page.hex,'hex');if(!bytes.length&&offset<page.bytes)throw new ServiceError('invalid_result_page');
            chunks.push(bytes);offset+=bytes.length;
          }while(offset<page.bytes);
          const data=Buffer.concat(chunks);
          const resultIdentity={session:this.lineages.get(id)?.session??client.identity.session,epoch:page.result_epoch??client.identity.epoch};
          this.results.publish(handle,id,resultIdentity,data,page);
          this.publications.set(id,{state:'committed',result_handle:handle});
          await client.request('script.ack',client.identity,{operationId:id},owner);
          if(p.outputPath){
            if((page.stop_reason??completed.result?.stop_reason)!=='script_done')throw new ServiceError('script_output_interrupted');
            const identity=resultIdentity;
            const guard=()=>{if(!current()||!executionCurrent()||client.identity.session!==identity.session||client.identity.epoch!==identity.epoch)throw new ServiceError('script_output_interrupted');};
            const {artifactGuard}=await import('./artifact-guard.js');
            const artifact=await artifactGuard.run(async()=>{guard();},()=>publishArtifact(p.outputPath!,false,async write=>{await write(data);await write('\n');},guard));
            if(generation===this.generation)this.outputs.set(id,{state:p.videoPath?'pending':'committed',...artifact});
          }
          if(p.videoPath){
            if((page.stop_reason??completed.result?.stop_reason)!=='script_done')throw new ServiceError('script_video_interrupted');
            const status=await client.request('video.record.status',client.identity,undefined,owner);
            if(!status.ok||!status.result||!status.result.frames)throw new ServiceError('script_video_empty: '+(status.result?.stop_reason??status.error));
            const saved=await invoke.request('artifact.videoStop',client.identity,{path:p.videoPath,overwrite:false},owner);
            if(!saved.ok)throw new ServiceError(saved.error!);
            if(generation===this.generation)this.outputs.set(id,{...this.outputs.get(id),state:'committed',video:saved.result,video_complete:status.result.active,warnings:status.result.active?[]:['Video stopped early: '+status.result.stop_reason]});
          }
          return;
        }
        const work=(await pending()).pending;
        if(work) {
          let ok=true,value:unknown;
          try {
            let preparation:any;if(work.kind==='input_prepare'){preparation=JSON.parse(work.path);if(!inputs.has(resolveFile(preparation.initialStatePath))||!outputs.has(resolveFile(preparation.outputDirectory)))throw new ServiceError('script_file_capability_denied');preparation={...preparation,initialStatePath:resolveFile(preparation.initialStatePath),outputDirectory:resolveFile(preparation.outputDirectory)};}
            if(work.kind!=='input_prepare'&&(typeof work.path!=='string'||!((work.kind==='state_load'||work.kind==='input_import')?inputs:outputs).has(resolveFile(work.path))))throw new ServiceError('script_file_capability_denied');
            const revalidate=async()=>{const state=await pending();if(!state.running||state.pending?.id!==work.id)throw new ServiceError('script_interrupted');};
            const {artifactGuard}=await import('./artifact-guard.js');
            const reply=await artifactGuard.run(revalidate,()=>work.kind==='input_prepare'?invoke.request('artifact.inputRequest',client.identity,{maxFrames:3600,timeoutMs:300000,port:1,source:'human',prompt:'Please demonstrate the action.',...preparation},owner):work.kind==='input_export'?invoke.request('artifact.inputExport',client.identity,{path:resolveFile(work.path)},owner):work.kind==='input_import'?invoke.request('artifact.inputImport',client.identity,{path:resolveFile(work.path)},owner):work.kind==='state_load'?
              invoke.request('state.load',client.identity,{path:resolveFile(work.path),resume:false,keepOverrides:false},owner):work.kind==='state_save'?
              invoke.request('state.save',client.identity,{path:resolveFile(work.path),overwrite:false,metadata:true},owner):
              invoke.request('artifact.screenshot',client.identity,{path:resolveFile(work.path),inline:false,overwrite:false,source:'framebuffer',region:null,scale:1},owner));
            if(!reply.ok)throw new ServiceError(reply.error??'script_host_work_failed');
            if(work.kind==='state_load'||work.kind==='input_prepare') {
              const lineage=this.lineages.get(id);
              if(lineage&&lineage.session===reply.session&&!lineage.epochs.includes(reply.epoch))lineage.epochs.push(reply.epoch);
            }
            // Native replies carry the new epoch following an intentional load.
            value={...(work.kind==='input_prepare'?{job_id:(reply.result as any)?.job_id,state:(reply.result as any)?.state}:{}),epoch:reply.epoch,committed:true,...(work.kind==='state_load'?{state_sha256:(reply.result as any)?.state_sha256}:{})};
          } catch(error){if(!(error instanceof ServiceError))this.diagnose(error);ok=false;value=error instanceof Error?error.message:String(error);}
          const reply=await client.request('script.resolve',client.identity,{id:work.id,ok,hex:Buffer.from(JSON.stringify(value)).toString('hex')},owner);
          if(!reply.ok)throw new ServiceError(reply.error??'script_interrupted');
        } else await new Promise(resolve=>setTimeout(resolve,10));
      }
    } catch(error) {
      if(!(error instanceof ServiceError))this.diagnose(error);
      if(p.videoPath)await client.request('video.record.cancel',client.identity,undefined,owner).catch(()=>{});
      this.results.abort(handle);
      if(this.publications.get(id)?.state!=='committed')this.publications.set(id,{state:'failed',result_handle:handle,error:error instanceof Error?error.message:String(error)});
      if((p.outputPath||p.videoPath)&&generation===this.generation)this.outputs.set(id,{state:'failed',error:error instanceof Error?error.message:String(error)});
      await client.request('execution.cancel',client.identity,{operationId:id},owner).catch(()=>{});
    }
  }
}
