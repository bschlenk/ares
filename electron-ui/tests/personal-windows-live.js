import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import electron from 'electron';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {snapshotCheckout, launchPlan} from '../dist/sessions/launching.js';
import {managementRoot} from '../dist/sessions/context.js';
import {makeFixture} from '../fixture.cjs';
const root=fs.realpathSync(fs.mkdtempSync('/tmp/ares-personal-live-')),profile=path.join(root,'profile'),ipc=path.join(root,'ipc'),children=[],clients=[];
fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'storage-routing.json'),JSON.stringify({version:1,directory:'custom'}),{mode:0o600});
const original=JSON.stringify({version:1,values:{'presentation.theme':'green','agent.enabled':true,'unknown.plugin':7}});
fs.writeFileSync(path.join(profile,'preferences.json'),original);
let seq=0;const connectionClients=new Map(),personalPids=new Set();
function launch(name, installation) {
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ARES_')&&key!=='ARES_HOST')delete env[key];
  if(installation)Object.assign(env,installation.env);
  Object.assign(env,{ARES_PROFILE_DIR:profile,ARES_SERVICE_DIR:ipc,ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0',ARES_ENABLE_SERVICES:'1',ARES_SILENT:'1'});
  const child=spawn(electron,[installation?path.join(installation.args[0],'tests/electron-personal-windows.js'):new URL('./electron-personal-windows.js',import.meta.url).pathname,...(name?['--session-name',name]:[])],{env,stdio:['ignore','pipe','pipe','ipc']});
  const result={child,closed:once(child,'close'),log:''};for(const stream of [child.stdout,child.stderr])stream.on('data',v=>result.log+=v);children.push(result);return result;
}
async function until(check) {for(let n=0;n<600;n++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('personal window timeout: '+children.map(c=>c.log).join('\n'));}
function call(result,message){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{result.child.off('message',listener);reject(Error('harness timeout'));},15000);const listener=value=>{if(value.id!==id)return;clearTimeout(timer);result.child.off('message',listener);value.error?reject(Error(value.error)):resolve(value);};result.child.on('message',listener);result.child.send({id,...message});});}
async function connections(){
  const rows=[];if(!fs.existsSync(ipc))return rows;
  for(const file of fs.readdirSync(ipc).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){
    let c=connectionClients.get(file);
    if(!c){c=new LocalServiceClient(path.join(ipc,file),file.slice(0,-5),1000);connectionClients.set(file,c);clients.push(c);}
    try{const s=await c.manage({operation:'app_status'});if(s.ready){rows.push({client:c,...s});if(s.kind==='personal')personalPids.add(s.pid);}}catch{}
  }
  return rows;
}
function rom(name){const bytes=makeFixture();bytes[0x134]=name==='b.gb'?0x42:0x41;bytes[0x147]=3;bytes[0x149]=2;let sum=0;for(let i=0x134;i<=0x14c;i++)sum=(sum-bytes[i]-1)&255;bytes[0x14d]=sum;const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file;}
const timeout=setTimeout(()=>{for(const c of children)c.child.kill('SIGKILL');},90000);
let personal=[];
try {
  const sourceDirectory=path.join(root,'source-launch');fs.mkdirSync(sourceDirectory);
  const installation={appRoot:new URL('../',import.meta.url).pathname,executable:electron,packaged:false};
  const sourcePlan=launchPlan(installation,profile);snapshotCheckout(installation,sourcePlan,sourceDirectory);
  // Simulate Allow in this disposable installation and its New Window copies.
  // Production startup has no auto-approval switch or fixture hook.
  fs.appendFileSync(path.join(sourcePlan.args[0],'dist/main.js'),`\napp.whenReady().then(()=>{if(appContext.kind==='personal'){externalAccess.request('personal-windows-fixture');externalAccess.decide(true);}});\n`);
  fs.mkdirSync(path.join(sourcePlan.args[0],'tests'));fs.copyFileSync(new URL('./electron-personal-windows.js',import.meta.url),path.join(sourcePlan.args[0],'tests/electron-personal-windows.js'));
  const named=launch('parent',sourcePlan);await until(()=>named.log.includes('PERSONAL_READY'));
  assert.equal((await connections()).filter(c=>c.kind==='personal').length,0);
  await call(named,{operation:'new'});await until(async()=>{personal=(await connections()).filter(c=>c.kind==='personal');return personal.length===1;});
  await call(named,{operation:'new'});await until(async()=>{personal=(await connections()).filter(c=>c.kind==='personal');return personal.length===2;});
  assert.notEqual(personal[0].pid,personal[1].pid);assert.notEqual(personal[0].instance,personal[1].instance);
  const instances=path.join(managementRoot(profile),'instances');
  for(const p of personal){assert(fs.existsSync(path.join(instances,p.instance,'browser')));assert.notEqual(p.session_name,'parent');}
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'storage-routing.json'))).directory,'custom');
  assert.equal(fs.readFileSync(path.join(profile,'preferences.json'),'utf8'),original,'window startup does not rewrite preferences');
  assert(!fs.existsSync(path.join(profile,'plugins','enabled.json')),'plugin startup does not rewrite configuration');
  const a=rom('a.gb'),b=rom('b.gb'),alias=rom('duplicate/a.gb');
  await personal[0].client.manage({operation:'load_rom',path:a,system:'Game Boy'});
  const old=await personal[1].client.manage({operation:'load_rom',path:b,system:'Game Boy'});
  await assert.rejects(personal[1].client.manage({operation:'load_rom',path:alias,system:'Game Boy'}),/storage_conflict/);
  const still=await personal[1].client.request('session.status');assert.equal(still.session,old.session,'conflict leaves the other game loaded');
  await personal[0].client.manage({operation:'provenance',enabled:true});
  await until(async()=>{const p=await personal[1].client.manage({operation:'provenance'});return p.enabled===true&&p.pending===false;});
  const namedClient=(await connections()).find(c=>c.kind==='named').client;
  assert.equal((await namedClient.manage({operation:'provenance'})).requested,false,'named settings remain independent');
  named.child.kill('SIGTERM');await named.closed;fs.rmSync(sourceDirectory,{recursive:true,force:true});
  for(const p of personal){const info=await p.client.manage({operation:'build_info'});assert(fs.existsSync(path.join(info.app_root,'dist/main.js')));assert(!info.app_root.startsWith(sourceDirectory));}
  await personal[0].client.manage({operation:'close_rom'});await personal[1].client.manage({operation:'load_rom',path:alias,system:'Game Boy'});
  await personal[1].client.manage({operation:'close_rom'});
  assert(fs.existsSync(path.join(profile,'custom','Game Boy','a.ram')));assert(!fs.existsSync(path.join(profile,'saves','Game Boy','a.ram')));
  // A third personal helper checks renderer delivery and native live application.
  const helper=launch();await until(()=>helper.log.includes('PERSONAL_READY'));
  const one=await call(helper,{operation:'snapshot'});assert.equal(one.theme,'green');
  await call(helper,{operation:'set',key:'presentation.theme',value:'paper'});
  await until(async()=>{const v=await call(helper,{operation:'snapshot'});return v.theme==='paper';});
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'))).values['unknown.plugin'],7);
  console.log('PERSONAL_WINDOWS_PASS: named-only New Window twice, private runtimes, contained routing, shared live settings, independent games, conflict preserves game, unload releases ownership, child runtimes survive parent installation removal');
}catch(error){console.error(error);const launches=path.join(managementRoot(profile),'launches');if(fs.existsSync(launches))for(const id of fs.readdirSync(launches))console.error(fs.readFileSync(path.join(launches,id,'launch.log'),'utf8'));process.exitCode=1;}
finally {
  clearTimeout(timeout);for(const c of clients)c.close();
  for(const pid of personalPids)try{process.kill(pid,'SIGTERM');}catch{}
  for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGTERM');
  await Promise.all(children.map(c=>c.closed));
  await until(()=>[...personalPids].every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}})).catch(()=>{});
  fs.rmSync(root,{recursive:true,force:true});
}
