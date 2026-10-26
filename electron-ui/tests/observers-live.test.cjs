const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {once}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {NativeSessionClient}=require('../dist/services/native-client.js');const {SessionRouter}=require('../dist/services/session-router.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('independent native observers push frozen VI values and stop by handle',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-observers-'),identity={session:'observers',epoch:1};
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--synthetic','--paused','--silent','--save-dir',dir,'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();const closed=once(child,'close');const native=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{});const router=new SessionRouter();router.attach(native);const samples=[];router.onObserverSample=s=>samples.push(s);
 const request=async(method,params,owner='one')=>{const r=await router.request(method,undefined,params,owner);assert(r.ok,JSON.stringify(r));return r.result;};
 try{
  const params={source:'export default({emu,mem})=>({frame:emu.frame,byte:mem.region("Fixture RAM",0,1)[0]})',args:{},timeoutMs:5000,maxFrames:0,every:1,push:true};
  // Use the explicit region ID rather than a platform-specific display name.
  const region=(await request('memory.regions')).regions.find(r=>r.writable);
  params.source=`export default({emu,mem})=>({frame:emu.frame,byte:mem.region(${JSON.stringify(region.id)},0,1)[0]})`;
  const [a,b]=await Promise.all([request('scripts.observe',params),request('scripts.observe',params)]);assert.notEqual(a.observer_id,b.observer_id);
  const denied=await router.request('script.observerStop',undefined,{observerId:a.observer_id},'foreign');assert.equal(denied.error,'stale_observer');
  const ambiguous=await router.request('script.observerRead',undefined,{offset:0,length:1},'one');assert.equal(ambiguous.error,'ambiguous_observer');
  await request('session.resume');for(let i=0;i<100&&!samples.some(s=>s.observer_id===b.observer_id&&s.sequence>=4);i++)await sleep(10);
  await request('session.pause');assert(samples.some(s=>s.observer_id===a.observer_id));assert(samples.some(s=>s.observer_id===b.observer_id));
  for(const sample of samples){assert.equal(sample.error,'');assert.equal(sample.value.frame,sample.frame_reference.vi);assert.equal(sample.frame_reference.native_session,identity.session);}
  const frozen=samples[0].value.byte;await request('memory.write',{region:region.id,offset:0,hex:'ab'});assert.equal(samples[0].value.byte,frozen);
  await request('script.observerStop',{observerId:a.observer_id});const before=samples.filter(s=>s.observer_id===b.observer_id).length;await request('session.resume');await sleep(80);await request('session.pause');assert(samples.filter(s=>s.observer_id===b.observer_id).length>before);
  const bad=await request('scripts.observe',{...params,source:'export default()=>{while(true){}}'},'offender');
  const healthyBefore=samples.filter(s=>s.observer_id===b.observer_id).length;
  await request('session.resume');await sleep(120);await request('session.pause');
  assert(samples.some(s=>s.observer_id===bad.observer_id&&s.error));assert(samples.filter(s=>s.observer_id===b.observer_id).length>healthyBefore);
  await request('script.observerStop',{observerId:b.observer_id});
 }finally{router.detach();child.stdin.end('quit\n');await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
