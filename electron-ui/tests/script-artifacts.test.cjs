const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {ScriptJobs}=require('../dist/services/scripts.js');const {publishArtifact}=require('../dist/services/artifact-writer.js');
test('script artifact completion revalidates native ownership and disconnect generations before publishing',async()=>{
 for(const disconnect of [false,true]) {
 const dir=fs.mkdtempSync('/tmp/ares-script-guard-'),file=path.join(dir,'state.bs');let running=true,cancelled=0;
 const native={identity:{session:'guard',epoch:1},async request(method){let result;
  if(method==='script.prepare')result={ready:true};else if(method==='script.write')result={written:true};
  else if(method==='script.start')result={operation_id:1,state:'running'};
  else if(method==='script.pending')result={running,pending:running?{id:1,kind:'state_save',path:file}:null};
  else if(method==='script.resolve')return {ok:false,error:'stale_script'};
  else if(method==='execution.cancel'){cancelled++;result={state:'done'};}
  else result={};return {ok:true,result,...this.identity};}};
 const jobs=new ScriptJobs();
 const invoke={async request(){await publishArtifact(file,false,async write=>{await write('never committed');running=false;native.identity.epoch=2;if(disconnect)jobs.close();},()=>{});return {ok:true,result:{},...native.identity};}};
 try{
  await jobs.start(native,invoke,{...native.identity},{source:'export default()=>1',args:{},timeoutMs:1000,maxFrames:0,outputPaths:[file],...(disconnect?{outputPath:path.join(dir,'result.json')}:{})},'owner',()=>true);
  for(let i=0;!cancelled&&i<100;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(cancelled,1);assert.equal(jobs.outputs.size,0);assert.equal(fs.existsSync(file),false);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 }
});
test('file publication failure preserves the committed immutable script result',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-script-output-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'existing.json');fs.writeFileSync(file,'keep');
 const identity={session:'output',epoch:1},op={operation_id:7,state:'done',kind:'script',stop_reason:'script_done'};
 const native={identity,async request(method){const result=method==='script.start'||method==='execution.status'?op:method==='script.read'?{operation_id:7,hex:'3432',bytes:2,error:'',logs:[],complete:true,result_epoch:1,stop_reason:'script_done'}:method==='script.ack'?{released:true}:{};return {ok:true,result,...identity};}};
 const jobs=new ScriptJobs();const start=await jobs.start(native,{},identity,{source:'export default()=>42',args:{},timeoutMs:1000,maxFrames:0,outputPath:file},'owner',()=>true);
 for(let n=0;n<100&&jobs.outputs.get(7)?.state==='pending';n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(jobs.outputs.get(7).state,'failed');assert.equal(jobs.publications.get(7).state,'committed');assert.equal((await jobs.readResult({handle:start.result_handle},identity)).hex,'3432');assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
