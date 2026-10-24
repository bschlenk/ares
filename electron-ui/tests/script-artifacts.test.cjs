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
