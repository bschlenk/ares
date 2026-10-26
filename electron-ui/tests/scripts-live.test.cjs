const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {once}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {NativeSessionClient}=require('../dist/services/native-client.js');
const {SessionRouter}=require('../dist/services/session-router.js');
const {prepareScript}=require('../dist/services/scripts.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('confined TS module graphs reject node, remote, parent and symlink escapes',async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-script-modules-');
 try{
  fs.writeFileSync(path.join(dir,'decoder.ts'),'export const decode=(n:number)=>n+1;');
  fs.writeFileSync(path.join(dir,'main.ts'),"import {decode} from './decoder';export default ({args})=>decode(args.n)");
  const p={path:path.join(dir,'main.ts'),args:{n:1},timeoutMs:1000,maxFrames:0};
  const built=await prepareScript(p);assert.equal(Object.keys(built.hashes).length,2);
  const nested=path.join(dir,'scripts');fs.mkdirSync(nested);fs.writeFileSync(path.join(nested,'record.ts'),"import {decode} from '../decoder';export default()=>decode(1)");
  const project=await prepareScript({...p,path:path.join(nested,'record.ts'),projectRoot:fs.realpathSync(dir)});assert.equal(Object.keys(project.hashes).length,2);
  await assert.rejects(prepareScript({...p,projectRoot:fs.realpathSync(nested)}));

  for(const spec of ['node:fs','https://example.com/a.js','../escape.js']){
   fs.writeFileSync(path.join(dir,'main.ts'),`import x from '${spec}';export default()=>x;`);await assert.rejects(prepareScript(p));
  }
  fs.symlinkSync('/etc/passwd',path.join(dir,'escape.js'));
  fs.writeFileSync(path.join(dir,'main.ts'),"import x from './escape.js';export default()=>x");await assert.rejects(prepareScript(p));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('native script VI waits, zero frames, promise storm, OOM, loops and cleanup', {timeout:30000}, async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-script-native-'),identity={session:'script-test',epoch:1};
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--synthetic','--paused','--silent','--save-dir',dir,'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();let stderr='';child.stderr.on('data',b=>stderr+=b);const closed=once(child,'close');const native=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{},3000);const router=new SessionRouter();router.attach(native);
 const request=async(method,p)=>{if(process.env.SCRIPT_DEBUG)console.error('request',method);const r=await router.request(method,undefined,p,'script-owner');assert(r.ok,`${method}: ${r.error} ${stderr}`);return r.result};
 async function run(source,args={},maxFrames=1000){
  const started=await request('scripts.run',{source,args,timeoutMs:1000,maxFrames});let op=started;
  for(let i=0;op.state==='running'&&i<300;i++){await sleep(5);op=await request('execution.status',{operationId:started.operation_id})}
  assert.equal(op.state,'done',JSON.stringify(op));
  const result=await request('script.read',{offset:0,length:16384});
  assert.equal((await request('session.status')).paused,true);
  return {op,result,value:result.bytes?JSON.parse(Buffer.from(result.hex,'hex').toString()):undefined};
 }
 try{
  const good=await run('export default async({args,frames,log})=>{await frames(0);await frames(args.n);log("ok");return {n:args.n,clock:typeof Date}}',{n:200});
  assert.equal(good.op.stop_reason,'script_done');assert.equal(good.op.elapsed_frames,200);assert.deepEqual(good.value,{n:200,clock:'undefined'});
  for(const source of [
   'export default()=>{while(true){}}',
   'export default async()=>{while(true)await Promise.resolve()}',
   'export default()=>{const a=[];for(;;)a.push(new Uint8Array(1024*1024))}',
   'export default()=>new Promise(()=>{})',
   'export default({frames})=>Promise.all([frames(1),frames(1)])',
   'export default()=>1n',
   'export default({emu})=>emu.saveState()',
   'export default()=>({toJSON(){while(true){}}})',
   'export default()=>"x".repeat(5*1024*1024)',
   'export default()=>{throw "abc"+"😀".repeat(2000)}',
   'export default()=>{for(let i=0;i<8;i++)__log(String.fromCharCode(1).repeat(4096));return 1}'
  ]){const failed=await run(source);assert.equal(failed.op.stop_reason,'script_failed',JSON.stringify(failed));assert(failed.result.error);assert(Buffer.byteLength(failed.result.error)<=4096);assert(Buffer.byteLength(JSON.stringify(failed.result.logs))<=16384);const status=await request('session.status');assert.equal(status.batch_id,null);}
  const bounded=await run('export default({frames})=>frames(2)',{},1);assert.equal(bounded.op.stop_reason,'script_failed');
  const cancellable=await request('scripts.run',{source:'export default async({frames})=>{await frames(1000000)}',args:{},timeoutMs:10000,maxFrames:1000000});
  const foreign=await router.request('scripts.run',undefined,{source:'export default()=>1',args:{},timeoutMs:1000,maxFrames:0},'foreign');assert.equal(foreign.error,'busy');
  const cancelled=await request('execution.cancel',{operationId:cancellable.operation_id});assert.equal(cancelled.stop_reason,'cancelled');
  await sleep(20);assert.equal((await request('session.status')).batch_id,null);
  const again=await run('export default()=>42');assert.equal(again.value,42);
  const observer=await request('scripts.observe',{source:'export default({emu})=>({frame:emu.info().frame})',args:{},timeoutMs:10000,maxFrames:0});assert(observer.observer_id);
  const waitObserver=async predicate=>{const deadline=Date.now()+5000;let page;do{page=await request('script.observerRead',{offset:0,length:16384});if(predicate(page))return page;await sleep(10)}while(Date.now()<deadline);assert.fail('observer state timeout: '+JSON.stringify(page));};
  await request('session.resume');
  await waitObserver(page=>page.bytes>0);await request('session.pause');
  const observed=await request('script.observerRead',{offset:0,length:16384});
  assert.equal(observed.active,true);assert.equal(JSON.parse(Buffer.from(observed.hex,'hex').toString()).frame,observed.frame);
  const exclusive=await run('export default async({frames})=>{await frames(8);return true}');assert.equal(exclusive.value,true);
  assert.equal((await request('script.observerRead',{offset:0,length:16384})).hex,observed.hex);
  await request('script.observerStop');
  await request('scripts.observe',{source:'export default({frames})=>frames(1)',args:{},timeoutMs:10000,maxFrames:0});
  await request('session.resume');
  const denied=await waitObserver(page=>!page.active);await request('session.pause');
  assert.match(denied.error,/read_only/);assert.equal(denied.active,false);

 }finally{router.detach();child.stdin.end('quit\n');const timer=setTimeout(()=>child.kill('SIGKILL'),1000);await closed;clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true})}
});

test('non-N64 scripts can read debugger regions and report unsupported VI stepping',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-script-gb-'),rom=path.join(dir,'fixture.gb');fs.writeFileSync(rom,require('../fixture.cjs').makeFixture());
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--rom',rom,'--system','Game Boy','--paused','--silent','--save-dir',dir,'--control-session','script-gb'],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();const closed=once(child,'close');const native=new NativeSessionClient(child.stdin,child.stdio[3],{session:'script-gb',epoch:1},()=>{}),router=new SessionRouter();router.attach(native);
 const request=async(m,p)=>{const r=await router.request(m,undefined,p,'owner');assert(r.ok,r.error);return r.result};
 async function run(source,args={}){let op=await request('scripts.run',{source,args,timeoutMs:1000,maxFrames:1});while(op.state==='running'){await sleep(5);op=await request('execution.status',{operationId:op.operation_id})}return {op,page:await request('script.read',{offset:0,length:16384,operationId:op.operation_id})};}
 try{
  const region=(await request('memory.regions')).regions.find(r=>r.readable&&r.size>=4);const direct=await request('memory.read',{region:region.id,offset:0,length:4});
  const result=await run('export default({args,mem,emu})=>({n64:emu.info().n64_memory,bytes:Array.from(mem.region(args.region,0,4))})',{region:region.id});assert.equal(result.op.stop_reason,'script_done');const value=JSON.parse(Buffer.from(result.page.hex,'hex'));assert.equal(value.n64,false);assert.equal(Buffer.from(value.bytes).toString('hex'),direct.hex);
  const unsupported=await run('export default({frames})=>frames(1)');assert.equal(unsupported.op.stop_reason,'script_failed');assert.match(unsupported.page.error,/frame_boundary_unavailable/);
 }finally{router.detach();child.stdin.end('quit\n');const timer=setTimeout(()=>child.kill('SIGKILL'),1000);await closed;clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true})}
});
