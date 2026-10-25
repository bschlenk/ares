const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {validRspTaskResult}=require('../dist/services/task-contracts.js'),{decodeReply}=require('../dist/services/contracts.js');
for(const [mode,verified,reason] of [['--yield',true,null],['--yield-mutated',false,'no_matching_yield_dma'],['--yield-entry-mutated',false,'restored_dmem_rewritten']])test('actual F3DEX2 yield/restore and rendered state under both executors: '+mode,()=>{
 const fixture=process.env.ARES_MATRIX_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-matrix-fixture');
 const output=execFileSync(fixture,[path.resolve(__dirname,'fixtures/f3dex2-2.04h'),mode],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});assert.match(output,/MATRIX_STACK_FIXTURE_PASS/);
 const pages=prefix=>output.split('\n').filter(l=>l.startsWith(prefix+' ')).map(l=>JSON.parse(l.slice(prefix.length+1)));
 const before=pages('YIELDED_TASK_JSON'),after=pages('RESUMED_TASK_JSON');assert.equal(before.length,2);assert.equal(after.length,2);
 for(let i=0;i<2;i++){
  for(const p of [before[i],after[i]]){assert(validRspTaskResult(p));decodeReply(JSON.stringify({protocol:1,id:'yield',session:'fixture',epoch:1,ok:true,result:p}),'n64.rsp.lastTask');}
  const a=before[i].task,b=after[i].task;assert(a.yield_capture.verified);assert.equal(a.yield_capture.bytes,3072);assert.match(a.yield_capture.sha256,/^[a-f0-9]{64}$/);assert.notEqual(a.task_id,b.task_id);assert.equal(b.resume_reason,reason);
  assert.equal(b.resume_mapping,verified?'verified_f3dex2_yield_dma':'unverified');assert.equal(b.resume_from,verified?a.task_id:null);assert.equal(b.logical_task_id,verified?a.logical_task_id:b.task_id);assert.equal(a.resumed_by,verified?b.task_id:null);
 }
 assert.equal(before[0].task.yield_capture.sha256,before[1].task.yield_capture.sha256,'identical actual yield bytes under interpreter and JIT');
 if(verified){const replay=pages('REPLAY_TASK_JSON');assert.equal(replay.length,2);for(const p of replay){assert(validRspTaskResult(p));assert.equal(p.task.resume_mapping,'unverified');assert.equal(p.task.resume_from,null);}}
 const pixels=output.split('\n').filter(l=>l.startsWith('MATRIX_PIXELS ')).map(l=>Number(l.slice(14)));assert.equal(pixels.length,2);assert(pixels.every(p=>p>20));assert.equal(pixels[0],pixels[1]);
});
