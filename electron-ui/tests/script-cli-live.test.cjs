const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {once}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {NativeSessionClient}=require('../dist/services/native-client.js');const {SessionRouter}=require('../dist/services/session-router.js');const {LocalServiceHost}=require('../dist/services/local-endpoint.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('direct CLI uses discovery, preserves stdout JSON, writes output and owns SIGINT cancellation',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-script-cli-'),identity={session:'cli-test',epoch:1};
 const nativeProcess=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--synthetic','--paused','--silent','--save-dir',dir,'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});nativeProcess.stdout.resume();nativeProcess.stderr.resume();const closed=once(nativeProcess,'close');
 const native=new NativeSessionClient(nativeProcess.stdin,nativeProcess.stdio[3],identity,()=>{});const router=new SessionRouter();router.attach(native);const host=new LocalServiceHost(router,async p=>p.operation==='script_result'?router.readScriptResult(p):({ready:true}));
 function cli(args,cwd,lease){const child=spawn(process.execPath,[path.resolve(__dirname,'../dist/cli.js'),...args],{cwd,env:{...process.env,ARES_SERVICE_DIR:path.join(dir,'ipc'),ARES_OWNER_LEASE:lease??''}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);return {child,done:once(child,'close').then(([code])=>({code,out,err}))};}
 try{
  await host.listen(path.join(dir,'ipc'));
  const source=path.join(dir,'record.ts');fs.writeFileSync(source,'export default async({args,frames,log})=>{await frames(4);log("hello");return {answer:args.n}}');
  const args=path.join(dir,'args.json'),output=path.join(dir,'output.json');fs.writeFileSync(args,'{"n":42}');
  const r=await cli(['run',source,'--args',args,'--output',output]).done;
  assert.equal(r.code,0,r.err);assert.deepEqual(JSON.parse(r.out),{answer:42});assert.equal(fs.readFileSync(output,'utf8'),r.out);assert.match(r.err,/hello/);
  const retained=await cli(['call','script_result']).done;assert.equal(retained.code,0,retained.err);const retainedPage=JSON.parse(retained.out);assert.deepEqual(JSON.parse(Buffer.from(retainedPage.hex,'hex').toString()),{answer:42});
  const explicit=await cli(['call','script_result','--result_handle',retainedPage.result_handle]).done;assert.equal(explicit.code,0,explicit.err);assert.equal(JSON.parse(explicit.out).sha256,retainedPage.sha256);
  for(let n=0;n<20;n++){const r=await cli(['run','record.ts','--args','args.json'],dir).done;assert.equal(r.code,0,r.err);}
  for(let n=0;n<20;n++){fs.writeFileSync(source,'export default()=>{throw Error("deliberate")}');const r=await cli(['run','record.ts'],dir).done;assert.equal(r.code,1);assert.match(r.err,/deliberate/);}
  const missing=await cli(['run','missing.ts'],dir).done;assert.match(missing.err,/ENOENT/);assert.equal(typeof JSON.parse(missing.err).error,'object');assert.doesNotMatch(missing.err,/write_failed/);
  fs.writeFileSync(source,'export default()=>{ invalid syntax');const broken=await cli(['run','record.ts'],dir).done;assert.match(broken.err,/Build failed/);
  fs.writeFileSync(source,'export default async({frames})=>{await frames(4);return true}');
  const leaseReply=await cli(['call','owner_lease','--action','create','--seconds','2']).done;assert.equal(leaseReply.code,0,leaseReply.err);const lease=JSON.parse(leaseReply.out).lease_id;
  const startVideo=await cli(['call','video_start'],dir,lease).done;assert.equal(startVideo.code,0,startVideo.err);
  const runVideo=await cli(['run','record.ts'],dir,lease).done;assert.equal(runVideo.code,0,runVideo.err);
  const stopVideo=await cli(['call','video_stop','--path',path.join(dir,'leased.avi')],dir,lease).done;assert.equal(stopVideo.code,0,stopVideo.err);assert.equal(JSON.parse(stopVideo.out).frames,4);
  await sleep(2200);const expired=await cli(['call','emu_status'],dir,lease).done;assert.match(expired.err,/owner_lease_expired/);
  fs.writeFileSync(source,'export default async({frames})=>{await frames(200);return true}');const captured=await cli(['run','record.ts','--video','script.avi'],dir).done;assert.equal(captured.code,0,captured.err);const avi=fs.readFileSync(path.join(dir,'script.avi'));assert.equal(avi.toString('ascii',0,4),'RIFF');assert.equal(avi.readUInt32LE(48),200);
  const failedVideo=path.join(dir,'failed.avi');fs.writeFileSync(source,'export default()=>{throw Error("video_failure")}');const rejectedVideo=await cli(['run','record.ts','--video',failedVideo],dir).done;assert.equal(rejectedVideo.code,1);assert(!fs.existsSync(failedVideo));
  const existingVideo=fs.readFileSync(path.join(dir,'script.avi'));fs.writeFileSync(source,'export default async({frames})=>{await frames(1);return true}');const overwriteVideo=await cli(['run','record.ts','--video','script.avi'],dir).done;assert.equal(overwriteVideo.code,0);assert.equal(JSON.parse(overwriteVideo.out),true);assert.match(overwriteVideo.err,/file_exists/);assert.deepEqual(fs.readFileSync(path.join(dir,'script.avi')),existingVideo);
  const abandonedLease=JSON.parse((await cli(['call','owner_lease','--action','create','--seconds','1']).done).out).lease_id;const abandonedStart=await cli(['call','video_start'],dir,abandonedLease).done;assert.equal(abandonedStart.code,0,abandonedStart.err);assert.equal((await native.request('video.record.status')).result.available,true);await sleep(1200);assert.equal((await native.request('video.record.status')).result.available,false,'abandoned durable recording must be revoked at expiry');
  const invalid=await cli(['call','run_frames','--n','-1']).done;assert.equal(invalid.code,1);assert.equal(invalid.out,'');assert.match(invalid.err,/too_small/);
  const failed=await cli(['call','read_memory','--region','missing','--addr','0','--length','1']).done;assert.equal(failed.code,1);assert.equal(failed.out,'');assert.match(failed.err,/unknown_region/);
  fs.writeFileSync(source,'export default({frames})=>frames(1000000)');const interrupt=cli(['run',source,'--video',path.join(dir,'cancelled.avi')]);
  let operation;for(let i=0;i<200;i++){const s=await native.request('session.status');if(s.result?.operation_id){operation=s.result.operation_id;break;}await sleep(5)}assert(operation);
  interrupt.child.kill('SIGINT');const cancelled=await interrupt.done;assert.equal(cancelled.code,130,cancelled.err);assert.equal(cancelled.out,'');assert.match(cancelled.err,/cancelled|script_(?:video_)?interrupted/);assert(!fs.existsSync(path.join(dir,'cancelled.avi')));
  const final=await native.request('execution.status',undefined,{operationId:operation});assert.equal(final.result.state,'done');
  const external=cli(['run',source]);let running;
  for(let i=0;i<200;i++){const s=await native.request('session.status');if(s.result?.operation_id&&s.result.operation_id!==operation){running=s.result.operation_id;break;}await sleep(5)}assert(running);
  const contender=await cli(['run',source]).done;assert.equal(contender.code,1,contender.out);assert.match(contender.err,/busy|reservation/);
  const stillRunning=await native.request('execution.status',undefined,{operationId:running});assert.equal(stillRunning.result.state,'running');
  const reset=await router.request('session.reset');assert(reset.ok,JSON.stringify(reset));
  const interrupted=await external.done;assert.equal(interrupted.code,1,interrupted.out);assert.equal(interrupted.out,'');assert.match(interrupted.err,/epoch|interrupted|stale_script|ownership/);

 }finally{await host.close();router.detach();nativeProcess.stdin.end('quit\n');const timer=setTimeout(()=>nativeProcess.kill('SIGKILL'),1000);await closed;clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true})}
});
