import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SettingsStore} from '../dist/settings/store.js';
import {personalContext} from '../dist/sessions/context.js';
import {personalStorageDirectory} from '../dist/sessions/storage.js';
import {KernelLock} from '../dist/sessions/locks.js';
import {storeLockFile} from '../dist/sessions/transactions.js';
const moduleURL = name => new URL(`../dist/${name}.js`, import.meta.url).href;
const descriptors = [
  {id:'live',title:'Live',section:'Test',type:'number',min:0,max:100,step:1,default:0,apply:'live'},
  {id:'next',title:'Next',section:'Test',type:'boolean',default:false,apply:'next-rom'},
  {id:'restart',title:'Restart',section:'Test',type:'boolean',default:false,apply:'restart'},
];
function fixture(t) {const root=fs.realpathSync(fs.mkdtempSync('/tmp/ares-personal-stores-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function subprocess(source,args=[]) {
  const child=spawn(process.execPath,['--input-type=module','-e',source,...args],{stdio:['ignore','pipe','pipe']});
  let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);
  return once(child,'close').then(([code])=>{assert.equal(code,0,error);return output.trim()?JSON.parse(output):undefined;});
}
const until=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('reconciliation timeout');};
test('watcher and polling reconcile external commits, preserve pending semantics, and never write on startup/close',async t=>{
  const root=fixture(t),file=path.join(root,'preferences.json'),applied=[];
  fs.writeFileSync(file,JSON.stringify({version:1,revision:4,values:{unknown:{keep:true}}}));
  const reader=new SettingsStore(file,descriptors,()=>{},async(id,value)=>applied.push([id,value]));
  t.after(()=>reader.close());
  const original=fs.readFileSync(file,'utf8');reader.watch(40);await reader.resync();assert.equal(fs.readFileSync(file,'utf8'),original);
  const source=`import {SettingsStore} from ${JSON.stringify(moduleURL('settings/store'))};const s=new SettingsStore(process.argv[1],${JSON.stringify(descriptors)});await s.set('live',42);await s.set('next',true);await s.set('restart',true);`;
  await subprocess(source,[file]);await until(()=>reader.catalog().entries.find(e=>e.descriptor.id==='live').applied===42);
  await until(()=>reader.catalog().entries.find(e=>e.descriptor.id==='restart').value===true);
  assert.deepEqual(applied,[['live',42]]);
  for(const id of ['next','restart']){const entry=reader.catalog().entries.find(e=>e.descriptor.id===id);assert.equal(entry.pending,true);assert.equal(entry.applied,false);}
  // Stop the watcher explicitly: polling alone must recover a missed notification.
  reader.close();const watch=fs.watch;fs.watch=()=>{throw Error('watch unavailable');};
  try{reader.watch(30);}finally{fs.watch=watch;}
  await reader.resync();const missed=new SettingsStore(file,descriptors);await missed.set('live',7);
 await until(()=>reader.catalog().entries[0].applied===7);
  const latest=fs.readFileSync(file,'utf8');reader.close();assert.equal(fs.readFileSync(file,'utf8'),latest);
  assert.deepEqual(JSON.parse(latest).values.unknown,{keep:true});
});
test('same-key settings writes commit in lock order and apply unrelated changes learned during a local write',async t=>{
  const root=fixture(t),file=path.join(root,'preferences.json'),applied=[];
  const a=new SettingsStore(file,descriptors,()=>{},async(id,value)=>applied.push([id,value]));
  const b=new SettingsStore(file,descriptors);await b.set('live',3);
  await a.set('next',true);assert.deepEqual(applied,[['live',3]]);
  const held=await KernelLock.acquire(path.join(root,'.settings-locks','preferences.json.lock'));
  let valid=true;const rejected=a.set('live',8,()=>{if(!valid)throw Error('revoked');});
  await new Promise(r=>setTimeout(r,30));valid=false;await held.release();await assert.rejects(rejected,/revoked/);
  await Promise.all([a.set('live',11),b.set('live',12)]);await b.set('live',13);
  assert.equal(JSON.parse(fs.readFileSync(file)).values.live,13);
  await a.resync();assert.equal(a.catalog().entries[0].applied,13);
  const source=`import {SettingsStore} from ${JSON.stringify(moduleURL('settings/store'))};const key='worker'+process.argv[2];const descriptors=${JSON.stringify(descriptors)};descriptors.push({id:key,title:key,section:'Test',type:'boolean',default:false,apply:'restart'});const s=new SettingsStore(process.argv[1],descriptors);await s.set('live',Number(process.argv[2])+21);await s.set(key,true);`;
  await Promise.all([0,1,2].map(i=>subprocess(source,[file,String(i)])));
  const concurrent=JSON.parse(fs.readFileSync(file));assert([21,22,23].includes(concurrent.values.live));
  for(let i=0;i<3;i++)assert.equal(concurrent.values['worker'+i],true);
  await b.set('live',31);await a.resync();assert.equal(a.catalog().entries[0].applied,31);
  assert.equal(JSON.parse(fs.readFileSync(file)).values.next,true);

});
test('personal routing is shared, aliases preserve it, changes refuse live writers and succeed after release',async t=>{
  const root=fixture(t),profile=path.join(root,'profile'),context=personalContext(profile),custom=path.join(profile,'custom');
  let first,second;t.after(async()=>{await first?.release();await second?.release();});assert.equal(personalStorageDirectory(context,custom,lock=>first=lock),custom);
  fs.symlinkSync(profile,path.join(root,'alias'));const alias=personalContext(path.join(root,'alias'));
  assert.equal(personalStorageDirectory(alias,undefined,lock=>second=lock),custom);
  assert.throws(()=>personalStorageDirectory(context,path.join(profile,'other')),/storage_busy/);
  await first.release();await second.release();
  assert.equal(personalStorageDirectory(context,path.join(profile,'other')),path.join(profile,'other'));
});
test('subprocess journal appends and workspace publication share canonical transactions',async t=>{
  const root=fixture(t),file=path.join(root,'journal.json'),alias=path.join(root,'alias');fs.symlinkSync(root,alias);
  const source=`import {PluginJournals} from ${JSON.stringify(moduleURL('plugins/journal'))};const j=new PluginJournals();for(let n=0;n<8;n++)await j.request(process.argv[1],'events','journal.append',{id:process.argv[2]+'_'+n,schemaVersion:1,value:n},()=>{});`;
  await Promise.all(Array.from({length:4},(_,i)=>subprocess(source,[path.join(i%2?alias:root,'journal.json'),String(i)])));
  const data=JSON.parse(fs.readFileSync(file));assert.equal(data.records.length,32);assert.equal(data.nextSequence,33);assert.equal(new Set(data.records.map(r=>r.id)).size,32);
  const layoutFile=path.join(root,'workspace.json');
  const layoutSource=`import {WorkspaceStore} from ${JSON.stringify(moduleURL('workspace/store'))};import {defaultLayout} from ${JSON.stringify(moduleURL('workspace/model'))};const s=new WorkspaceStore(process.argv[1]);for(let n=0;n<4;n++){const l=defaultLayout();l.root.panel='plugin:local.'+process.argv[2]+':panel';s.save(l);}`;
  await Promise.all([subprocess(layoutSource,[layoutFile,'a']),subprocess(layoutSource,[path.join(alias,'workspace.json'),'b'])]);
  assert.match(JSON.parse(fs.readFileSync(layoutFile)).root.panel,/plugin:local\.[ab]:panel/);
  assert.equal(storeLockFile(layoutFile),storeLockFile(path.join(alias,'workspace.json')));
});
test('subprocess plugin configuration edits preserve unrelated enablement and unknown fields; key storage patches do not lose writes',async t=>{
  const root=fixture(t),bundled=path.join(root,'bundled'),data=path.join(root,'data');fs.mkdirSync(bundled);fs.mkdirSync(data);
  for(const id of ['one','two','shared']){
    const directory=path.join(bundled,id);fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({id:'test.'+id,name:id,version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities:[],contributes:{}}));
    fs.writeFileSync(path.join(directory,'plugin.js'),'export function activate(){}');
  }
  const config=path.join(data,'enabled.json');fs.writeFileSync(config,JSON.stringify({directories:[],enabled:['test.shared'],future:{keep:true}}));
  const source=`import fs from 'node:fs';import path from 'node:path';import {PluginRegistry} from ${JSON.stringify(moduleURL('plugins/registry'))};
    const [root,key]=process.argv.slice(1),identity={session:'fixture',epoch:1};
    const registry=new PluginRegistry(path.join(root,'bundled'),path.join(root,'data'),{request:async()=>({ok:true,result:{released:true},...identity})},()=>identity,()=>{},path.join(root,'artifacts-'+key));
    await registry.initialize();registry.attach();registry.observe({ok:true,result:{paused:false,system:'Game Boy',synthetic:false,capabilities:[]},...identity});
    const token=registry.catalog().plugins.find(p=>p.manifest?.id==='test.shared').lease.token;registry.finish(token);
    fs.writeFileSync(path.join(root,'ready-'+key),'');while(!fs.existsSync(path.join(root,'go')))await new Promise(r=>setTimeout(r,5));
    await registry.enable('test.'+key,true);
    for(let n=0;n<5;n++)await registry.storage(token,'set',key+'_'+n,n);
    await registry.close();`;
  const jobs=['one','two'].map(key=>subprocess(source,[root,key]));
  await until(()=>['one','two'].every(key=>fs.existsSync(path.join(root,'ready-'+key))));fs.writeFileSync(path.join(root,'go'),'');await Promise.all(jobs);
  const saved=JSON.parse(fs.readFileSync(config));assert.deepEqual(saved.enabled.sort(),['test.one','test.shared','test.two']);assert.deepEqual(saved.future,{keep:true});
  const storage=JSON.parse(fs.readFileSync(path.join(data,'test.shared-v1.json')));assert.equal(Object.keys(storage).length,10);
  for(const key of ['one','two'])for(let n=0;n<5;n++)assert.equal(storage[key+'_'+n],n);
});
test('disconnected external settings requests cannot commit after waiting for the transaction',async t=>{
  const {LocalServiceHost,LocalServiceClient}=await import('../dist/services/local-endpoint.js');
  const root=fixture(t),file=path.join(root,'preferences.json'),store=new SettingsStore(file,descriptors);
  let entered,finished;const queued=new Promise(r=>entered=r),completed=new Promise(r=>finished=r);
  const host=new LocalServiceHost({request:async()=>({ok:true,result:{released:true}})},async(params,guard)=>{
    entered();try{return await store.set('live',params.value,guard);}finally{finished();}
  });
  const connection=await host.listen(path.join(root,'ipc')),client=new LocalServiceClient(connection,host.instance);
  t.after(()=>host.close());t.after(()=>client.close());
  const lock=await KernelLock.acquire(path.join(root,'.settings-locks','preferences.json.lock'));
  t.after(()=>lock.release());
  const response=client.manage({operation:'settings',value:17}).catch(error=>error);
  await queued;client.close();await response;
  await until(()=>host.sockets.size===0);
  await lock.release();await completed;
  assert(!fs.existsSync(file));assert.equal(store.catalog().entries[0].value,0);
});
