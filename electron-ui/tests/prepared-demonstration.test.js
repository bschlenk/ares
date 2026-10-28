import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {InputClips,heldButtons} from '../dist/services/input-clips.js';
test('prepared demonstration loads, writes, snapshots and arms under durable ownership; Stop publishes bundle',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ares-prepared-'));const service=new InputClips();
 const calls=[];let state='idle',owner;
 const status=()=>({job_id:1,state,prompt:'test',source:'human',port:1,epoch:2,start_frame:0,end_frame:1,duration_frames:1,events:1,cursor:0,complete:true,overflow:false,stop_reason:'requested',rom_sha256:'a'.repeat(64),session:'test',state_sha256:'b'.repeat(64),boundary:'n64_si_gamepad_read',axis_convention:'signed_8bit_after_gate',rate:'vi_relative_variable_latches',version:1});
 const client={request:async(method,identity,p,who)=>{
  calls.push([method,p,who]);let result={};
  if(method==='n64.state.layout')result={size:8388608};
  if(method==='state.load')result={epoch:2};
  if(method==='n64.demo.handoff')owner=p.owner;
  if(method==='state.save')result={path:p.path,sha256:'b'.repeat(64)};
  if(method==='n64.demo.request')state='armed';
  if(method.startsWith('n64.demo.')){result=method==='n64.demo.read'?{status:status(),events:p.offset?[]:[{sequence:0,frame:0,port:1,raw:0x80000000,buttons:0x8000,x:0,y:0}]}:status();if(method!=='n64.demo.handoff')owner=who;}
  return {ok:true,result,session:'test',epoch:method==='session.pause'?1:2};
 }};
 try{
  const result=await service.run(client,{session:'test',epoch:1},'artifact.inputRequest',{initialStatePath:'/state',outputDirectory:path.join(dir,'recording'),prompt:'test',port:1,source:'human',maxFrames:60,timeoutMs:5000,setup:[{address:'0x80000010',hex:'01'},{address:'0x80000011',hex:'02'}]},'caller',()=>true);
  assert.deepEqual(calls.slice(3,10).map(c=>c[0]),['session.pause','state.load','n64.state.layout','n64.memory.write','n64.memory.write','state.save','n64.demo.request']);
  assert(owner.startsWith('human-'));assert.equal(service.ownerFor('caller'),owner);assert.equal(result.publication,'waiting');
  state='ready';
  for(let n=0;n<100&&service.metadata(1).publication!=='committed';++n)await new Promise(r=>setTimeout(r,20));
  assert.equal(service.metadata(1).publication,'committed');
  const clip=JSON.parse(await fs.readFile(path.join(dir,'recording/input.json'),'utf8'));assert.deepEqual(clip.events[0].held,['a']);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'recording/manifest.json'),'utf8')).initial_state.sha256,'b'.repeat(64));
  assert.deepEqual(heldButtons(0x4100),['b','right']);
 }finally{service.close();await fs.rm(dir,{recursive:true,force:true});}
});
