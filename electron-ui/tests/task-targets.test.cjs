const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {validRspTaskResult}=require('../dist/services/task-contracts.js');
test('real rasterized triple buffers, same-frame writers and CPU rewrites retain explicit candidate ambiguity',()=>{
 const fixture=process.env.ARES_MATRIX_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-matrix-fixture');
 const output=execFileSync(fixture,[path.resolve(__dirname,'fixtures/f3dex2-2.04h'),'--targets'],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 assert.match(output,/TASK_TARGETS_INTERPRETER_PASS/);assert.match(output,/TASK_TARGETS_JIT_PASS/);
 const pages=output.split('\n').filter(l=>l.startsWith('TARGETS_JSON ')).map(l=>JSON.parse(l.slice(13)));assert.equal(pages.length,2);
 for(const page of pages){assert(validRspTaskResult(page));assert.equal(page.epoch,2);const scans=page.scanouts;assert.equal(scans.length,7);assert(scans.every(s=>s.mapping==='candidate_only'));assert.equal(scans[0].origin,scans[3].origin);assert.notEqual(scans[0].origin_commit,scans[3].origin_commit);assert.equal(scans[4].task_candidates.length,2);assert.equal(scans[4].frame,scans[3].frame);assert.deepEqual(scans[5].task_candidates,scans[4].task_candidates);assert.deepEqual(scans[6].task_candidates,[]);}
});
