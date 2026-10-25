const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {validTransformPage}=require('../dist/services/transform-contracts.js');
const {encodeRequest,decodeReply}=require('../dist/services/contracts.js');
test('compact frozen transforms retain actual vertex-load state, bound paging and survive capture advancement',async()=>{
 const fixture=process.env.ARES_MATRIX_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-matrix-fixture');
 const output=execFileSync(fixture,[path.resolve(__dirname,'fixtures/f3dex2-2.04h')],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 const pages=output.split('\n').filter(s=>s.startsWith('TRANSFORM_JSON ')).map(s=>JSON.parse(s.slice(15)));assert.equal(pages.length,2);
 const {matrix,projectState,describeCapture,bindCapture,readCapture}=await import('../examples/kirby-skeleton/skeleton.js');
 for(const p of pages){assert(validTransformPage(p));decodeReply(JSON.stringify({protocol:1,id:'transforms',session:'fixture',epoch:1,ok:true,result:p}),'n64.capture.transforms');
  const row=p.entries.find(r=>r.word1==='0x1000080');assert(row);assert.equal(matrix(row.state.modelview_raw)[12],6.375);assert(row.vertex_state);assert.equal(row.vertex_batches,1);assert.equal(matrix(row.vertex_state.combined_raw)[12],.19921875);assert.equal(row.state.viewport_raw,'00000000000000000000000000000000');assert.equal(projectState(row.vertex_state,true).x,38.375);assert.equal(projectState(row.vertex_state,true).y,30.75);
  const sample={frame:{...p.frame_reference,task_candidates:[row.task_id]},value:{kirby:[6.375,1.25,.125]}};assert(bindCapture(p,sample));const scene=describeCapture(p,sample);assert(scene.matched);assert(scene.objects.some(o=>o.joints.some(j=>j.vertexBatches===1&&j.screen.x===38.375)));assert.equal(describeCapture(p,{...sample,frame:{...sample.frame,origin_commit:999}}).matched,false);
  const withoutCandidates=describeCapture(p,{...sample,frame:{...sample.frame,task_candidates:[]}});assert.equal(withoutCandidates.objects.length,0);
  const fetched=await readCapture(async(_method,params)=>({...p,offset:params.offset,entries:p.entries.slice(params.offset,params.offset+2),next_offset:params.offset+2<p.entries.length?params.offset+2:null}),p.generation);assert.deepEqual(fetched.entries,p.entries);
  await assert.rejects(readCapture(async(_method,params)=>params.offset?{...p,generation:p.generation+1,entries:[],next_offset:null}:{...p,entries:p.entries.slice(0,1),next_offset:1},p.generation),/inconsistent_capture/);
 }
 const repeated=output.split('\n').filter(s=>s.startsWith('REPEAT_TRANSFORM_JSON ')).map(s=>JSON.parse(s.slice(22)));assert.equal(repeated.length,2);for(let i=0;i<2;i++){assert(validTransformPage(repeated[i]));assert.deepEqual(repeated[i].entries,pages[i].entries);assert.equal(repeated[i].frame_reference.vi,pages[i].frame_reference.vi+1);assert.equal(repeated[i].frame_reference.origin_commit,pages[i].frame_reference.origin_commit+1);assert.equal(repeated[i].frame_reference.origin,pages[i].frame_reference.origin);}
 const limits=output.split('\n').filter(s=>s.startsWith('TRANSFORM_LIMIT_JSON ')).map(s=>JSON.parse(s.slice(21)));assert.equal(limits.length,2);for(const p of limits){assert(validTransformPage(p));assert.equal(p.retained,256);assert.equal(p.dropped,44);assert(p.truncated);assert(p.entries.every(r=>!r.command_complete&&r.state===null));}
 const identity={session:'fixture',epoch:1};for(const p of [{generation:0,offset:0,limit:1},{generation:null,offset:257,limit:1},{generation:null,offset:0,limit:33}])assert.throws(()=>encodeRequest('x',identity,'n64.capture.transforms',p),/invalid_request/);
});
