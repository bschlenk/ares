import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {SessionRouter} from '../dist/services/session-router.js';
import {ExternalAccessController,externalWork} from '../dist/services/external-access.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.result;};
test('native revoke barrier stops scripts, nested batches, observers and recordings while preserving a human observer', {timeout:20000},async()=>{
 const root=fs.mkdtempSync('/tmp/ares-access-native-');const child=spawn(process.env.ARES_HOST??path.resolve(import.meta.dirname,'../../build_macos/workbench/bin/ares-electron-host'),['--synthetic','--paused','--silent','--save-dir',root,'--control-session','access-test'],{stdio:['pipe','pipe','pipe','pipe']});
 const closed=once(child,'close');child.stdout.resume();child.stderr.resume();const native=new NativeSessionClient(child.stdin,child.stdio[3],{session:'access-test',epoch:1},()=>{}),router=new SessionRouter();router.attach(native);const access=new ExternalAccessController('test',false);
 const grant=()=>{access.request('client');access.decide(true);return access.capture();};const revoke=()=>access.revoke(()=>router.revokeExternal());
 const request=(method,params,owner='ext-one')=>router.request(method,undefined,params,owner);
 try{
  let guard=grant();
  const observerParams={source:'export default({emu})=>emu.info().frame',args:{},timeoutMs:10000,maxFrames:0,push:true,every:1,boundary:'frame'};
  // Use the established default observer boundary to exercise native ownership.
  delete observerParams.boundary;
  const human=unwrap(await request('scripts.observe',observerParams,'plugin-human'));
  const observer=unwrap(await externalWork.run({guard},()=>request('scripts.observe',observerParams)));
  unwrap(await externalWork.run({guard},()=>request('video.record.start',{maxFrames:36000,maxBytes:1048576,fps:60,timeoutMs:60000,discard:false})));
  const script=unwrap(await externalWork.run({guard},()=>request('scripts.run',{source:'export default async({frames})=>{await frames(1000000);return 1}',args:{},timeoutMs:10000,maxFrames:1000000})));
  await revoke();assert.equal(unwrap(await native.request('session.status')).paused,true);
  const completed=unwrap(await native.request('execution.status',undefined,{operationId:script.operation_id},'ui'));assert.equal(completed.state,'done');
  assert.equal(unwrap(await native.request('video.record.status')).available,false);
  assert.equal((await native.request('script.observerRead',undefined,{observerId:observer.observer_id,offset:0,length:16},'ext-one')).ok,false);
  assert.equal((await native.request('script.observerRead',undefined,{observerId:human.observer_id,offset:0,length:16},'plugin-human')).ok,true);
  guard=grant();
  const batch=externalWork.run({guard},()=>request('experiment.batch',{steps:[{kind:'run',n:1000000}],timeoutMs:10000,stopOnError:true}));
  for(let i=0;i<200;i++){if(unwrap(await native.request('session.status')).operation_id)break;await sleep(5);}
  assert(unwrap(await native.request('session.status')).operation_id,'batch child must be running before revoke');
  await revoke();await batch;const before=unwrap(await native.request('session.status'));assert.equal(before.paused,true);assert.equal(before.operation_id,null);await sleep(50);assert.equal(unwrap(await native.request('session.status')).frame,before.frame);
 }finally{access.close();router.detach();child.kill('SIGTERM');await closed;fs.rmSync(root,{recursive:true,force:true});}
});
