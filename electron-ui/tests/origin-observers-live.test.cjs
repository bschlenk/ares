const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {NativeSessionClient}=require('../dist/services/native-client.js'),{SessionRouter}=require('../dist/services/session-router.js');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('VI-origin observers freeze repeated-origin writes at consumption, before later CPU stores',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-origin-observer-'),rom=path.join(dir,'fixture.z64'),image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image[0x3e]=0x45;
 [0x3c08a440,0x24092000,0x3c0aa400,0x240b0011,0xa14b0100,0xad090004,0x240b0022,0xa14b0100,0xad090004,0x240b0033,0xa14b0100,0x1000ffff,0].forEach((word,n)=>image.writeUInt32BE(word>>>0,0x40+n*4));fs.writeFileSync(rom,image);const settings=path.join(dir,'settings.bml');fs.writeFileSync(settings,'');
 const child=spawn((process.env.ARES_HOST || path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host')),['--rom',rom,'--system','Nintendo 64','--settings',settings,'--paused','--silent','--save-dir',path.join(dir,'saves'),'--control-session','origin-observer'],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();let stderr='';child.stderr.on('data',b=>stderr+=b);const closed=once(child,'close'),native=new NativeSessionClient(child.stdin,child.stdio[3],{session:'origin-observer',epoch:1},()=>{}),router=new SessionRouter();router.attach(native);const samples=[];router.onObserverSample=s=>samples.push(s);
 const request=async(m,p)=>{const r=await router.request(m,undefined,p,'test');assert(r.ok,JSON.stringify(r)+' '+stderr);return r.result;};
 try{
  const region=(await request('memory.regions')).regions.find(r=>r.name==='RSP DMEM');assert(region);
  await request('n64.cpu.setRegisters',{gpr:[],pc:'0xb0000040',hi:null,lo:null,llbit:null,status:null});
  const observer=await request('scripts.observe',{source:`const history=[];export default({emu,mem})=>{history.push({ref:emu.info().frame_reference,byte:mem.region(${JSON.stringify(region.id)},256,1)[0]});return history}`,args:{},timeoutMs:5000,maxFrames:0,every:1,boundary:'vi_origin',push:true});
  // Native notifications are bounded latest-value delivery, so two fast origin
  // writes may coalesce. Preserve both captures in the observer's value instead
  // of assuming the writer thread flushes between adjacent CPU instructions.
  await request('session.resume');const deadline=Date.now()+5000;
  while(Date.now()<deadline&&!samples.some(s=>Array.isArray(s.value)&&s.value.length===2))await sleep(10);
  await request('session.pause');
  assert(samples.length>0,JSON.stringify(samples));assert(samples.every(s=>s.error===''),JSON.stringify(samples));
  const latest=samples.at(-1),history=latest.value;assert.equal(history.length,2,JSON.stringify(samples));assert.deepEqual(history.map(s=>s.byte),[0x11,0x22]);
  const [a,b]=history.map(s=>s.ref);assert.equal(a.boundary,'vi_origin');assert.equal(b.boundary,'vi_origin');assert.equal(a.vi,b.vi);assert.equal(a.origin,b.origin);assert.equal(b.origin_commit,a.origin_commit+1);assert.deepEqual(b,latest.frame_reference);assert.equal(a.provenance,'unmatched');assert.equal((await request('memory.read',{region:region.id,offset:256,length:1})).hex,'33');
  await request('script.observerStop',{observerId:observer.observer_id});
 }finally{router.detach();child.stdin.end('quit\n');await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
