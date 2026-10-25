const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const {dispatch}=require('../dist/launcher.js');const {AppLogs}=require('../dist/services/app-logs.js');const {scriptStatus,waitForScript}=require('../dist/services/script-wait.js');const {ScriptResults}=require('../dist/services/script-results.js');
test('helper dispatch rejects unknown input and help never discovers or launches',()=>{
 for(const args of [[],['--services','--instance-name','test'],['--user-data-dir','/tmp/test']])assert.equal(dispatch(args),'gui');
 for(const args of [['--help'],['-h'],['call','--help'],['run','-h'],['tools','--help']]){assert.equal(dispatch(args),'help');const r=spawnSync(process.execPath,[path.resolve(__dirname,'../dist/launcher.js'),...args],{encoding:'utf8',env:{...process.env,ARES_SERVICE_DIR:'/does/not/exist'}});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Usage:/);}
 for(const args of [['wat'],['--bad'],['game.rom'],['--instance-name'],['tools','extra']])assert.throws(()=>dispatch(args));
});
test('app diagnostics bound fragments, queues, repetition, pages, rotation and generations',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-app-logs-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const logs=new AppLogs(dir,200);
 logs.native(Buffer.from('frag'),2);logs.native(Buffer.from('ment\nsecond\n'),2);logs.native(Buffer.from('x'.repeat(20000)),2);logs.endNative(2);
 assert.equal(logs.read({}).entries[0].message,'fragment');assert(logs.read({}).entries.some(e=>e.truncated>0));
 assert.throws(()=>logs.read({generation:'old'}),/stale_log_generation/);
 for(let i=0;i<600;i++)logs.write('main','info',String(i));await logs.flush();assert(logs.lost>0);assert.equal(logs.read({cursor:1}).expired,true);assert(logs.read({limit:3}).entries.length<=3);
 for(let i=0;i<12;i++){logs.write('main','error',new Error('stack '+i));await logs.flush();}
 assert(fs.existsSync(path.join(dir,'app.jsonl.3')));assert.equal(fs.statSync(path.join(dir,'app.jsonl')).mode&0o077,0);assert.match(logs.lastError.message,/Error: stack/);
});
test('script epoch polling refreshes once and only accepts an owned lineage',async()=>{
 for(const allowed of [true,false]){const identity={session:'rom',epoch:1};let calls=0;const client={request:async method=>{++calls;if(calls===1)return {ok:false,error:'stale_epoch'};if(method==='session.status')return {ok:true,result:{},session:'rom',epoch:2};return {ok:true,result:{operation_id:7,state:'running',script_lineage:{session:'rom',epochs:allowed?[1,2]:[1]}}};}};
 if(allowed){await scriptStatus(client,7,identity);assert.equal(identity.epoch,2);}else{await assert.rejects(scriptStatus(client,7,identity),/external_epoch_transition/);assert.equal(identity.epoch,1);}assert.equal(calls,3);}
 const client={request:async()=>({ok:false,error:'stale_epoch'})};await assert.rejects(scriptStatus(client,7,{session:'rom',epoch:1}),/stale_epoch/);
 await assert.rejects(waitForScript(client,{state:'running',operation_id:7},{session:'rom',epoch:1},{timeoutMs:0}),/script_wait_timeout/);
});
test('immutable completed results enforce scope, quotas and explicit handles',()=>{
 const store=new ScriptResults(),identity={session:'rom',epoch:1},data=Buffer.from('{"n":1}'),handle=store.reserve();store.publish(handle,5,identity,data,{logs:[],error:''});data.fill(0);
 assert.equal(Buffer.from(store.read({handle}).hex,'hex').toString(),'{"n":1}');assert.equal(store.read({},identity).result_handle,handle);assert.throws(()=>store.read({},{session:'other',epoch:1}),/no_script_result/);
 for(let n=1;n<16;n++){const h=store.reserve();store.publish(h,5+n,identity,Buffer.from('1'),{});}assert.throws(()=>store.reserve(),/backpressure/);
});

test('app logs recover bounded rotated history with a new generation after restart',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-app-log-restart-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const first=new AppLogs(dir,300);for(let i=0;i<20;i++){first.write('main','info','restart '+i);await first.flush();}
 first.write('native','error','retained failure',7);await first.flush();
 fs.appendFileSync(path.join(dir,'app.jsonl'),'malformed trailing fragment');
 const next=new AppLogs(dir,300),page=next.read({limit:64});assert.notEqual(page.generation,first.instance);assert(page.entries.some(e=>e.message==='retained failure'&&e.instance===first.instance&&e.nativeGeneration===7));assert(page.entries.length<=512);assert.throws(()=>next.read({generation:first.instance}),/stale_log_generation/);
 next.write('main','info','new process');await next.flush();assert(next.read({}).entries.some(e=>e.instance===next.instance&&e.message==='new process'));
});

test('slow and full log sinks bound the pending queue and remain readable',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-app-log-disk-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const logs=new AppLogs(dir);
 const original=fs.promises.appendFile;let release,entered=false;
 fs.promises.appendFile=async()=>{entered=true;await new Promise(r=>release=r);};
 try{
  logs.write('main','info','blocked');while(!entered)await new Promise(r=>setImmediate(r));
  for(let i=0;i<1000;i++)logs.write('main','info','queued '+i);
  assert(logs.lost>=873);assert.equal(logs.read({limit:64}).entries.length,64);
  fs.promises.appendFile=async()=>{throw Object.assign(new Error('full disk'),{code:'ENOSPC'});};release();await logs.flush();assert(logs.lost>=999);
  logs.write('main','error','still serviceable');await logs.flush();assert.equal(logs.lastError.message,'still serviceable');
 }finally{fs.promises.appendFile=original;release?.();await logs.flush();}
 logs.write('main','info','disk recovered');await logs.flush();assert(fs.readFileSync(path.join(dir,'app.jsonl'),'utf8').includes('disk recovered'));
});

test('completed result retention bounds simultaneous reservations, expiry and ambiguous reused operation IDs',()=>{
 const store=new ScriptResults(),scope={session:'retention',epoch:1};const tickets=Array.from({length:4},()=>store.reserve());assert.throws(()=>store.reserve(),/backpressure/);for(const ticket of tickets)store.abort(ticket);
 const handles=[];for(let i=0;i<16;i++){const handle=store.reserve();handles.push(handle);store.publish(handle,i%2,{...scope,epoch:i+1},Buffer.from(JSON.stringify({i})),{});}
 assert.throws(()=>store.reserve(),/backpressure/);assert.equal(JSON.parse(Buffer.from(store.read({},scope).hex,'hex')).i,15);assert.throws(()=>store.read({operation_id:1},scope),/ambiguous/);assert.throws(()=>store.read({},{session:'different',epoch:1}),/no_script_result/);
 store.release(handles[0]);assert.throws(()=>store.read({handle:handles[0]}),/released/);
 const original=Date.now;try{const later=original()+16*60*1000;Date.now=()=>later;assert.throws(()=>store.read({handle:handles[1]}),/expired/);assert.throws(()=>store.read({},scope),/no_script_result/);const free=store.reserve();store.abort(free);}finally{Date.now=original;}
});

test('consumed CLI results remain readable until pressure; unconsumed results are pinned',()=>{
 const store=new ScriptResults(),scope={session:'consumed',epoch:1};const pinned=store.reserve();store.publish(pinned,1,scope,Buffer.from('1'),{});
 let previous;
 for(let n=0;n<40;n++){const h=store.reserve();store.publish(h,n+2,scope,Buffer.from('2'),{});store.consume(h);assert.equal(store.read({handle:h}).hex,'32');previous=h;}
 assert.equal(store.read({handle:pinned}).hex,'31');assert.equal(store.read({handle:previous}).hex,'32');
});

test('live adapter provenance stays pinned when a rebuild replaces build metadata',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-build-pinning-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'services'));
 fs.copyFileSync(path.join(__dirname,'../dist/services/build-info.js'),path.join(dir,'services/build-info.mjs'));const file=path.join(dir,'build-info.json');fs.writeFileSync(file,JSON.stringify({build_id:'old',schema_id:'old-schema'}));
 const {buildInfo}=await import(require('node:url').pathToFileURL(path.join(dir,'services/build-info.mjs')));assert.equal(buildInfo().schema_id,'old-schema');fs.writeFileSync(file,JSON.stringify({build_id:'new',schema_id:'new-schema'}));assert.equal(buildInfo().build_id,'old');assert.equal(buildInfo().schema_id,'old-schema');
});
