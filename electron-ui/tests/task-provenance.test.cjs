const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {encodeRequest,decodeReply}=require('../dist/services/contracts.js');const {validRspTaskResult}=require('../dist/services/task-contracts.js');
test('actual SP dispatch, IMEM DMA and consumed RDP provenance agree under both RSP executors',()=>{
 const fixture=process.env.ARES_TASK_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-task-fixture');
 const output=execFileSync(fixture,{encoding:'utf8',timeout:10000});assert.match(output,/TASK_PROVENANCE_INTERPRETER_PASS/);assert.match(output,/TASK_PROVENANCE_JIT_PASS/);
 const pages=output.split('\n').filter(line=>line.startsWith('TASK_JSON ')).map(line=>JSON.parse(line.slice(10)));assert.equal(pages.length,2);
 for(const page of pages){assert(validRspTaskResult(page),JSON.stringify(page));assert.equal(page.task.fields.data_ptr,'0x12345678');assert.equal(page.task.imem_revisions.length,8);assert(page.task.code_overflow);assert.equal(page.task.render_targets[0].draw_commands,1);assert.equal(page.scanouts[0].mapping,'candidate_only');assert.equal(page.matrix_state.available,false);decodeReply(JSON.stringify({protocol:1,id:'task',session:'test',epoch:7,ok:true,result:page}),'n64.rsp.lastTask');}
 assert.deepEqual(pages.map(p=>p.executor),['interpreter','recompiler']);
 for(const patch of [{header:'00'},{task_id:0},{imem_revisions:Array(9).fill({})},{resume_mapping:'verified'},{render_targets:Array(17).fill({})}]){const page=structuredClone(pages[0]);Object.assign(page.task,patch);assert.equal(validRspTaskResult(page),false);}
 const matrices=output.split('\n').filter(line=>line.startsWith('MATRIX_JSON ')).map(line=>JSON.parse(line.slice(12)));assert.equal(matrices.length,2);
 for(const page of matrices){decodeReply(JSON.stringify({protocol:1,id:'matrix',session:'test',epoch:9,ok:true,result:page}),'n64.capture.rsp');const operand=page.entries.find(entry=>entry.consumed_matrix)?.consumed_matrix;assert(operand);assert.equal(operand.raw,Buffer.from(Array.from({length:64},(_,n)=>n)).toString('hex'));assert.equal(operand.provenance,'consumed_dma_operand_only');assert.equal(operand.rsp_matrix_stack,null);assert.equal(operand.dram_address,'0x8000');assert.equal(operand.dmem_address,'0x100');}
 const identity={session:'test',epoch:1};for(const params of [{taskId:0},{taskId:-1},{taskId:1.5},{taskId:1,extra:true}])assert.throws(()=>encodeRequest('task',identity,'n64.rsp.lastTask',params),/invalid_request/);
 assert.match(encodeRequest('task',identity,'n64.rsp.lastTask',{taskId:1}),/n64.rsp.lastTask 1 owner=/);
});
