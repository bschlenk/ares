import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ToolRegistry} from '../dist/tools/registry.js';
import {registerTools} from '../dist/mcp/register-tools.js';

test('shared CLI/MCP video health and renderer recovery route only to their host operations',async()=>{
  const calls=[];
  const client={manage:async p=>{calls.push(p);return {operation:p.operation};},request:()=>assert.fail('must not run/pause/reset/load the core')};
  const registry=new ToolRegistry();registerTools(registry,client);
  for(const operation of ['video_surfaces','renderer_status','recover_renderer']){
    const result=await registry.call(operation,{});assert.equal(result.isError,undefined);assert.equal(JSON.parse(result.content[0].text).operation,operation);
    await assert.rejects(registry.call(operation,{reset:true}),/Unknown option/);
  }
  assert.deepEqual(calls.map(p=>p.operation),['video_surfaces','renderer_status','recover_renderer']);
  for(const name of ['video_surfaces','renderer_status'])assert.equal(registry.list().find(t=>t.name===name).annotations.readOnlyHint,true);
});
