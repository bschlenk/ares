import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {LocalServiceHost,LocalServiceClient} from '../dist/services/local-endpoint.js';
import {Targets,decodeTarget,encodeTarget} from '../dist/sessions/targets.js';
import {discoverInstances,nextOpenSequence} from '../dist/sessions/discovery.js';
import {personalContext,prepareManagementRoot} from '../dist/sessions/context.js';
import {SessionRepository} from '../dist/sessions/repository.js';
import {ToolRegistry} from '../dist/tools/registry.js';
import {registerTools} from '../dist/mcp/register-tools.js';
import {AutomaticServiceClient} from '../dist/services/automatic-client.js';
import {scopeReferences,inputReferences} from '../dist/mcp/target-references.js';
import {ServiceError} from '../dist/services/contracts.js';
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync('/tmp/ares-selection-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
async function host(t,root,order,kind='personal',gate=false){
  const instance=randomUUID(),calls=[],identity={session:randomUUID(),epoch:1};
  const metadata={instance,kind,opened_order:order,ready:true,loaded:true,running:true,paused:false,game_title:'Fixture',system:'Game Boy',approval:kind==='named'?'implicit':'required'};
  const client={async request(method,id,params,owner){calls.push({method,id,params,owner});return {protocol:1,id:'fixture',ok:true,...identity,result:method==='session.status'?{paused:false,synthetic:true,system:'Game Boy',capabilities:[],title:instance}:{paused:true,synthetic:true,system:'Game Boy',capabilities:[],state:'completed',operation_id:7}};}};
  const server=new LocalServiceHost(client,async p=>{calls.push({management:p.operation});if(p.operation==='app_status')return metadata;if(p.operation==='owner_lease')throw Error('unexpected');await new Promise(r=>setTimeout(r,10));return {instance};},instance,gate?operation=>{if(operation!=='app_status')throw new ServiceError('access_required');}:undefined);
  await server.listen(path.join(root,'services'));t.after(()=>server.close());return {server,instance,metadata,calls,identity};
}
const value=result=>{assert.equal(result.isError,undefined,JSON.stringify(result));return JSON.parse(result.content[0].text);};
test('discovery is metadata-only and defaults to earliest personal, ignoring named windows',async t=>{
  const root=fixture(t),named=await host(t,root,1,'named'),later=await host(t,root,3),earlier=await host(t,root,2);
  const live=await discoverInstances(path.join(root,'services'));assert.deepEqual(live.map(v=>v.instance),[named.instance,earlier.instance,later.instance]);
  for(const app of [named,later,earlier])assert(app.calls.every(c=>!c.method||c.method==='execution.release'));
  const targets=new Targets(path.join(root,'services'),path.join(root,'personal'));
  const selection=await targets.client();assert.equal(decodeTarget(selection.target).instance,earlier.instance);selection.client.close();
  const automatic=new AutomaticServiceClient(targets.directory);t.after(()=>automatic.close());
  assert.equal((await automatic.manage({operation:'app_status'})).instance,earlier.instance);
  await earlier.server.close();await assert.rejects(automatic.manage({operation:'app_status'}),/app_disconnected/);
});
test('two callers interleave through one registry without changing startup selection or identities',async t=>{
  const root=fixture(t),a=await host(t,root,1,'named'),b=await host(t,root,2,'named');
  const targets=new Targets(path.join(root,'services'),path.join(root,'personal'));
  const ta=(await targets.select({instance_id:a.instance})).target,tb=(await targets.select({instance_id:b.instance})).target;
  const registry=new ToolRegistry(),close=registerTools(registry,new LocalServiceClient('',''),new Targets(targets.directory,targets.personalRoot,ta));t.after(close);
  const schemas=registry.list();assert(schemas.every(tool=>tool.inputSchema));assert(schemas.find(tool=>tool.name==='load_rom').inputSchema.properties.target);
  const [ra,rb]=await Promise.all([registry.call('emu_status',{target:ta}),registry.call('emu_status',{target:tb})]);
  assert.equal(value(ra).session,a.identity.session);assert.equal(value(rb).session,b.identity.session);
  value(await registry.call('session_select',{instance_id:b.instance}));
  assert.equal(value(await registry.call('emu_status',{})).session,a.identity.session);
  const [pa,pb]=await Promise.all([registry.call('pause',{target:ta}),registry.call('pause',{target:tb})]);
  assert.equal(value(pa).target,ta);assert.equal(value(pb).target,tb);
  assert.equal(a.calls.find(c=>c.method==='session.pause').id.session,a.identity.session);
  assert.equal(b.calls.find(c=>c.method==='session.pause').id.session,b.identity.session);
  const ref=value(pa).operation_ref;
  assert.equal(inputReferences({operation_id:ref}).refs[0].target,ta);
  const mismatch=await registry.call('operation_status',{target:tb,operation_id:ref});assert.equal(mismatch.isError,true);assert.match(mismatch.content[0].text,/target_reference_mismatch/);
  a.identity.epoch++;const stale=await registry.call('operation_status',{target:ta,operation_id:ref});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/stale_target_reference/);
});
test('personal protected reads, mutations and management paths fail closed without native calls',async t=>{
  const root=fixture(t),a=await host(t,root,1,'personal',true),client=new LocalServiceClient(a.server.metadataFile,a.instance);t.after(()=>client.close());
  assert.equal((await client.management({operation:'app_status'})).approval,'required');
  await assert.rejects(client.request('session.status'),/access_required/);
  await assert.rejects(client.manage({operation:'script_result'}),/access_required/);
  await assert.rejects(client.manage({operation:'owner_lease',action:'create'}),/access_required/);
  assert(a.calls.every(c=>c.management==='app_status'));
});
test('stopped names select without launching and offline lifecycle uses handle namespace',async t=>{
  const root=fixture(t),personal=path.join(root,'personal'),repository=new SessionRepository(personal);await repository.resolve('work');
  const targets=new Targets(path.join(root,'services'),personal),registry=new ToolRegistry(),close=registerTools(registry,new LocalServiceClient('',''),targets);t.after(close);
  const selected=value(await registry.call('session_select',{name:'work'}));assert.equal(decodeTarget(selected.target).name,'work');
  const listed=value(await registry.call('sessions_list',{}));assert.equal(listed.sessions.length,1);assert.equal(listed.instances.length,0);
  const reset=value(await registry.call('session_reset',{target:selected.target,mode:'fresh'}));assert.equal(reset.archives.length,1);
  assert.equal(value(await registry.call('session_recovery_list',{target:selected.target})).length,1);
  assert.equal((await registry.call('session_reset',{target:selected.target,name:'other',mode:'fresh'})).isError,true);

});
test('open order is monotonic across concurrent subprocesses in the same namespace',async t=>{
  const root=fixture(t),context=personalContext(path.join(root,'personal')),management=prepareManagementRoot(context.personalRoot);
  const source=`import {nextOpenSequence} from ${JSON.stringify(new URL('../dist/sessions/discovery.js',import.meta.url).href)};console.log(nextOpenSequence(process.argv[1]));`;
  const results=await Promise.all(Array.from({length:6},async()=>{const child=spawn(process.execPath,['--input-type=module','-e',source,management]);let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);const [code]=await once(child,'close');assert.equal(code,0,error);return Number(output.trim());}));
  assert.deepEqual(results.sort((a,b)=>a-b),[1,2,3,4,5,6]);assert.equal(nextOpenSequence(management),7);
});
test('opaque handles reject invalid selectors; scoped references retain native identity',()=>{
  assert.throws(()=>decodeTarget('bad'),/invalid_target/);
  assert.throws(()=>decodeTarget(encodeTarget({version:1,personal_root:'/tmp',directory:'/tmp',instance:randomUUID(),name:'ambiguous'})),/invalid_target/);
  const identity={session:randomUUID(),epoch:4},target='fixture',scoped=scopeReferences({operation_id:8,handle:9,lease_id:randomUUID()},target,identity);
  const parsed=inputReferences({operation_id:scoped.operation_ref});assert.equal(parsed.values.operation_id,8);assert.deepEqual(parsed.refs[0].identity,identity);assert.equal(inputReferences({before:scoped.handle_ref}).refs[0].value,9);
  const nested=scopeReferences({results:[{epoch:2,data:{operation_id:3,epoch:2}}]},target,identity);assert.equal(inputReferences({operation_id:nested.results[0].data.operation_ref}).refs[0].identity.epoch,2);
});

test('request-local native identity survives interleaved replies on the same client',async()=>{
  const {requestIdentity}=await import('../dist/services/request-identity.js');
  const client=new LocalServiceClient('','');
  client.request=async(method,identity)=>({ok:true,...identity,result:{}});
  const run=requestIdentity(client);
  let unblock,entered;const ready=new Promise(r=>entered=r),blocked=new Promise(r=>unblock=r);
  const first=run(async()=>{await client.request('session.status',{session:'first',epoch:1});entered();await blocked;assert.deepEqual(client.identity,{session:'first',epoch:1});});
  await ready;
  await run(async()=>{await client.request('session.status',{session:'second',epoch:2});await Promise.resolve();assert.equal(client.identity.session,'second');});
  unblock();await first;assert.equal(client.identity.session,'second');client.close();
});
test('interleaved native operations cancel only their initial target and scoped leases reject another target',async t=>{
  const {NativeSessionClient}=await import('../dist/services/native-client.js');
  const {SessionRouter}=await import('../dist/services/session-router.js');
  const root=fixture(t),directory=path.join(root,'services');
  async function nativeTarget(label,order){
    const child=spawn(process.env.ARES_HOST??path.resolve(import.meta.dirname,'../../build_macos/workbench/bin/ares-electron-host'),['--synthetic','--paused','--silent','--save-dir',path.join(root,label),'--control-session',label],{stdio:['pipe','pipe','pipe','pipe']});
    child.stdout.resume();child.stderr.resume();const closed=once(child,'close');
    t.after(async()=>{child.kill('SIGTERM');await closed;});
    const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:label,epoch:1},()=>{}),router=new SessionRouter();router.attach(client);
    const requests=[];
    const host=new LocalServiceHost({request(...args){requests.push(args[0]);return router.request(...args);}},async()=>({instance:host.instance,kind:'named',opened_order:order,ready:true}));
    await host.listen(directory);t.after(()=>host.close());return {host,requests};
  }
  const a=await nativeTarget('target-a',1),b=await nativeTarget('target-b',2),targets=new Targets(directory,path.join(root,'personal'));
  const ta=(await targets.select({instance_id:a.host.instance})).target,tb=(await targets.select({instance_id:b.host.instance})).target;
  const tools=new ToolRegistry(),close=registerTools(tools,new LocalServiceClient('',''),targets);t.after(close);
  const abort=new AbortController(),pending=tools.call('run_frames',{target:ta,n:1000000,max_seconds:10},abort.signal);
  const second=value(await tools.call('run_frames',{target:tb,n:2}));assert.equal(second.elapsed_frames,2);
  for(let i=0;i<100&&!a.requests.includes('execution.runFrames');i++)await new Promise(r=>setTimeout(r,5));
  assert(a.requests.includes('execution.runFrames'));abort.abort();
  const canceled=value(await pending);assert.equal(canceled.stop_reason,'cancelled');
  assert.equal(a.requests.filter(m=>m==='execution.cancel').length,1);assert.equal(b.requests.filter(m=>m==='execution.cancel').length,0);
  const lease=value(await tools.call('owner_lease',{target:tb,action:'create'}));assert(lease.lease_ref);
  const wrong=await tools.call('owner_lease',{target:ta,action:'release',lease_id:lease.lease_ref});assert.equal(wrong.isError,true);assert.match(wrong.content[0].text,/target_reference_mismatch/);
  value(await tools.call('owner_lease',{action:'release',lease_id:lease.lease_ref}));
});
test('cached automatic health ignores named windows and keeps the earliest personal target',async t=>{
  const {healthPath}=await import('../dist/services/watchdog.js');
  const root=fixture(t),named=await host(t,root,1,'named'),personal=await host(t,root,2);
  for(const app of [named,personal]){
    const tick=Number(process.hrtime.bigint()/1000000n);
    fs.writeFileSync(healthPath(app.server.info),JSON.stringify({protocol:1,connection_instance:app.instance,sampled_ms:Date.now(),sampled_tick_ms:tick,heartbeat_ms:Date.now()-5000,heartbeat_tick_ms:tick-5000,parent:'listening',health:{kind:app.metadata.kind,opened_order:app.metadata.opened_order,instance:app.instance}}),{mode:0o600});
  }
  const automatic=new AutomaticServiceClient(path.join(root,'services'));t.after(()=>automatic.close());
  assert.equal((await automatic.manage({operation:'app_health'})).instance,personal.instance);
  assert.equal(named.calls.filter(c=>c.management).length,0);
});
