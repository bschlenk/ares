// Compile a historical adapter in a disposable directory, then pass dist/mcp/server.js.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {LocalServiceHost,LocalServiceClient}=require('../dist/services/local-endpoint.js');const {StdioPeer}=require('./stdio-peer.cjs');const {buildInfo}=require('../dist/services/build-info.js');
(async()=>{
 const adapter=path.resolve(process.argv[2]);assert(fs.existsSync(adapter));const dir=fs.mkdtempSync('/tmp/ares-stale-live-');let requests=0;
 const host=new LocalServiceHost({async request(){requests++;return {protocol:1,id:'native',session:'new-build',epoch:1,ok:true,result:{paused:true,system:'Fixture',synthetic:true,capabilities:['session.status']}}}});
 // Initialize and exercise the actual old process BEFORE the new app endpoint exists.
 const peer=new StdioPeer(process.execPath,[adapter,'--connection',path.join(dir,host.instance+'.json'),'--instance',host.instance]);let modern;
 try{await peer.initialize();const before=await peer.tool('build_info');assert(before.adapter);await host.listen(dir);
  const rejected=await peer.tool('emu_status');assert.match(rejected.error,/adapter_stale/);assert.match(rejected.error,/Restart/);assert.match(rejected.error,new RegExp(buildInfo().build_id));assert.equal(requests,0,'stale adapter must not execute a request');
  assert.deepEqual((await peer.tool('build_info')).adapter,before.adapter,'adapter-only diagnostics survive refusal');modern=new LocalServiceClient(host.metadataFile,host.instance);assert.equal((await modern.request('session.status')).session,'new-build');
  console.log('LEGACY_ADAPTER_PASS',JSON.stringify({old_adapter:before.adapter,app:buildInfo(),rejected:rejected.error,mutations_replayed:0}));
 }finally{modern?.close();await peer.close();await host.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
