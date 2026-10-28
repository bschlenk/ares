import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import {ToolRegistry} from '../dist/tools/registry.js';
import {ToolFailure,failureValue} from '../dist/tools/failures.js';
import {waitForScript} from '../dist/services/script-wait.js';
test('unknown options name accepted parameters and retain structured issues',async()=>{
 const registry=new ToolRegistry();registry.registerTool('run_frames',{inputSchema:z.object({n:z.number()}).strict()},()=>({}));
 await assert.rejects(registry.call('run_frames',{count:2}),e=>{
  const value=failureValue(e);assert.equal(value.error.code,'invalid_parameters');assert.match(value.error.message,/run_frames --n/);assert(value.error.details.issues.some(i=>i.code==='unrecognized_keys'));return true;
 });
 const value=failureValue(new ToolFailure('script_error','boom',{operation_id:3}));assert.equal(typeof value.error,'object');assert.equal(value.error.details.operation_id,3);
});
test('failed video publication preserves completed script result',async()=>{
 const final={operation_id:1,state:'done',stop_reason:'script_done',script_result:{state:'committed'},script_output:{state:'failed',error:'disk_full'}};
 assert.equal(await waitForScript({},final,{session:'test',epoch:1}),final);
});
