const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {LocalServiceClient}=require('../dist/services/local-endpoint.js'),{AutomaticServiceClient}=require('../dist/services/automatic-client.js'),{readWatchdog,healthPath}=require('../dist/services/watchdog.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){const value=await fn();if(value)return value;await sleep(50);}throw Error('watchdog deadline');}
async function fixture(t,mode='normal'){
 const dir=fs.mkdtempSync('/tmp/ares-watchdog-');fs.chmodSync(dir,0o700);
 const child=spawn(process.execPath,[path.join(__dirname,'watchdog-fixture.cjs'),dir,mode],{stdio:['ignore','ignore','pipe','ipc']});const closed=once(child,'close');let error='';child.stderr.on('data',b=>error+=b);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}await sleep(100);fs.rmSync(dir,{recursive:true,force:true});});
 const [message]=await Promise.race([once(child,'message'),closed.then(()=>{throw Error('watchdog fixture exited: '+error);})]);assert(message.ready,error);return {dir,child,closed,...message};
}
test('independent watchdog answers fresh clients while the main event loop is blocked', {timeout:15000},async t=>{
 const f=await fixture(t),client=new LocalServiceClient(f.file,f.info.instance);t.after(()=>client.close());
 const live=await client.manage({operation:'app_health'});assert.equal(live.watchdog.main,'responsive');assert.equal(live.native.connected,false);
 const signal=once(f.child,'message');f.child.send({action:'stall',ms:4500});await signal;
 await until(async()=>{const s=await readWatchdog(f.info);return s?.watchdog.main==='unresponsive';});
 const fresh=new LocalServiceClient(f.file,f.info.instance),automatic=new AutomaticServiceClient(f.dir);t.after(()=>{fresh.close();automatic.close();});
 for(const c of [client,fresh,automatic]){const start=Date.now(),health=await c.manage({operation:'app_health'});assert(Date.now()-start<1000);assert.equal(health.watchdog.main,'unresponsive');assert.equal(health.watchdog.observer,'responsive');assert.equal(health.observation,'cached');assert.equal(health.watchdog.observation,'independent_process');}
 await until(async()=>fs.readFileSync(path.join(f.dir,'watchdog.jsonl'),'utf8').includes('unresponsive'));assert.equal(automatic.launchedApp,false);assert(!fs.readFileSync(healthPath(f.info),'utf8').includes(f.info.token));
 await until(async()=>{const s=await readWatchdog(f.info);return s?.watchdog.main==='responsive';});
 f.child.send({action:'stop'});assert.equal((await f.closed)[0],0);assert(!fs.existsSync(healthPath(f.info)));
});
test('watchdog reports parent disconnection and rejects insecure or unrelated snapshots', {timeout:10000},async t=>{
 const f=await fixture(t);const fake={...f.info,endpoint:path.join(f.dir,'permissions.sock')},file=healthPath(fake);fs.copyFileSync(healthPath(f.info),file);
 fs.chmodSync(file,0o644);assert.equal(await readWatchdog(fake),undefined);
 assert.equal(await readWatchdog({...f.info,instance:'unrelated'}),undefined);
 f.child.kill('SIGKILL');await f.closed;
 await until(async()=>{const s=await readWatchdog(f.info);return s?.watchdog.main==='disconnected';});
 const client=new LocalServiceClient(f.file,f.info.instance);t.after(()=>client.close());const value=await client.manage({operation:'app_health'});assert.equal(value.watchdog.main,'disconnected');assert.equal(value.observation,'cached');
});
test('fresh MCP health remains responsive while the actual Electron main process is stopped',{timeout:25000},async t=>{
 const {readConnection}=require('../dist/services/local-endpoint.js'),{StdioPeer}=require('./stdio-peer.cjs');
 const dir=fs.mkdtempSync('/tmp/ares-watchdog-ui-'),ipc=path.join(dir,'ipc'),root=path.resolve(__dirname,'..');
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('ARES_')||['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH'].includes(k))delete env[k];
 Object.assign(env,{ARES_PROFILE_DIR:path.join(dir,'profile'),ARES_SERVICE_DIR:ipc,ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_DISABLE_PLUGINS:'1'});if(process.env.ARES_HOST)env.ARES_HOST=process.env.ARES_HOST;
 const child=spawn(require('electron'),[root,'--services'],{env,stdio:['ignore','ignore','pipe']});const closed=once(child,'close');let diagnostics='';child.stderr.on('data',b=>diagnostics+=b);let peer;
 t.after(async()=>{await peer?.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGCONT');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await closed;clearTimeout(timer);}fs.rmSync(dir,{recursive:true,force:true});});
 const file=await until(async()=>{try{return fs.readdirSync(ipc).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>path.join(ipc,n))[0];}catch{}});
 const id=path.basename(file,'.json'),info=await readConnection(file,id),client=new LocalServiceClient(file,id);t.after(()=>client.close());
 await until(async()=>{const health=await client.manage({operation:'app_health'});return health.native.connected&&health.watchdog?.main==='responsive';});
 child.kill('SIGSTOP');await until(async()=>{return (await readWatchdog(info))?.watchdog.main==='unresponsive';});
 peer=new StdioPeer(require('electron'),[path.join(root,'dist/mcp/server.js'),'--connection',file,'--instance',id],{env:{...env,ELECTRON_RUN_AS_NODE:'1'}});await peer.initialize();
 const start=Date.now(),health=await peer.tool('app_health');assert(Date.now()-start<1000,diagnostics);assert.equal(health.watchdog.main,'unresponsive');assert.equal(health.watchdog.observer,'responsive');assert.equal(health.observation,'cached');
 child.kill('SIGCONT');await until(async()=>{return (await client.manage({operation:'app_health'})).watchdog.main==='responsive';});
 child.kill('SIGTERM');assert.equal((await closed)[0],0,diagnostics);assert(!fs.existsSync(healthPath(info)));
});
test('oversized health snapshots do not turn a working main heartbeat into a reported stall',{timeout:7000},async t=>{
 const f=await fixture(t,'oversize');const value=await readWatchdog(f.info);assert.equal(value.snapshot_truncated,true);assert.equal(value.watchdog.main,'responsive');await sleep(2300);assert.equal((await readWatchdog(f.info)).watchdog.main,'responsive');
});
