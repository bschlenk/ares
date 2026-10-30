import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PairedRecovery} from '../dist/services/paired-recovery.js';
import {PluginJournals} from '../dist/plugins/journal.js';
const game='a'.repeat(64),configuration='b'.repeat(64),guard=()=>{};
class FakeNative {
  identity;state=Buffer.alloc(600,17);paused=false;held=false;usedInput=false;loads=0;captureId=1;
  constructor(session){this.identity={session,epoch:1};}
  async request(method,identity=this.identity,p){let result,error;if(identity.session!==this.identity.session||identity.epoch!==this.identity.epoch)error='stale_epoch';else switch(method){
    case 'checkpoint.info':result={available:true,hash:game,configuration,reason:''};break;
    case 'session.status':result={frame:12,frame_kind:'primary-screen-frame',paused:this.paused,system:'Game Boy',synthetic:false,capabilities:[]};break;
    case 'checkpoint.capture':assert.equal(p.requireIdle,true);if(this.held)error='input_active';else{this.frozen=Buffer.from(this.state);result={id:this.captureId++,bytes:604,stateBytes:600,width:1,height:1,capturedAt:Date.now(),capture_ms:0.1,start_frame:12};}break;
    case 'checkpoint.read':result={hex:this.frozen.subarray(p.offset,p.offset+p.length).toString('hex')};break;
    case 'checkpoint.release':case 'checkpoint.abort':result={released:true};break;
    case 'checkpoint.upload':assert.equal(p.recovery,true);if(this.usedInput)error='recovery_not_pristine';else{this.upload=Buffer.alloc(p.bytes);result={id:99};}break;
    case 'checkpoint.write':Buffer.from(p.hex,'hex').copy(this.upload,p.offset);result={written:p.hex.length/2};break;
    case 'checkpoint.commit':assert.equal(p.resume,false);this.state=this.upload;this.loads++;this.identity.epoch++;this.paused=true;result={loaded:true};break;
    default:throw new Error(method);
  }return {protocol:1,id:'r',...this.identity,ok:!error,...(error?{error}:{result})};}
}
async function fixture(run){const root=await fs.mkdtemp('/tmp/ares-paired-'),journalFile=path.join(root,'journal.json'),store=path.join(root,'pairs'),access={pluginId:'test.recovery',storageVersion:1,journalFile},journals=new PluginJournals(),broker=new PairedRecovery(store,journals);try{await run({root,store,access,journals,broker,append:(id,value)=>journals.request(journalFile,'events','journal.append',{id,schemaVersion:1,value},guard)});}finally{await fs.rm(root,{recursive:true,force:true});}}
test('paired publication restores the matching prefix and keeps sequence numbers monotonic',()=>fixture(async({root,store,access,journals,broker,append})=>{
  const source=new FakeNative('source');await append('one',{turn:1});const point=await broker.capture(access,source,source.identity,guard);assert.equal(point.journalSequence,1);
  await append('two',{turn:2});source.state.fill(55);
  assert.equal((await broker.restoreStartup([access],source,source.identity)).restored,false,'healthy current session cannot rewind');
  const target=new FakeNative('target');const restarted=new PairedRecovery(store,new PluginJournals());assert.equal((await restarted.restoreStartup([access],target,{...target.identity})).restored,true);assert(target.state.every(b=>b===17));assert.equal(target.paused,true);
  const active=await journals.request(access.journalFile,'events','journal.read',{afterSequence:0,limit:64},guard);assert.deepEqual(active.records.map(r=>r.id),['one']);assert.equal(active.nextSequence,3);assert.equal(active.recovery.journalSequence,1);
  assert.equal(JSON.parse(await fs.readFile(access.journalFile,'utf8')).records.length,2,'superseded records remain on disk for audit');
  const duplicate=await append('two',{turn:2});assert.equal(duplicate.superseded,true);assert.equal((await append('three',{turn:3})).sequence,3);
  assert.equal((await restarted.restoreStartup([access],target,target.identity)).restored,false,'one restore per live target session');
  await restarted.disarmGame(game);const next=new FakeNative('normal-restart');assert.equal((await restarted.restoreStartup([access],next,next.identity)).restored,false,'normal close disarms recovery');
}));
test('input deferral, namespace/configuration/integrity refusal and diverged journals never load RAM',()=>fixture(async({store,access,journals,broker,append})=>{
  const source=new FakeNative('source');await append('one',1);source.held=true;await assert.rejects(broker.capture(access,source,source.identity,guard),/input_active/);source.held=false;
  const point=await broker.capture(access,source,source.identity,guard),folder=path.join(store,'test.recovery-v1',point.id);
  const target=new FakeNative('target');target.usedInput=true;await assert.rejects(broker.restoreStartup([access],target,target.identity),/recovery_not_pristine/);assert.equal(target.loads,0);
  // A fresh failed attempt can retry after replacement of the native process.
  const diverged=JSON.parse(await fs.readFile(access.journalFile,'utf8'));diverged.records[0].value=99;await fs.writeFile(access.journalFile,JSON.stringify(diverged));
  const fresh=new FakeNative('fresh');await assert.rejects(broker.restoreStartup([access],fresh,fresh.identity),/recovery_journal_diverged/);assert.equal(fresh.loads,0);
  diverged.records[0].value=1;await fs.writeFile(access.journalFile,JSON.stringify(diverged));await fs.writeFile(path.join(folder,'state.bin'),Buffer.alloc(600,9));
  await assert.rejects(broker.restoreStartup([access],fresh,fresh.identity),/recovery_integrity_failed/);assert.equal(fresh.loads,0);
}));
test('publication faults preserve the prior pair, obsolete points are bounded, and snapshots serialize journal writers',()=>fixture(async({store,access,journals,broker,append})=>{
  const source=new FakeNative('source');await append('one',1);const original=await broker.capture(access,source,source.identity,guard);
  const rename=fs.rename;fs.rename=async(from,to)=>{if(to.endsWith('latest.json'))throw new Error('injected pointer failure');return rename(from,to);};
  try{await assert.rejects(broker.capture(access,source,source.identity,guard),/injected pointer failure/);}finally{fs.rename=rename;}
  assert.equal((await broker.status(access,'owner')).point.id,original.id);
  await broker.capture(access,source,source.identity,guard);await broker.capture(access,source,source.identity,guard);
  const directories=(await fs.readdir(path.join(store,'test.recovery-v1'),{withFileTypes:true})).filter(e=>e.isDirectory());assert.equal(directories.length,2);
  let release;const blocked=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
  const frozen=journals.withSnapshot(access.journalFile,guard,async(_,sequence)=>{entered();await blocked;return sequence;});await ready;
  const later=append('two',2);release();assert.equal(await frozen,1);assert.equal((await later).sequence,2);
}));
test('interrupted journal publication leaves RAM paused and can retry after another process replacement',()=>fixture(async({access,journals,broker,append})=>{
  const source=new FakeNative('source');await append('one',1);await broker.capture(access,source,source.identity,guard);await append('two',2);
  const apply=journals.applyRecovery.bind(journals);journals.applyRecovery=async()=>{throw new Error('injected journal publication failure');};
  const failed=new FakeNative('failed');await assert.rejects(broker.restoreStartup([access],failed,{...failed.identity}),/injected journal publication failure/);assert.equal(failed.loads,1);assert.equal(failed.paused,true);
  journals.applyRecovery=apply;const retry=new FakeNative('retry');assert.equal((await broker.restoreStartup([access],retry,{...retry.identity})).restored,true);
  const page=await journals.request(access.journalFile,'events','journal.read',{afterSequence:0,limit:64},guard);assert.deepEqual(page.records.map(r=>r.id),['one']);assert.equal(page.nextSequence,3);
  await append('three',3);await broker.capture(access,retry,{...retry.identity},guard);await append('four',4);
  const again=new FakeNative('again');await broker.restoreStartup([access],again,{...again.identity});
  const repeated=await journals.request(access.journalFile,'events','journal.read',{afterSequence:0,limit:64},guard);assert.deepEqual(repeated.records.map(r=>r.id),['one','three']);assert.equal(repeated.nextSequence,5,'repeated recovery preserves audit sequences and previous exclusions');
}));
test('configuration and namespace mismatches, competing owners and revoked publication fail closed',()=>fixture(async({store,access,broker,append})=>{
  const source=new FakeNative('source');await append('one',1);const point=await broker.capture(access,source,source.identity,guard);
  const alias=path.join(path.dirname(store),'linked-store');await fs.symlink(store,alias);await assert.rejects(new PairedRecovery(alias,new PluginJournals()).disarmGame(game),/recovery_invalid_store/);
  await assert.rejects(broker.capture({...access,pluginId:'test.other'},source,source.identity,guard),/recovery_owner_conflict/);
  const manifestFile=path.join(store,'test.recovery-v1',point.id,'manifest.json'),original=await fs.readFile(manifestFile,'utf8'),manifest=JSON.parse(original),fresh=new FakeNative('fresh');
  await fs.writeFile(manifestFile,JSON.stringify({...manifest,configuration:'c'.repeat(64)}));await assert.rejects(broker.restoreStartup([access],fresh,fresh.identity),/recovery_configuration_mismatch/);assert.equal(fresh.loads,0);
  await fs.writeFile(manifestFile,JSON.stringify({...manifest,pluginId:'test.other'}));await assert.rejects(broker.restoreStartup([access],fresh,fresh.identity),/recovery_namespace_mismatch/);assert.equal(fresh.loads,0);
  await fs.writeFile(manifestFile,original);
  let checks=0;await assert.rejects(broker.capture(access,source,source.identity,()=>{if(++checks===4)throw new Error('stale_plugin_scope');}),/stale_plugin_scope/);assert.equal((await broker.status(access,'owner')).point.id,point.id);
}));
test('host enforces both recovery grants, active scope and lifecycle-owned monitor cleanup',async()=>{
  const {PluginRegistry}=await import('../dist/plugins/registry.js'),root=await fs.mkdtemp('/tmp/ares-paired-registry-'),sources=[],client=new FakeNative('source');
  try{
    for(const [id,capabilities] of [['allowed',['storage.journal','recovery.manage']],['denied',['storage.journal']]]){
      const source=path.join(root,id);sources.push(source);await fs.mkdir(source);await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({id:'test.'+id,name:id,version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities,contributes:{}}));await fs.writeFile(path.join(source,'plugin.js'),'export function activate(){}');
    }
    const registry=new PluginRegistry(path.join(root,'bundled'),path.join(root,'data'),client,()=>client.identity),broker=registry.connectRecovery(path.join(root,'pairs'),()=>({client,identity:{...client.identity},guard}));
    await registry.initialize(sources);registry.attach();registry.observe(await client.request('session.status'));
    const tokens={};for(const id of ['allowed','denied']){await registry.enable('test.'+id,true);tokens[id]=registry.catalog().plugins.find(p=>p.manifest?.id==='test.'+id).lease.token;}
    await assert.rejects(registry.storage(tokens.allowed,'recovery.capture','host'),/plugin_not_ready/);registry.finish(tokens.allowed);registry.finish(tokens.denied);
    await assert.rejects(registry.storage(tokens.denied,'recovery.status','host'),/plugin_capability_denied/);
    await assert.rejects(registry.request(tokens.allowed,'checkpoint.upload',{bytes:600,recovery:true}),/plugin_capability_denied/,'recovery grant does not admit native state loading');
    await assert.rejects(registry.request(tokens.allowed,'checkpoint.capture',{requireIdle:true}),/plugin_capability_denied/,'captures remain brokered with the journal');
    await registry.storage(tokens.allowed,'journal.append','events',{id:'one',schemaVersion:1,value:1});
    assert.equal((await registry.storage(tokens.allowed,'recovery.capture','host')).point.journalSequence,1);
    assert.equal((await registry.storage(tokens.allowed,'recovery.start','host',{intervalMs:1000})).monitoring,true);
    await assert.rejects(registry.storage(tokens.allowed,'recovery.restore','host'),/invalid_request/);
    const owner='plugin-'+tokens.allowed;await registry.enable('test.allowed',false);assert.equal((await broker.status({pluginId:'test.allowed',storageVersion:1},owner)).monitoring,false);
    await assert.rejects(registry.storage(tokens.allowed,'recovery.capture','host'),/stale_plugin_scope/);registry.disconnect();
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('scheduled recovery reports input deferral, publishes on the next idle attempt and stops cleanly',()=>fixture(async({access,broker,append})=>{
  const source=new FakeNative('source');source.held=true;await append('one',1);
  const status=()=>broker.status(access,'owner',source.identity,12);
  const until=async predicate=>{for(let i=0;i<40;i++){const s=await status();if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('scheduler deadline');};
  broker.start('owner',1000,()=>broker.capture(access,source,{...source.identity},guard));
  try{
    assert.equal((await until(s=>s.lastError?.includes('input_active'))).point,null);
    source.held=false;const ready=await until(s=>!!s.point);assert.equal(ready.monitoring,true);assert.equal(ready.lastError,undefined);assert.equal(ready.framesSincePoint,0);
    broker.stop('owner');await new Promise(r=>setTimeout(r,1100));const stopped=await status();assert.equal(stopped.monitoring,false);assert.equal(stopped.point.id,ready.point.id);
  }finally{broker.stop('owner');}
}));
