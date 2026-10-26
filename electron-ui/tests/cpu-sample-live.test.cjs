const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {NativeSessionClient}=require('../dist/services/native-client.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('large CPU-view samples freeze dirty cache bytes without filling or writing back cache',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-cpu-sample-'),rom=path.join(dir,'fixture.z64'),image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image[0x3e]=0x45;
 // Store into a cached KSEG0 mapping: RDRAM and the dirty CPU line differ.
 [0x3c088000,0x35082000,0x3c091122,0x35293344,0xad090000,0x1000ffff,0].forEach((word,n)=>image.writeUInt32BE(word>>>0,0x40+n*4));fs.writeFileSync(rom,image);const settings=path.join(dir,'settings.bml');fs.writeFileSync(settings,'');
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--rom',rom,'--system','Nintendo 64','--settings',settings,'--paused','--silent','--save-dir',path.join(dir,'saves'),'--control-session','cpu-sample'],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();let stderr='';child.stderr.on('data',b=>stderr+=b);const closed=once(child,'close'),client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'cpu-sample',epoch:1},()=>{});
 const request=async(m,p)=>{const r=await client.request(m,undefined,p);assert(r.ok,JSON.stringify(r)+' '+stderr);return r.result;};
 const step=async count=>{const op=await request('execution.stepInstructions',{count,timeoutMs:1000});for(let n=0;n<100;n++){if((await request('execution.status',{operationId:op.operation_id})).state==='done')return;await sleep(5);}throw Error('step timeout');};
 try{
  const region=(await request('memory.regions')).regions.find(r=>r.name==='RDRAM');
  await request('n64.cpu.setRegisters',{gpr:[],pc:'0xb0000040',hi:null,lo:null,llbit:null,status:null});await step(5);
  const reads=Array.from({length:128},(_,n)=>({region:region.id,offset:0x2000+n*1024,length:1024}));
  const sample=await request('memory.sample',{reads,scheduling:'immediate',view:'cpu'});assert.equal(sample.view,'cpu');assert.equal(sample.copied_bytes,131072);
  const read=handle=>request('memory.capture.read',{handle,sequence:0,range:0,offset:0,length:4});
  assert.equal((await read(sample.handle)).hex,'11223344');
  const raw=await request('memory.sample',{reads:[reads[0]],scheduling:'immediate',view:'physical'});assert.equal(raw.view,'physical');assert.notEqual((await read(raw.handle)).hex,'11223344');
  // Another real cached store cannot alter the already frozen sample.
  await request('n64.cpu.setRegisters',{gpr:[{index:9,value:'0x55667788'}],pc:'0xb0000050',hi:null,lo:null,llbit:null,status:null});await step(1);
  const next=await request('memory.sample',{reads:[reads[0]],scheduling:'immediate',view:'cpu'});assert.equal((await read(next.handle)).hex,'55667788');assert.equal((await read(sample.handle)).hex,'11223344');
  const rawAgain=await request('memory.sample',{reads:[reads[0]],scheduling:'immediate'});assert.equal((await read(rawAgain.handle)).hex,(await read(raw.handle)).hex);
  for(const handle of [sample.handle,raw.handle,next.handle,rawAgain.handle])await request('memory.capture.release',{handle});
  const other=(await request('memory.regions')).regions.find(r=>r.name!=='RDRAM'&&r.readable&&r.size>0);assert(other);const denied=await client.request('memory.sample',undefined,{reads:[{region:other.id,offset:0,length:1}],scheduling:'immediate',view:'cpu'});assert.equal(denied.error,'cpu_view_unavailable');
  await request('session.reset');assert.equal((await client.request('memory.capture.read',undefined,{handle:sample.handle,sequence:0,range:0,offset:0,length:1})).error,'stale_memory_handle');
 }finally{client.close();child.stdin.end('quit\n');await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
