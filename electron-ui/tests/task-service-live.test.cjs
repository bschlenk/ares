const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {NativeSessionClient}=require('../dist/services/native-client.js'),{SessionRouter}=require('../dist/services/session-router.js'),{LocalServiceHost}=require('../dist/services/local-endpoint.js'),{StdioPeer}=require('./stdio-peer.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('task provenance survives actual MCP transport and distinguishes absent/expired dispatches',{timeout:15000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-task-service-'),rom=path.join(dir,'fixture.z64'),settings=path.join(dir,'settings.bml'),image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image[0x3e]=0x45;fs.writeFileSync(rom,image);fs.writeFileSync(settings,'');
 const identity={session:'task-service',epoch:1},child=spawn(process.env.ARES_HOST||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',rom,'--system','Nintendo 64','--settings',settings,'--paused','--silent','--save-dir',path.join(dir,'saves'),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();const closed=once(child,'close'),native=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),router=new SessionRouter();router.attach(native);const endpoint=new LocalServiceHost(router);let peer;
 const request=async(method,params)=>{const r=await router.request(method,undefined,params);assert(r.ok,JSON.stringify(r));return r.result;};
 try{
  await request('session.status');await endpoint.listen(path.join(dir,'ipc'));peer=new StdioPeer(process.execPath,[path.resolve(__dirname,'../dist/mcp/server.js'),'--connection',endpoint.metadataFile,'--instance',endpoint.instance]);await peer.initialize();
  const empty=await peer.tool('rsp_last_task');assert.equal(empty.task,null);assert.equal(empty.interpreter_required,false);
  const regions=(await request('memory.regions')).regions,dmem=regions.find(r=>r.name==='RSP DMEM'),imem=regions.find(r=>r.name==='RSP IMEM');
  const header=Buffer.alloc(64);header.writeUInt32BE(1);header.writeUInt32BE(0x12345678,48);header.writeUInt32BE(64,52);
  await request('memory.write',{region:dmem.id,offset:0xfc0,hex:header.toString('hex')});await request('memory.write',{region:imem.id,offset:0,hex:'0000000d'});
  await request('memory.write',{region:dmem.id,offset:0x80,hex:'3c08a40424090001ad0900101000ffff00000000'});
  await request('n64.cpu.setRegisters',{gpr:[],pc:'0xa4000080',hi:null,lo:null,llbit:null,status:null});
  const op=await request('execution.stepInstructions',{count:3,timeoutMs:1000});for(let n=0;n<100;n++){if((await request('execution.status',{operationId:op.operation_id})).state==='done')break;await sleep(5);}
  const observed=await peer.tool('rsp_last_task');assert.equal(observed.isError,false,JSON.stringify(observed));assert.equal(observed.task.header,header.toString('hex'));assert.equal(observed.task.fields.data_ptr,'0x12345678');
  await request('memory.write',{region:dmem.id,offset:0xff0,hex:'deadbeef'});const retained=await peer.tool('rsp_last_task',{task_id:observed.task.task_id});assert.equal(retained.task.fields.data_ptr,'0x12345678');
  const invalid=await peer.request('tools/call',{name:'rsp_last_task',arguments:{task_id:0}});assert(invalid.error||invalid.result?.isError);await request('session.reset');assert.equal((await peer.tool('rsp_last_task',{task_id:observed.task.task_id})).error,'stale_task');
 }finally{if(peer)await peer.close();await endpoint.close();router.detach();child.stdin.end('quit\n');await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
