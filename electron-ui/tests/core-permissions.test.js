import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PluginRegistry} from '../dist/plugins/registry.js';
test('cross-core input and waits honor plugin grants, activation and owner cleanup',async()=>{
  const root=await fs.mkdtemp('/tmp/ares-core-permissions-');
  try{
    for(const capabilities of [[],['session.read'],['session.control'],['session.read','session.control']]){
      const plugin=path.join(root,'source');await fs.mkdir(plugin,{recursive:true});
      await fs.writeFile(path.join(plugin,'manifest.json'),JSON.stringify({id:'test.core',name:'Core',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities,contributes:{}}));
      await fs.writeFile(path.join(plugin,'plugin.js'),'export function activate() {}');
      const identity={session:'test',epoch:1},calls=[];
      const status={paused:false,system:'Game Boy',synthetic:false,capabilities:[]};
      const registry=new PluginRegistry(path.join(root,'bundled'),path.join(root,'data-'+capabilities.join('-')), {request:async(method,id,params,owner)=>{calls.push({method,owner});return {protocol:1,id:'r',...identity,ok:true,result:{...status}};}},()=>identity);
      await registry.initialize([plugin]);registry.attach();registry.observe({protocol:1,id:'s',...identity,ok:true,result:status});await registry.enable('test.core',true);
      const token=registry.catalog().plugins[0].lease.token;
      if(capabilities.includes('session.control'))await assert.rejects(registry.request(token,'input.set',{port:1,buttons:['A'],leaseFrames:30,leaseMs:1000}),/plugin_not_ready/);
      registry.finish(token);
      for(const method of ['input.describe','input.state','clock.waitStart','clock.waitRead','clock.waitCancel']){
        if(capabilities.includes('session.read'))await registry.request(token,method,method==='clock.waitStart'?{frames:30,timeoutMs:1000}:method.startsWith('clock.')?{waitId:1}:undefined);
        else await assert.rejects(registry.request(token,method),/plugin_capability_denied/);
      }
      for(const method of ['input.set','input.release']){
        if(capabilities.includes('session.control'))await registry.request(token,method,method==='input.set'?{port:1,buttons:['A'],leaseFrames:30,leaseMs:1000}:{port:0});
        else await assert.rejects(registry.request(token,method),/plugin_capability_denied/);
      }
      if(capabilities.includes('session.read'))assert.deepEqual((await registry.request(token,'session.status')).result.plugin_grants,capabilities);
      registry.disconnect();await new Promise(resolve=>setImmediate(resolve));assert(calls.some(c=>c.method==='execution.release'&&c.owner.startsWith('plugin-')));
      await assert.rejects(registry.request(token,'input.set'),/stale_plugin_scope/);
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
