import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
import {checkpointStem,formatCheckpoint,validateCheckpointFormat,DEFAULT_CHECKPOINT_FORMAT} from '../dist/services/checkpoint-format.js';
const game={hash:'a'.repeat(64),system:'Game Boy',title:'Kirby (USA)'};
const capture=(instant='2026-10-28T22:05:00.123-04:00',byte=1)=>({state:Buffer.from([byte,2,3]),screenshot:Buffer.from([4,5,6]),capturedAt:new Date(instant),compatibility:{version:'fixture'}});
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ares-checkpoints-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const trashed=[];return {root,trashed,library:new CheckpointLibrary(root,async file=>{trashed.push(file);await fs.rm(file,{recursive:true})})};}
test('same-second saves, immutable association, title discovery, promotion and root switching',async t=>{
  const {root,library}=await setup(t);
  const entries=await Promise.all(Array.from({length:15},(_,i)=>library.publish(game,capture(undefined,i),true)));
  assert.equal(new Set(entries.map(e=>e.id)).size,15);
  assert.deepEqual((await fs.readdir(await library.revealPath(game,entries[0].id))).sort(),['json','png','state'].map(extension=>`${entries[0].id}.${extension}`));
  assert.equal((await library.list({...game,title:'New title'})).length,15);
  assert.equal((await fs.readdir(root)).length,1);
  await library.rename(game,entries[0].id,'Checkpoint');await library.rename(game,entries[1].id,'Checkpoint');
  assert.equal((await library.list(game)).filter(e=>e.name==='Checkpoint').length,2);
  assert.equal((await library.read(game,entries[0].id)).state[0],0);
  const auto=await library.publish(game,capture('2026-10-28T23:00:00Z'),false);
  await library.rename(game,auto.id,'Promoted');await library.rename(game,auto.id,'');
  assert.equal((await library.list(game)).find(e=>e.id===auto.id).permanent,true);
  const other=new CheckpointLibrary(path.join(root,'other'),async()=>{});
  assert.deepEqual(await other.list(game),[]);assert.equal((await library.list(game)).length,16);
  await assert.rejects(library.read({...game,hash:'b'.repeat(64)},entries[0].id));
  await assert.rejects(library.read(game,'../metadata.json'));
});
test('retention follows precise instants across offsets and never deletes promoted/manual saves',async t=>{
  const {library,trashed}=await setup(t);
  const permanent=await library.publish(game,capture(),true);
  const promoted=await library.publish(game,capture('2026-10-28T20:00:00Z'),false);await library.rename(game,promoted.id,'Keep');
  for(let i=0;i<11;i++)await library.publish(game,capture(new Date(Date.UTC(2026,9,28,21,i)).toISOString()),false);
  const entries=await library.list(game);
  assert.equal(entries.filter(e=>!e.permanent).length,10);assert.equal(entries.filter(e=>e.permanent).length,2);assert.equal(trashed.length,1);
  assert.ok(entries.some(e=>e.id===permanent.id));assert.ok(entries.some(e=>e.id===promoted.id));
  assert.ok(Date.parse(entries.filter(e=>!e.permanent)[0].capturedAt)>Date.parse(entries.filter(e=>!e.permanent).at(-1).capturedAt));
  await library.delete(game,permanent.id);assert.equal(trashed.length,2);
});
test('failed publication and orphan staging never appear or prune history; load checks integrity',async t=>{
  const {library,root,trashed}=await setup(t);
  const first=await library.publish(game,capture(),false);
  let calls=0;await assert.rejects(library.publish(game,capture(),false,()=>{if(++calls===4)throw new Error('disk failed')}),/disk failed/);
  assert.equal((await library.list(game)).length,1);assert.equal(trashed.length,0);
  const folder=path.join(root,(await fs.readdir(root))[0]);await fs.mkdir(path.join(folder,'.pending-orphan'));
  assert.equal((await library.list(game)).length,1);
  await fs.writeFile(path.join(folder,first.id,`${first.id}.state`),Buffer.from([9,9,9]));
  await assert.rejects(library.read(game,first.id),/integrity/);
});
test('unavailable storage preserves existing root; timestamps and directives are explicit',async t=>{
  const {root}=await setup(t);const file=path.join(root,'file');await fs.writeFile(file,'x');
  await assert.rejects(new CheckpointLibrary(file,async()=>{}).publish(game,capture(),false));
  assert.match(checkpointStem(new Date('2026-10-28T22:05:00-04:00')), /^2026-10-\d{2}T\d{2}-05-00[+-]\d{4}$/);
  assert.equal(validateCheckpointFormat('%Q'),'Unsupported directive: %Q');assert.equal(validateCheckpointFormat('%'),'Unsupported directive: %');
  assert.equal(validateCheckpointFormat(DEFAULT_CHECKPOINT_FORMAT),null);
  assert.equal(formatCheckpoint(new Date(2026,9,28,22,5)),'Oct 28, 2026 @ 10:05 PM');
  assert.equal(formatCheckpoint(new Date(2026,9,28,0,5),'%% %Y-%m-%d %H:%M:%S %I %p'),'% 2026-10-28 00:05:00 12 AM');
});
test('screenshot and metadata write faults preserve ten autosaves and clean unpublished artifacts',async t=>{
  const {library,root,trashed}=await setup(t);
  for(let i=0;i<10;i++)await library.publish(game,capture(new Date(Date.UTC(2026,9,28,21,i)).toISOString()),false);
  const before=(await library.list(game)).map(e=>e.id),open=fs.open;
  for(const failed of ['screenshot.png','metadata.json']){
    fs.open=async(file,...args)=>{if(path.basename(file)===failed)throw Object.assign(new Error('simulated full device'),{code:'ENOSPC'});return open(file,...args)};
    try{await assert.rejects(library.publish(game,capture(),false),/full device/)}finally{fs.open=open}
    assert.deepEqual((await library.list(game)).map(e=>e.id),before);assert.equal(trashed.length,0);
  }
  const collection=path.join(root,(await fs.readdir(root))[0]);assert.equal((await fs.readdir(collection)).some(name=>name.startsWith('.pending-')),false);
});
test('native raster dimensions and display aspect survive metadata-only rename',async t=>{
  const {library}=await setup(t),data={...capture(),screenshotGeometry:{width:564,height:242,aspect:4/3}};
  const saved=await library.publish(game,data,true);await library.rename(game,saved.id,'Wide-raster game');
  const entry=(await library.list(game))[0];assert.equal(entry.screenshot.width,564);assert.equal(entry.screenshot.height,242);assert.equal(entry.screenshot.aspect,4/3);
  assert.equal(entry.screenshot.sha256,saved.screenshot.sha256);assert.equal(entry.state.sha256,saved.state.sha256);
});
