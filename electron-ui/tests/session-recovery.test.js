import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SessionRepository} from '../dist/sessions/repository.js';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
import {ScopedCheckpointLibrary} from '../dist/services/scoped-checkpoint-library.js';
import {Checkpoints} from '../dist/services/checkpoints.js';
const repositoryURL=new URL('../dist/sessions/repository.js',import.meta.url).href;
const libraryURL=new URL('../dist/services/checkpoint-library.js',import.meta.url).href;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ares-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const personal=path.join(root,'personal');fs.mkdirSync(personal);return {root,personal:fs.realpathSync(personal),repository:new SessionRepository(personal)};}
function child(source,args=[]){const processChild=spawn(process.execPath,['--input-type=module','-e',source,...args],{stdio:['pipe','pipe','pipe']});let output='';for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',data=>output+=data);return {child:processChild,closed:once(processChild,'close'),output:()=>output};}
const game={hash:'a'.repeat(64),system:'Game Boy',title:'Fixture'};
const capture=(i=0)=>({state:Buffer.from([i,2,3]),screenshot:Buffer.from([4,5,6]),capturedAt:new Date(1760000000000+i*1000),compatibility:{configuration:'fixture'}});
const library=root=>new CheckpointLibrary(root,file=>fs.promises.rm(file,{recursive:true}));
test('source collisions, read-only inherited entries, local retention and explicit compatibility checks',async t=>{
  const {root}=fixture(t),personal=library(path.join(root,'states')),local=library(path.join(root,'local'));
  const inherited=await personal.publish(game,capture(),false),own=await local.publish(game,capture(),false);
  assert.equal(inherited.id,own.id);
  const scoped=new ScopedCheckpointLibrary(local,personal),entries=await scoped.list(game);
  assert.deepEqual(entries.map(e=>e.origin),['session','personal']);assert.equal(new Set(entries.map(e=>e.reference)).size,2);
  assert.equal((await new ScopedCheckpointLibrary(personal).list(game)).length,1);
  const ref=entries.find(e=>!e.writable).reference;
  assert.throws(()=>scoped.delete(game,ref),/read_only/);assert.throws(()=>scoped.rename(game,ref,'bad'),/read_only/);assert.throws(()=>scoped.read(game,own.id),/reference/);
  assert.equal((await scoped.read(game,ref)).state[0],0);
  for(let i=1;i<14;i++)await scoped.publish(game,capture(i),false);
  assert.equal((await local.list(game)).length,10);assert.equal((await personal.list(game)).length,1);
  const controller=new Checkpoints({request(){throw new Error('must not reach native')}},game,()=>({session:'s',epoch:1}),()=>true,()=>({configuration:'different'}));
  await assert.rejects(controller.load(scoped,ref),/configuration_mismatch/);
  await assert.rejects(scoped.read({...game,hash:'b'.repeat(64)},ref));
  const directory=await personal.revealPath(game,inherited.id);fs.writeFileSync(path.join(directory,`${inherited.id}.state`),'bad');
  await assert.rejects(scoped.read(game,ref),/integrity_failed/);
});
test('personal verified read survives concurrent subprocess deletion after read transaction',async t=>{
  const {root}=fixture(t),personal=library(path.join(root,'states')),entry=await personal.publish(game,capture(),true);
  const read=await new ScopedCheckpointLibrary(library(path.join(root,'local')),personal).read(game,`personal:${entry.id}`);
  const deleting=child(`import fs from 'node:fs/promises';import {CheckpointLibrary} from ${JSON.stringify(libraryURL)};await new CheckpointLibrary(process.argv[1],f=>fs.rm(f,{recursive:true})).delete(JSON.parse(process.argv[2]),process.argv[3]);`,[personal.root,JSON.stringify(game),entry.id]);
  assert.equal((await deleting.closed)[0],0,deleting.output());assert.deepEqual(read.state,Buffer.from([0,2,3]));assert.equal((await personal.list(game)).length,0);
});
test('reset policies, restore rebasing, immutable archives and personal bytes',async t=>{
  const {personal,repository}=fixture(t),prefs=path.join(personal,'preferences.json'),bml=path.join(personal,'settings.bml');
  const original=JSON.stringify({version:1,values:{'presentation.theme':'paper'}});fs.writeFileSync(prefs,original);fs.writeFileSync(bml,'Video\n  Driver: OpenGL\n');
  let opened=await repository.open('work'),first=opened.context.dataRoot;fs.writeFileSync(path.join(first,'marker'),'previous');await opened.lock.release();
  await repository.replace('work','fresh');opened=await repository.open('work');
  const empty=opened.context.dataRoot,data=JSON.parse(fs.readFileSync(path.join(empty,'data.json'))),values=JSON.parse(fs.readFileSync(path.join(empty,'preferences.json'))).values;
  assert.equal(data.policy,'fresh');assert.deepEqual(data.initialized,{});assert.equal(values['presentation.theme'],undefined);assert.equal(fs.existsSync(path.join(empty,'settings.bml')),false);assert.equal(data.personalStates,path.join(personal,'states'));
  fs.writeFileSync(path.join(empty,'marker'),'displaced');await opened.lock.release();
  const archive=(await repository.archives('work'))[0];await repository.replace('work','restore',archive.id);
  opened=await repository.open('work');const restored=opened.context.dataRoot;assert.equal(fs.readFileSync(path.join(restored,'marker'),'utf8'),'previous');assert.notEqual(restored,first);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored,'preferences.json'))).values['states.root'],path.join(restored,'states'));await opened.lock.release();
  assert.equal((await repository.archives('work')).length,2);assert.equal(fs.readFileSync(path.join(empty,'marker'),'utf8'),'displaced');assert.equal(fs.readFileSync(path.join(first,'marker'),'utf8'),'previous');
  await repository.replace('work','inherit-personal');opened=await repository.open('work');assert.equal(JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot,'data.json'))).policy,'inherit-personal');assert.equal(JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot,'preferences.json'))).values['presentation.theme'],'paper');await opened.lock.release();
  assert.equal(fs.readFileSync(prefs,'utf8'),original);assert.equal(fs.readFileSync(bml,'utf8'),'Video\n  Driver: OpenGL\n');
});
test('lifecycle ownership refuses reset and restore across processes without services',async t=>{
  const {personal,repository}=fixture(t);await repository.resolve('work');
  const running=child(`import {SessionRepository} from ${JSON.stringify(repositoryURL)};const o=await new SessionRepository(process.argv[1]).open('work');console.log('ready');process.stdin.resume();`,[personal]);
  t.after(()=>running.child.kill('SIGKILL'));await once(running.child.stdout,'data');
  for(const mode of ['fresh','inherit-personal','restore'])await assert.rejects(repository.replace('work',mode),/session_running/);
  assert.equal((await repository.archives('work')).length,0);running.child.kill('SIGKILL');await running.closed;
  await repository.replace('work','fresh');
});
test('SIGKILL reset and restore boundaries preserve valid active and displaced generations',async t=>{
  for(const mode of ['fresh','restore'])for(const point of ['replacement-staged','replacement-intent','archive-published','replacement-published']){
    const {personal,repository}=fixture(t);let opened=await repository.open('work');const original=opened.context.dataRoot;fs.writeFileSync(path.join(original,'marker'),'original');await opened.lock.release();
    let archiveId='';
    if(mode==='restore'){await repository.replace('work','fresh');archiveId=(await repository.archives('work'))[0].id;opened=await repository.open('work');fs.writeFileSync(path.join(opened.context.dataRoot,'marker'),'current');await opened.lock.release();}
    const before=repository.manifest((await repository.resolve('work')).id);
    const crashed=child(`import {SessionRepository} from ${JSON.stringify(repositoryURL)};await new SessionRepository(process.argv[1],p=>{if(p===process.argv[2])process.kill(process.pid,'SIGKILL')}).replace('work',process.argv[3],process.argv[4]);`,[personal,point,mode,archiveId]);
    assert.equal((await crashed.closed)[1],'SIGKILL',crashed.output());
    opened=await repository.open('work');const active=repository.manifest(before.id);assert.ok(fs.existsSync(path.join(opened.context.dataRoot,'data.json')));
    if(point==='replacement-staged')assert.equal(active.generation,before.generation);
    else {assert.notEqual(active.generation,before.generation);assert.ok((await repository.archives('work')).some(a=>a.generation===before.generation));if(mode==='restore')assert.equal(fs.readFileSync(path.join(opened.context.dataRoot,'marker'),'utf8'),'original');}
    assert.equal(fs.readFileSync(path.join(original,'marker'),'utf8'),'original');await opened.lock.release();
  }
});
test('persisted reset policy governs different later resources across reopen',async t=>{
  const {root,repository}=fixture(t);
  const {StorageCoordinator}=await import('../dist/sessions/storage.js');
  const coordinator=new StorageCoordinator(path.join(root,'coordination'));
  await repository.resolve('work');
  for(const mode of ['fresh','inherit-personal']){
    await repository.replace('work',mode);
    for(let i=0;i<2;i++){
      const opened=await repository.open('work');
      try{
        const source=path.join(root,`${mode}-${i}.ram`);fs.writeFileSync(source,'personal');
        const reservation=await coordinator.reserve({version:1,resources:[{source,scope:'file'}]},opened.context,'fixture');
        try{await coordinator.initialize(reservation,opened.context);const destination=reservation.nativeResources()[0].destination;
          if(mode==='fresh')assert.equal(fs.existsSync(destination),false);else assert.equal(fs.readFileSync(destination,'utf8'),'personal');
        }finally{await reservation.release();}
      }finally{await opened.lock.release();}
    }
  }
});
test('restore rebases owned custom roots and interrupted storage journals, refusing symlink traversal',async t=>{
  const {root,repository}=fixture(t);const opened=await repository.open('work'),source=opened.context.dataRoot;
  const preferences=JSON.parse(fs.readFileSync(path.join(source,'preferences.json')));preferences.values['states.root']=path.join(source,'custom-states');fs.mkdirSync(path.join(source,'custom-states'),{mode:0o700});fs.writeFileSync(path.join(source,'preferences.json'),JSON.stringify(preferences));
  fs.mkdirSync(path.join(source,'storage'),{mode:0o700});fs.writeFileSync(path.join(source,'storage','initializing.json'),JSON.stringify({version:1,resources:[{id:'a'.repeat(64),source:path.join(root,'personal.ram'),destination:path.join(source,'storage','a'.repeat(64),'data'),staged:null}]}),{mode:0o600});
  await opened.lock.release();await repository.replace('work','fresh');const archive=(await repository.archives('work'))[0];await repository.replace('work','restore',archive.id);
  const current=await repository.open('work');try{
    assert.equal(JSON.parse(fs.readFileSync(path.join(current.context.dataRoot,'preferences.json'))).values['states.root'],path.join(current.context.dataRoot,'custom-states'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(current.context.dataRoot,'storage','initializing.json'))).resources[0].destination,path.join(current.context.dataRoot,'storage','a'.repeat(64),'data'));
  }finally{await current.lock.release();}
  fs.symlinkSync(root,path.join(source,'external'));const before=repository.manifest(current.context.sessionId);
  await assert.rejects(repository.replace('work','restore',archive.id),/invalid_generation_file/);assert.deepEqual(repository.manifest(before.id),before);
});
test('managed native transfer retains external owner and checks authorization after verified disk read',async()=>{
  const identity={session:'s',epoch:1},owners=[];
  const client={async request(method,_identity,_params,owner){owners.push(owner);return {ok:true,result:method==='checkpoint.upload'?{id:1}:method==='checkpoint.write'?{written:3}:method==='checkpoint.commit'?{loaded:true}:{released:true}};}};
  let allowed=true;const controller=new Checkpoints(client,game,()=>identity,()=>true,()=>({configuration:'fixture'})).forOwner('lease-owner',()=>{if(!allowed)throw new Error('not_authorized');});
  const stored={state:Buffer.from([1,2,3]),metadata:{compatibility:{configuration:'fixture'}}};
  await controller.load({read:async()=>stored},'personal:opaque');assert.ok(owners.length>=4);assert.ok(owners.every(owner=>owner==='lease-owner'));
  owners.length=0;await assert.rejects(controller.load({read:async()=>{allowed=false;return stored;}},'personal:opaque'),/not_authorized/);assert.equal(owners.length,0);
});
test('CLI offline reset/list/restore works with no service or app launch',async t=>{
  const {root,personal,repository}=fixture(t);await repository.resolve('work');
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const cli=new URL('../dist/cli.js',import.meta.url).pathname,serviceDirectory=path.join(root,'no-services');
  const call=async(tool,extra=[])=>JSON.parse((await promisify(execFile)(process.execPath,[cli,'call',tool,'--personal_root',personal,'--name','work',...extra],{env:{...process.env,ARES_SERVICE_DIR:serviceDirectory},timeout:10000})).stdout);
  const reset=await call('session_reset',['--mode','fresh']);assert.equal(reset.name,'work');
  const archives=await call('session_archives');assert.equal(archives.length,1);
  await call('session_restore',['--archive_id',archives[0].id]);assert.equal((await repository.archives('work')).length,2);assert.equal(fs.existsSync(serviceDirectory),false);
});
