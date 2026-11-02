const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const run=promisify(execFile);
test('agent CLI reduces oversized pages and returns all plugins without replaying a mutation',async t=>{
 const {LocalServiceHost}=await import('../dist/services/local-endpoint.js');const directory=await fs.mkdtemp('/tmp/ares-cli-pages-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));const calls=[];
 const host=new LocalServiceHost({request:async()=>({ok:true})},async params=>{calls.push(params);assert.equal(params.operation,'list');if(params.limit>1)throw new Error('plugin_result_too_large; request a smaller page');return {apiVersion:1,plugins:[{manifest:{id:`local.tool-${params.offset}`}}],nextOffset:params.offset===0?1:null}});await host.listen(directory);t.after(()=>host.close());
 const {stdout}=await run(process.execPath,[path.resolve(__dirname,'../dist/plugins/cli.js'),'list','--connection',host.metadataFile,'--instance',host.instance]);assert.deepEqual(JSON.parse(stdout).plugins.map(p=>p.manifest.id),['local.tool-0','local.tool-1']);assert.deepEqual(calls.map(p=>[p.offset,p.limit]),[[0,4],[0,1],[1,1]]);
});

for (const [command,operation] of [['logs','logs'],['screenshot','screenshot'],['renderer-status','renderer_status'],['recover-renderer','recover_renderer']]) test(`agent CLI waits for delayed ${operation} reply before closing its connection`,async t=>{
 const {LocalServiceHost}=await import('../dist/services/local-endpoint.js');const directory=await fs.mkdtemp('/tmp/ares-cli-reply-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));let calls=0;
 const host=new LocalServiceHost({request:async()=>({ok:true})},async params=>{assert.equal(params.operation,operation);calls++;await new Promise(resolve=>setTimeout(resolve,50));return {completed:true,operation}});await host.listen(directory);t.after(()=>host.close());
 const args=operation==='logs'?['logs','local.tool','--limit','1']:operation==='screenshot'?['screenshot','--output',path.join(directory,'capture.png')]:[command];
 const {stdout}=await run(process.execPath,[path.resolve(__dirname,'../dist/plugins/cli.js'),...args,'--connection',host.metadataFile,'--instance',host.instance]);assert.deepEqual(JSON.parse(stdout),{completed:true,operation});assert.equal(calls,1);
});
