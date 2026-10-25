const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {InputClips}=require('../dist/services/input-clips.js');
test('native replacement cannot associate a new clip ID with an old starting state',async t=>{
 const dir=fs.mkdtempSync('/tmp/ares-input-association-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const clips=new InputClips();
 const status={job_id:1,state:'ready',complete:true,overflow:false,events:1,duration_frames:1};
 const client={async request(method,identity,p){return {ok:true,...identity,result:method==='state.save'?{path:p.path,sha256:'a'.repeat(64)}:method==='n64.demo.read'?{status,events:p.offset?[]:[{sequence:0,frame:0,port:1,raw:0,buttons:0,x:0,y:0}]}:status};}};
 const params={prompt:'Show an action',port:1,source:'human',maxFrames:60,timeoutMs:1000};
 await clips.run(client,{session:'old-native',epoch:1},'artifact.inputRequest',{...params,statePath:path.join(dir,'old.state')},'owner',()=>true);
 const first=path.join(dir,'first.json');await clips.run(client,{session:'old-native',epoch:1},'artifact.inputExport',{path:first},'owner',()=>true);assert.equal(JSON.parse(fs.readFileSync(first)).start_state.sha256,'a'.repeat(64));
 clips.close();
 await clips.run(client,{session:'new-native',epoch:1},'artifact.inputRequest',params,'owner',()=>true);
 const second=path.join(dir,'second.json');await clips.run(client,{session:'new-native',epoch:1},'artifact.inputExport',{path:second},'owner',()=>true);assert.equal(JSON.parse(fs.readFileSync(second)).start_state,null);
});
