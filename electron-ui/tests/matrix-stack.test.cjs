const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {validMatrixPage,validMatrixState,validDrawVertex}=require('../dist/services/matrix-contracts.js');
const {encodeRequest,decodeReply}=require('../dist/services/contracts.js');
const directory=path.resolve(__dirname,'fixtures/f3dex2-2.04h');
test('pinned real F3DEX2 fixture code/data have matching source identities',()=>{
 for(const [name,expected] of [['code.bin','d3a58568fa7cf042de370912a47c3b5f'],['data.bin','6639b2fd15a73c5446aff592bb599983']])assert.equal(createHash('md5').update(fs.readFileSync(path.join(directory,name))).digest('hex'),expected);
});
test('real microcode stack operations, transformed cached vertices and pixels agree under both executors',()=>{
 const fixture=process.env.ARES_MATRIX_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-matrix-fixture');
 const output=execFileSync(fixture,[directory],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});assert.match(output,/MATRIX_STACK_FIXTURE_PASS/);
 const pages=output.split('\n').filter(s=>s.startsWith('STACK_JSON ')).map(s=>JSON.parse(s.slice(11)));assert.equal(pages.length,4);
 for(const page of pages)assert(validMatrixPage(page));
 const runs=[{...pages[0],entries:[...pages[0].entries,...pages[1].entries]},{...pages[2],entries:[...pages[2].entries,...pages[3].entries]}];
 for(const page of [pages[0],pages[2]]){decodeReply(JSON.stringify({protocol:1,id:'matrix',session:'fixture',epoch:1,ok:true,result:page}),'n64.capture.matrices');const push=page.entries.find(s=>s.stack.depth===1);assert(push);assert.equal(push.stack.complete,true);assert.equal(push.modelview.values[12],6.375);assert.equal(push.modelview.values[13],1.25);assert.deepEqual(push.stack.saved[0].values,[1.5,0,0,0,0,-.5,0,0,0,0,1,0,0,0,0,1]);const vertexState=page.entries.find(s=>s.combined&&s.stack.depth===1);assert(vertexState);assert.equal(vertexState.combined.values[12],.19921875);assert.equal(vertexState.combined.values[13],.0390625);assert.deepEqual(vertexState.viewport.s16,[128,128,511,0,128,128,511,0]);}
 const vertices=output.split('\n').filter(s=>s.startsWith('VERTEX_JSON ')).map(s=>JSON.parse(s.slice(12)));assert.equal(vertices.length,6);assert(vertices.every(validDrawVertex));assert.deepEqual(vertices.slice(0,3),vertices.slice(3));assert.deepEqual(vertices.map(v=>v.clip_fixed).slice(0,3),[[-11520,10752,256,65536],[-11520,-5632,256,65536],[37632,-5632,256,65536]]);
 const normalized=p=>p.entries.map(({task_id,...s})=>s);assert.deepEqual(normalized(runs[0]),normalized(runs[1]));
 const invalid=structuredClone(pages[0].entries[0]);invalid.modelview.values[0]=99;assert.equal(validMatrixState(invalid),false);
 for(const run of runs){const rounded=run.entries.find(s=>s.modelview.fixed[0]===-131073);assert(rounded);assert.equal(rounded.modelview.fixed[5],131072);assert(run.entries.some(s=>s.stack.depth===0&&s.modelview.values[0]===2&&s.projection.values[0]===.0625));}
 const partial=output.split('\n').filter(s=>s.startsWith('PARTIAL_JSON ')).map(s=>JSON.parse(s.slice(13)));assert.equal(partial.length,2);for(const state of partial){assert(validMatrixState(state));assert.equal(state.stack.complete,false);assert.deepEqual(state.stack.saved,[null]);}
 const identity={session:'fixture',epoch:1};for(const p of [{generation:0,offset:0,limit:4},{generation:null,offset:513,limit:1},{generation:null,offset:0,limit:9}])assert.throws(()=>encodeRequest('m',identity,'n64.capture.matrices',p),/invalid_request/);
});
