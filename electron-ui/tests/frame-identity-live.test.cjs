const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {NativeSessionClient}=require('../dist/services/native-client.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('repeated VI origin addresses have distinct native write identities',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-frame-origin-'),rom=path.join(dir,'fixture.z64'),image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image[0x3e]=0x45;[0x3c08a440,0x24092000,0xad090004,0xad090004,0x1000ffff,0].forEach((word,n)=>image.writeUInt32BE(word>>>0,0x40+n*4));fs.writeFileSync(rom,image);const settings=path.join(dir,'settings.bml');fs.writeFileSync(settings,'');
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--rom',rom,'--system','Nintendo 64','--settings',settings,'--paused','--silent','--save-dir',path.join(dir,'saves'),'--control-session','origins'],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();const closed=once(child,'close'),client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'origins',epoch:1},()=>{});
 const request=async(m,p)=>{const r=await client.request(m,undefined,p);assert(r.ok,JSON.stringify(r));return r.result;};
 try{
  const region=(await request('memory.regions')).regions.find(r=>r.name==='RDRAM');
  const reference=async()=>{const sample=await request('memory.sample',{reads:[{region:region.id,offset:0,length:1}],scheduling:'immediate'});const page=await request('memory.capture.read',{handle:sample.handle,sequence:0,range:0,offset:0,length:1});await request('memory.capture.release',{handle:sample.handle});return page.frame_reference;};
  const step=async count=>{const op=await request('execution.stepInstructions',{count,timeoutMs:1000});for(let n=0;n<100;n++){if((await request('execution.status',{operationId:op.operation_id})).state==='done')return;await sleep(5);}throw Error('step timeout');};
  await request('n64.cpu.setRegisters',{gpr:[],pc:'0xb0000040',hi:null,lo:null,llbit:null,status:null});
  const before=await reference();await step(3);const first=await reference();await step(1);const second=await reference();
  assert.equal(first.origin,0x2000);assert.equal(second.origin,first.origin);assert.equal(first.origin_commit,before.origin_commit+1);assert.equal(second.origin_commit,first.origin_commit+1);assert.equal(second.native_session,'origins');assert.equal(second.boundary,'safe_point');
 }finally{client.close();child.stdin.end('quit\n');await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
