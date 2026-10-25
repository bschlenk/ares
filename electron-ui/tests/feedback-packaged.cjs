// Opt-in private-media acceptance; copies inputs into an isolated profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createHash}=require('node:crypto');
const {LocalServiceClient}=require('../dist/services/local-endpoint.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const bundle=path.resolve(process.argv[2]||'../build_macos/Ares.app');
 const rom=process.env.ARES_PLUGIN_TEST_ROM,state=process.env.ARES_PLUGIN_TEST_STATE,recorder=process.env.ARES_FEEDBACK_RECORDER;
 assert(rom&&state&&recorder,'Set ARES_PLUGIN_TEST_ROM, ARES_PLUGIN_TEST_STATE and ARES_FEEDBACK_RECORDER');
 const dir=fs.mkdtempSync('/tmp/ares-feedback-packaged-'),out=path.resolve(__dirname,'../artifacts/feedback-packaged');fs.mkdirSync(out,{recursive:true});
 const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');const before=[hash(rom),hash(state)];
 const copyRom=path.join(dir,'game.z64'),copyState=path.join(dir,'game.bs');fs.copyFileSync(rom,copyRom);fs.copyFileSync(state,copyState);
 const env={...process.env,ARES_PROFILE_DIR:path.join(dir,'profile'),ARES_SERVICE_DIR:path.join(dir,'ipc'),ARES_ROM:copyRom,ARES_SYSTEM:'Nintendo 64',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_DISABLE_PLUGINS:'1'};
 for(const key of ['ELECTRON_RUN_AS_NODE','ARES_HOST','ARES_SAVE_DIR','ARES_SETTINGS','ARES_AUTOTEST'])delete env[key];
 const executable=path.join(bundle,'Contents/MacOS/Ares');const app=spawn(executable,['--services'],{env,stdio:['ignore','ignore','pipe']});let diagnostics='';app.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-65536));const closed=once(app,'close');
 let client;
 function cli(args){const helper=process.env.ARES_FEEDBACK_HELPER;const child=helper?spawn(helper,args,{env}):spawn(executable,[path.join(bundle,'Contents/Resources/app/dist/launcher.js'),...args],{env:{...env,ELECTRON_RUN_AS_NODE:'1'}});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);return once(child,'close').then(([code])=>{assert.equal(code,0,stderr);return stdout;});}
 try{
  let ready=false;for(let n=0;n<200;n++){if(app.exitCode!==null)throw Error('App exited during startup: '+diagnostics);try{const files=fs.readdirSync(env.ARES_SERVICE_DIR).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));if(files.length===1){client??=new LocalServiceClient(path.join(env.ARES_SERVICE_DIR,files[0]),path.basename(files[0],'.json'));const health=await client.manage({operation:'app_health'});if(health.native.connected){const status=await client.request('session.status');if(status.ok&&status.result.system==='Nintendo 64'&&status.result.game?.sha256===before[0]){ready=true;break;}}}}catch{}await sleep(50);}assert(ready,'Explicitly launched Kirby app must be ready: '+diagnostics);
  const args=path.join(dir,'args.json'),output=path.join(dir,'result.json');const scenario={state:copyState,settle:10,frames:80,inputs:[{at:0,hold:['right']},{at:40,hold:[]}],fields:[{name:'sample',addr:0x800d69c8,type:'u32'}]};fs.writeFileSync(args,JSON.stringify({...scenario,scenarios:[scenario]}));
  const value=await cli(['run',recorder,'--args',args,'--state',copyState,'--output',output]);const result=JSON.parse(value),recording=result.recordings?.[0]||result;assert.equal(recording.fields.sample.length,80);assert.equal(fs.readFileSync(output,'utf8'),value);
  const page=JSON.parse(await cli(['call','script_result'])),parts=[Buffer.from(page.hex,'hex')];let received=parts[0].length;while(received<page.bytes){const next=JSON.parse(await cli(['call','script_result','--result_handle',page.result_handle,'--offset',String(received)]));assert.equal(next.sha256,page.sha256);const data=Buffer.from(next.hex,'hex');assert(data.length);parts.push(data);received+=data.length;}assert.deepEqual(JSON.parse(Buffer.concat(parts)),result);
  const explicit=JSON.parse(await cli(['call','script_result','--result_handle',page.result_handle]));assert.equal(explicit.sha256,page.sha256);
  const build=JSON.parse(await cli(['call','build_info','--app','true']));assert.equal(build.adapter.build_id,build.app.build_id);
  const health=JSON.parse(await cli(['call','app_health'])),logs=JSON.parse(await cli(['call','app_logs']));assert(health.native.connected);assert(logs.directory);
  // The copied/installed package must include the independent worker, and a
  // fresh installed CLI must answer even while Electron main cannot handshake.
  let stalledHealth;
  app.kill('SIGSTOP');
  try{
   for(let n=0;n<50;n++){stalledHealth=await client.manage({operation:'app_health'});if(stalledHealth.watchdog?.main==='unresponsive')break;await sleep(50);}
   assert.equal(stalledHealth.watchdog?.main,'unresponsive');
   const began=Date.now();stalledHealth=JSON.parse(await cli(['call','app_health']));assert(Date.now()-began<2000,'fresh installed CLI stall health must remain bounded');
   assert.equal(stalledHealth.watchdog.main,'unresponsive');assert.equal(stalledHealth.watchdog.observer,'responsive');assert.equal(stalledHealth.observation,'cached');
  }finally{app.kill('SIGCONT');}
  let recovered=false;for(let n=0;n<100;n++){const h=await client.manage({operation:'app_health'});if(h.watchdog?.main==='responsive'){recovered=true;break;}await sleep(25);}assert(recovered,'installed main heartbeat recovers');
  const tasks=JSON.parse(await cli(['call','rsp_last_task']));assert.equal(tasks.interpreter_required,false);assert.equal(tasks.matrix_state.available,false);assert(tasks.task,'Kirby must dispatch a conventional graphics-task candidate');assert.equal(tasks.task.classification,'declared_graphics_candidate');assert.equal(tasks.task.header.length,128);assert(tasks.scanouts.every(s=>s.mapping==='candidate_only'));
  const matrix=JSON.parse(await cli(['call','matrix_capture']));assert.equal(matrix.capacity,512);assert.equal(matrix.retained,0);
  const exports=JSON.parse(await cli(['call','plugin_exports']));assert.deepEqual(exports.jobs,[]);
  assert.deepEqual([hash(rom),hash(state)],before);
  fs.writeFileSync(path.join(out,'result.json'),value);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({build,result_handle:page.result_handle,result_sha256:page.sha256,epoch:result.info.epoch,frames:recording.fields.sample.length,tasks,exports,health,stalled_health:stalledHealth,logs_directory:logs.directory},null,2));console.log('FEEDBACK_PACKAGED_PASS',out);
 }finally{client?.close();app.kill('SIGTERM');await Promise.race([closed,sleep(3000)]);if(app.exitCode===null){app.kill('SIGKILL');await closed;}fs.writeFileSync(path.join(out,'stderr.log'),diagnostics);fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
