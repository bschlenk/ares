// Explicit private-media benchmark. Measurements are observations, not a speed SLA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {NativeSessionClient}=require('../dist/services/native-client.js'),{SessionRouter}=require('../dist/services/session-router.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function run(mode){
 const romSource=process.env.ARES_PLUGIN_TEST_ROM,stateSource=process.env.ARES_PLUGIN_TEST_STATE;
 assert(romSource&&stateSource,'Set ARES_PLUGIN_TEST_ROM and ARES_PLUGIN_TEST_STATE');
 const before=[hash(romSource),hash(stateSource)];assert.equal(before[0],'2f579751d7ad2824dfd8a6141570306bfaeda1cff40139ba231c30b8591d681c');
 const dir=fs.mkdtempSync('/tmp/ares-feedback-cost-'),rom=path.join(dir,'game.z64'),state=path.join(dir,'game.bs');fs.copyFileSync(romSource,rom);fs.copyFileSync(stateSource,state);fs.writeFileSync(path.join(dir,'settings.bml'),'');
 const identity={session:randomUUID(),epoch:1},host=process.env.ARES_HOST||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host');
 const child=spawn(host,['--rom',rom,'--system','Nintendo 64','--settings',path.join(dir,'settings.bml'),'--paused','--silent','--save-dir',path.join(dir,'saves'),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-8192));const closed=once(child,'close');
 const native=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),router=new SessionRouter();router.attach(native);
 let requests=0,responseBytes=0,sampleBytes=0;const samples=new Map();
 router.onObserverSample=s=>{sampleBytes+=Buffer.byteLength(JSON.stringify(s));const old=samples.get(s.observer_id);if(old)assert(s.sequence>old.last);samples.set(s.observer_id,{count:(old?.count||0)+1,last:s.sequence,first:old?.first??s.frame_reference.vi,vi:s.frame_reference.vi,error:s.error,ref:s.frame_reference});if(!s.error)assert.equal(s.value.vi,s.frame_reference.vi);};
 const request=async(m,p)=>{requests++;const r=await router.request(m,undefined,p,'cost');responseBytes+=Buffer.byteLength(JSON.stringify(r));assert(r.ok,JSON.stringify(r)+' '+stderr);return r.result;};
 try{
  await request('session.status');await request('state.load',{path:state,resume:false,keepOverrides:false});
  if(mode.includes('capture'))await request('n64.capture.control',{rsp:true,rdp:false});
  const observers=[];
  if(mode.includes('observers'))for(const every of [1,2])observers.push(await request('scripts.observe',{source:'export default({emu,mem})=>({vi:emu.frame,ref:emu.info().frame_reference,data:Array.from(mem.bytes(0x80000000,128))})',args:{},timeoutMs:5000,maxFrames:0,every,push:true}));
  const initial=await request('n64.rsp.lastTask'),startStatus=await request('session.status'),startVi=startStatus.frame,startRequests=requests,startBytes=responseBytes;const started=performance.now();
  await request('session.resume');let status;
  do{await sleep(10);status=await request('session.status');if(mode==='task_queries')await request('n64.rsp.lastTask');assert(performance.now()-started<45000,'bounded benchmark deadline');}while(status.frame-startVi<120);
  await request('session.pause');status=await request('session.status');const wall=performance.now()-started,end=await request('n64.rsp.lastTask');
  const observerCosts=[];for(const o of observers){observerCosts.push(await request('script.observerRead',{observerId:o.observer_id,offset:0,length:1}));await request('script.observerStop',{observerId:o.observer_id});}
  let capture=null;if(mode.includes('capture'))capture=await request('n64.capture.transforms',{generation:null,offset:0,limit:1});
  assert.deepEqual([hash(romSource),hash(stateSource)],before);for(const s of samples.values())assert.equal(s.error,'');if(observers.length){assert.equal(samples.size,2);assert(samples.get(observers[0].observer_id).count>=120);assert(samples.get(observers[1].observer_id).count>=60);}
  const result={mode,scope:'ordinary_play_120_vi_minimum_no_video_credits_no_renderer',start_vi:startVi,end_vi:status.frame,epoch:status.epoch??router.identity?.epoch,actual_vis:status.frame-startVi,wall_ms:wall,vi_per_second:(status.frame-startVi)*1000/wall,transport_requests:requests-startRequests,response_bytes:responseBytes-startBytes,pushed_sample_bytes:sampleBytes,observer_samples:[...samples.values()],observer_native_reads:observerCosts.map(p=>({reads:p.native_reads,bytes:p.native_read_bytes,ns:p.native_read_ns})),metadata_snapshot_ns:end.capture_cost.total_ns-initial.capture_cost.total_ns,metadata_snapshot_scope:end.capture_cost.scope,retained_tasks:end.retention,dropped_tasks:end.dropped_tasks,task_id:end.task?.task_id,capture:capture?{generation:capture.generation,retained:capture.retained,truncated:capture.truncated}:null,original_media_unchanged:true};
  console.log(JSON.stringify(result));return result;
 }finally{router.detach();child.stdin.end('quit\n');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{const runs=[];for(const mode of ['metadata_only','task_queries','capture','capture_observers'])runs.push(await run(mode));const report={result:'KIRBY_FEEDBACK_COST_PASS',measured_at:new Date().toISOString(),native_sha256:hash(process.env.ARES_HOST||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),limits:'Always-on metadata is included in every mode. Wall times include pacing/control and are not isolated CPU overhead. No renderer/video-credit cost or generic pixel-authorship claim.',runs};const out=path.resolve(__dirname,'../artifacts/kirby-feedback-cost.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');})().catch(e=>{console.error(e);process.exitCode=1;});
