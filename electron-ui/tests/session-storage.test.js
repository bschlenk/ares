import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {StorageCoordinator, canonicalStoragePath, personalStorageDirectory} from '../dist/sessions/storage.js';
import {KernelLock} from '../dist/sessions/locks.js';
import {SessionRepository} from '../dist/sessions/repository.js';
import {personalContext} from '../dist/sessions/context.js';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {FrameParser} from '../dist/protocol.js';
import {makeFixture} from '../fixture.cjs';
const host = process.env.ARES_HOST;
assert(host, 'Set ARES_HOST to the rebuilt native binary');
const storageURL = new URL('../dist/sessions/storage.js', import.meta.url).href;
const lockURL = new URL('../dist/sessions/locks.js', import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync('/tmp/ares-storage-test-');
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const personal = path.join(root,'personal'); fs.mkdirSync(personal);
  const context = personalContext(personal), coordinator = new StorageCoordinator(path.join(root,'coordination'));
  return {root, context, coordinator};
}
const inventory = (...sources) => ({version:1,resources:sources.map(source=>({source,scope:'file'}))});
function batteryRom() {
  const bytes=makeFixture();bytes[0x147]=3;bytes[0x149]=2;
  let sum=0;for(let n=0x134;n<=0x14c;n++)sum=(sum-bytes[n]-1)&255;bytes[0x14d]=sum;
  return bytes;
}
function prepare(rom, saves, extra=[]) {
  const result=spawnSync(host,['--prepare-storage','--rom',rom,'--system','Game Boy','--save-dir',saves,'--silent',...extra],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
async function named(t, context, name) {
  const opened=await new SessionRepository(context.personalRoot).open(name);
  t.after(()=>opened.lock.release());return opened;
}
function worker(source,args=[]) {
  const child=spawn(process.execPath,['--input-type=module','-e',source,...args],{stdio:['pipe','pipe','pipe']});
  let log='';child.stderr.on('data',data=>log+=data);const closed=once(child,'close');
  return {child,closed,log:()=>log};
}
async function native(t, rom, saves, reservation, coordinator, lifecycle, system = 'Game Boy') {
  const transaction=path.join(path.dirname(rom),randomUUID()+'.json');
  const barrier=fs.openSync(coordinator.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600);
  const descriptors=[reservation.fd,barrier,...(lifecycle?[lifecycle.fd]:[])];
  fs.writeFileSync(transaction,JSON.stringify({version:1,barrier:5,resources:reservation.nativeResources()}));
  const child=spawn(host,['--rom',rom,'--system',system,'--save-dir',saves,'--silent','--paused','--storage-transaction',transaction,'--control-session','storage-test'],{stdio:['pipe','pipe','pipe','pipe',...descriptors]});
  fs.closeSync(barrier);let log='';child.stderr.on('data',data=>log+=data);
  const closed=once(child,'close');const parser=new FrameParser(()=>{});child.stdout.on('data',data=>parser.push(data));
  child.stdin.on('error',()=>{});child.stdin.write('ack\n');
  const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'storage-test',epoch:1},()=>{});
  const stop=async()=>{client.close();if(child.exitCode===null&&child.signalCode===null)child.stdin.end('quit\n');const [code]=await closed;assert.equal(code,0,log);};
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}});
  const status=await client.request('session.status');assert(status.ok,JSON.stringify(status)+' '+log);
  return {child,client,closed,stop,log:()=>log};
}

test('real loader preparation does not read save bytes or create save directories',async t=>{
  const {root}=fixture(t),rom=path.join(root,'battery.gb'),saves=path.join(root,'absent','saves');fs.writeFileSync(rom,batteryRom());
  const result=prepare(rom,saves);assert(result.resources.some(row=>row.source.endsWith('.ram')));assert(!fs.existsSync(path.dirname(saves)));
  const save=result.resources.find(row=>row.source.endsWith('.ram')).source;
  fs.mkdirSync(path.dirname(save),{recursive:true});fs.mkdirSync(save); // a read would fail: directory, not save bytes
  assert.deepEqual(prepare(rom,saves),result);
});

test('resource sets conflict across processes on absent, symlink, hard-link and directory aliases',async t=>{
  const {root,context,coordinator}=fixture(t);const directory=path.join(root,'saves');fs.mkdirSync(directory);
  const source=path.join(directory,'shared.ram');fs.writeFileSync(source,'original');fs.symlinkSync(directory,path.join(root,'alias'));fs.linkSync(source,path.join(root,'hardlink'));
  const claim=await coordinator.reserve(inventory(source),context,'Owner Game');t.after(()=>claim.release());
  for(const candidate of [source,path.join(root,'alias','shared.ram'),path.join(root,'hardlink')]){
    const code=`import {StorageCoordinator} from ${JSON.stringify(storageURL)};try{await new StorageCoordinator(process.argv[1]).reserve(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),'other');process.exit(2)}catch(e){console.log(e.message);process.exit(e.message.startsWith('storage_conflict:')?0:3)}`;
    const w=worker(code,[coordinator.root,JSON.stringify(inventory(candidate)),JSON.stringify({...context,instanceId:randomUUID()})]);assert.equal((await w.closed)[0],0,w.log());
  }
  const other=new StorageCoordinator(coordinator.root);
  await assert.rejects(other.reserve({version:1,resources:[{source:directory,scope:'directory'}]},context,'directory'),/storage_conflict/);
  const absent=path.join(directory,'missing.rtc');const absentClaim=await coordinator.reserve(inventory(absent),context,'RTC');t.after(()=>absentClaim.release());
  await assert.rejects(other.reserve(inventory(path.join(root,'alias','missing.rtc')),context,'RTC alias'),/storage_conflict/);
  const disjoint=await other.reserve(inventory(path.join(root,'other.ram')),context,'other');await disjoint.release();
  const reused=await coordinator.reserve(inventory(source,absent),context,'reload');await claim.release();await absentClaim.release();
  await assert.rejects(other.reserve(inventory(source),context,'no gap'),/storage_conflict/);await reused.release();
  const recovered=await other.reserve(inventory(source),context,'now free');await recovered.release();
});

test('inheritance records absence and shared resources once, maps hard links, and honors fresh policy',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'agent');
  const source=path.join(root,'card'),absent=path.join(root,'absent'),other=path.join(root,'different','card');fs.writeFileSync(source,'personal-one');fs.mkdirSync(path.dirname(other));fs.writeFileSync(other,'different');
  const claim=await coordinator.reserve(inventory(source,absent,other),opened.context,'game one');t.after(()=>claim.release());await coordinator.initialize(claim,opened.context);
  const first=claim.nativeResources();assert.equal(fs.readFileSync(first[0].destination,'utf8'),'personal-one');assert.equal(fs.readFileSync(first[2].destination,'utf8'),'different');assert.notEqual(first[0].destination,first[2].destination);
  fs.writeFileSync(source,'personal-two');fs.writeFileSync(absent,'late personal');fs.writeFileSync(first[0].destination,'agent-progress');
  const second=await coordinator.reserve(inventory(source,absent),opened.context,'game two');t.after(()=>second.release());await coordinator.initialize(second,opened.context);
  assert.equal(fs.readFileSync(second.nativeResources()[0].destination,'utf8'),'agent-progress');assert(!fs.existsSync(second.nativeResources()[1].destination));
  const alias=path.join(root,'linked-card');fs.linkSync(source,alias);const third=await coordinator.reserve(inventory(alias),opened.context,'linked');t.after(()=>third.release());await coordinator.initialize(third,opened.context);assert.equal(third.nativeResources()[0].destination,first[0].destination);
  fs.unlinkSync(source);const renamed=await coordinator.reserve(inventory(alias),opened.context,'alias after unlink');t.after(()=>renamed.release());await coordinator.initialize(renamed,opened.context);assert.equal(renamed.nativeResources()[0].destination,first[0].destination);fs.writeFileSync(source,'personal-two');
  const fresh=await named(t,context,'fresh');const dataFile=path.join(fresh.context.dataRoot,'data.json');const data=JSON.parse(fs.readFileSync(dataFile));data.policy='fresh';fs.writeFileSync(dataFile,JSON.stringify(data));
  const freshClaim=await coordinator.reserve(inventory(source),fresh.context,'fresh');t.after(()=>freshClaim.release());await coordinator.initialize(freshClaim,fresh.context);assert(!fs.existsSync(freshClaim.nativeResources()[0].destination));
  await coordinator.initialize(freshClaim,fresh.context);assert(!fs.existsSync(freshClaim.nativeResources()[0].destination));
});

for(const point of ['resource-staged','initialization-intent','resource-published','ledger-published'])test(`SIGKILL during ${point} leaves initialization recoverable`,async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'crash');const sources=[path.join(root,'ram'),path.join(root,'rtc')];for(const source of sources)fs.writeFileSync(source,'consistent');
  const code=`import {StorageCoordinator} from ${JSON.stringify(storageURL)};const c=new StorageCoordinator(process.argv[1]),context=JSON.parse(process.argv[2]),r=await c.reserve(JSON.parse(process.argv[3]),context,'crash');await c.initialize(r,context,p=>{if(p===process.argv[4])process.kill(process.pid,'SIGKILL')});`;
  const w=worker(code,[coordinator.root,JSON.stringify(opened.context),JSON.stringify(inventory(...sources)),point]);assert.equal((await w.closed)[1],'SIGKILL',w.log());
  const claim=await coordinator.reserve(inventory(...sources),opened.context,'retry');t.after(()=>claim.release());await coordinator.initialize(claim,opened.context);
  for(const row of claim.nativeResources())assert.equal(fs.readFileSync(row.destination,'utf8'),'consistent');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot,'data.json'))).initialized).length,2);
});

test('snapshot waits for a complete multi-file save transaction while lifetime ownership remains held',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'snapshot');const a=path.join(root,'ram'),b=path.join(root,'rtc');fs.writeFileSync(a,'before');fs.writeFileSync(b,'before');
  const lifetime=await coordinator.reserve(inventory(a,b),context,'personal playing');t.after(()=>lifetime.release());
  const code=`import fs from 'node:fs';import {KernelLock} from ${JSON.stringify(lockURL)};const l=await KernelLock.acquire(process.argv[1]);fs.writeFileSync(process.argv[2],'after');console.log('half');process.stdin.once('data',async()=>{fs.writeFileSync(process.argv[3],'after');await l.release();});`;
  const w=worker(code,[coordinator.barrierFile(),a,b]);t.after(()=>w.child.kill('SIGKILL'));await once(w.child.stdout,'data');
  const claim=await coordinator.reserve(inventory(a,b),opened.context,'clone');t.after(()=>claim.release());let finished=false;const copy=coordinator.initialize(claim,opened.context).then(()=>finished=true);
  await new Promise(resolve=>setTimeout(resolve,100));assert(!finished);lifetime.lock.assertHeld();w.child.stdin.end('finish');await w.closed;await copy;
  for(const row of claim.nativeResources())assert.equal(fs.readFileSync(row.destination,'utf8'),'after');
});

test('native writer flushes to private mapping and retains resource/lifecycle locks after helper death',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'native');const rom=path.join(root,'battery.gb'),saves=path.join(context.personalRoot,'saves');fs.writeFileSync(rom,batteryRom());
  const prepared=prepare(rom,saves),source=prepared.resources.find(row=>row.source.endsWith('.ram')).source;fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,Buffer.alloc(8192,0x47));
  const reservation=await coordinator.reserve(prepared,opened.context,'battery');await coordinator.initialize(reservation,opened.context);
  const running=await native(t,rom,saves,reservation,coordinator,opened.lock);
  const destination=reservation.nativeResources().find(row=>row.source===source).destination;
  process.kill(reservation.lock.child.pid,'SIGKILL');await once(reservation.lock.child,'exit');
  process.kill(opened.lock.child.pid,'SIGKILL');await once(opened.lock.child,'exit');
  await reservation.release();await opened.lock.release(); // killed helpers and closed parent FDs; only native retains ownership
  await assert.rejects(new StorageCoordinator(coordinator.root).reserve(prepared,opened.context,'blocked'),/storage_conflict/);
  await assert.rejects(new SessionRepository(context.personalRoot).open('native'),/storage_busy/);
  await running.stop();
  assert.deepEqual(fs.readFileSync(source),Buffer.alloc(8192,0x47));assert.equal(fs.readFileSync(destination).length,8192);
  const next=await new StorageCoordinator(coordinator.root).reserve(prepared,opened.context,'released');await next.release();
});

test('native open rejects a changed destination symlink',async t=>{
  const {root,context,coordinator}=fixture(t),rom=path.join(root,'battery.gb'),saves=path.join(root,'saves');fs.writeFileSync(rom,batteryRom());
  const prepared=prepare(rom,saves),reservation=await coordinator.reserve(prepared,context,'battery');t.after(()=>reservation.release());
  const resource=reservation.nativeResources().find(row=>row.source.endsWith('.ram'));
  fs.mkdirSync(path.dirname(resource.destination),{recursive:true});const unrelated=path.join(root,'unrelated');fs.writeFileSync(unrelated,'safe');fs.symlinkSync(unrelated,resource.destination);
  const barrier=fs.openSync(coordinator.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600),file=path.join(root,'transaction.json');fs.writeFileSync(file,JSON.stringify({version:1,barrier:5,resources:reservation.nativeResources()}));
  const run=spawnSync(host,['--rom',rom,'--system','Game Boy','--silent','--save-dir',saves,'--storage-transaction',file],{stdio:['pipe','pipe','pipe','ignore',reservation.fd,barrier],timeout:10000});fs.closeSync(barrier);
  assert.notEqual(run.status,0);assert.match(run.stderr.toString(),/storage_open_failed/);assert.equal(fs.readFileSync(unrelated,'utf8'),'safe');
});


test('SIGKILL of the parent leaves stopped orphan writer holding resources and lifecycle through final flush', {timeout:30000}, async t=>{
  const {root,context,coordinator}=fixture(t),rom=path.join(root,'orphan.gb'),saves=path.join(context.personalRoot,'saves');fs.writeFileSync(rom,batteryRom());
  const prepared=prepare(rom,saves),repoURL=new URL('../dist/sessions/repository.js',import.meta.url).href;
  const nativeURL=new URL('../dist/services/native-client.js',import.meta.url).href;
  const code=`import fs from 'node:fs';import {spawn} from 'node:child_process';import {StorageCoordinator} from ${JSON.stringify(storageURL)};import {SessionRepository} from ${JSON.stringify(repoURL)};import {NativeSessionClient} from ${JSON.stringify(nativeURL)};
  const c=new StorageCoordinator(process.argv[1]),opened=await new SessionRepository(process.argv[2]).open('orphan'),r=await c.reserve(JSON.parse(process.argv[5]),opened.context,'orphan');await c.initialize(r,opened.context);
  const fd=fs.openSync(c.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600),manifest=process.argv[3]+'.json';fs.writeFileSync(manifest,JSON.stringify({version:1,barrier:5,resources:r.nativeResources()}));
  const native=spawn(process.env.ARES_HOST,['--rom',process.argv[3],'--system','Game Boy','--silent','--paused','--save-dir',process.argv[4],'--control-session','orphan','--storage-transaction',manifest],{stdio:['pipe','ignore','ignore','pipe',r.fd,fd,opened.lock.fd]});
  const client=new NativeSessionClient(native.stdin,native.stdio[3],{session:'orphan',epoch:1},()=>{});const status=await client.request('session.status');if(!status.ok)throw Error(JSON.stringify(status));process.kill(native.pid,'SIGSTOP');console.log(JSON.stringify({pid:native.pid,context:opened.context,destination:r.nativeResources()[0].destination}));process.stdin.resume();`;
  const w=worker(code,[coordinator.root,context.personalRoot,rom,saves,JSON.stringify(prepared)]);t.after(()=>w.child.kill('SIGKILL'));
  const [output]=await once(w.child.stdout,'data'),info=JSON.parse(output.toString());t.after(()=>{try{process.kill(info.pid,'SIGKILL')}catch{}});
  w.child.kill('SIGKILL');await w.closed;
  await assert.rejects(new StorageCoordinator(coordinator.root).reserve(prepared,info.context,'conflict'),/storage_conflict/);
  await assert.rejects(new SessionRepository(context.personalRoot).open('orphan'),/storage_busy/);
  process.kill(info.pid,'SIGCONT');
  let reservation;
  for(let attempt=0;attempt<100;attempt++) {
    try{reservation=await new StorageCoordinator(coordinator.root).reserve(prepared,info.context,'recovered');break;}catch(error){if(!error.message.startsWith('storage_conflict'))throw error;await new Promise(resolve=>setTimeout(resolve,20));}
  }
  assert(reservation,'orphan must exit after EOF and final save');await reservation.release();assert.equal(fs.readFileSync(info.destination).length,8192);
});

test('native refuses missing prepared resources before opening personal save contents',async t=>{
  const {root,context,coordinator}=fixture(t),rom=path.join(root,'battery.gb'),saves=path.join(root,'saves');fs.writeFileSync(rom,batteryRom());
  const prepared=prepare(rom,saves),reservation=await coordinator.reserve(prepared,context,'battery');t.after(()=>reservation.release());
  const barrier=fs.openSync(coordinator.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600),file=path.join(root,'empty.json');fs.writeFileSync(file,JSON.stringify({version:1,barrier:5,resources:[]}));
  const run=spawnSync(host,['--rom',rom,'--system','Game Boy','--silent','--save-dir',saves,'--storage-transaction',file],{stdio:['pipe','pipe','pipe','ignore',reservation.fd,barrier],timeout:10000});fs.closeSync(barrier);
  assert.notEqual(run.status,0);assert.match(run.stderr.toString(),/storage_unprepared_resource/);
});

test('PlayStation preparation includes the shared expansion pair and distinct per-game cards',async t=>{
  const {root}=fixture(t),bios=path.join(root,'bios.bin'),cart=path.join(root,'cart.bin'),settings=path.join(root,'settings.bml'),saves=path.join(root,'absent-saves');
  fs.writeFileSync(bios,Buffer.alloc(512*1024));fs.writeFileSync(cart,Buffer.alloc(128*1024,0x5a));fs.writeFileSync(settings,`PlayStation\n  ParallelPort: Datel (128KB)\n  Firmware\n    BIOS.US: ${bios}\n    Datel-128KB.Any: ${cart}\n`);
  const preparations=[];
  for(const name of ['one','two']) {
    const rom=path.join(root,name+'.exe'),image=Buffer.alloc(4096);image.write('PS-X EXE');image.writeUInt32LE(0x80010000,0x10);image.writeUInt32LE(0x80010000,0x18);image.writeUInt32LE(2048,0x1c);fs.writeFileSync(rom,image);
    const result=spawnSync(host,['--prepare-storage','--rom',rom,'--system','PlayStation','--settings',settings,'--save-dir',saves,'--silent'],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);preparations.push(JSON.parse(result.stdout));
  }
  assert(!fs.existsSync(saves));
  const sources=preparations.map(p=>p.resources.map(r=>r.source));
  for(const suffix of ['.eeprom','.eeprom.firmware'])assert.equal(sources[0].find(s=>s.endsWith(suffix)),sources[1].find(s=>s.endsWith(suffix)));
  assert.notEqual(sources[0].find(s=>s.endsWith('.card')),sources[1].find(s=>s.endsWith('.card')));
});

test('writable WAV preparation does not decode personal contents; named tape loads use inherited private PCM',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'tape'),rom=path.join(root,'fixture.wav'),saves=path.join(root,'saves');
  const wave=Buffer.alloc(48);wave.write('RIFF');wave.writeUInt32LE(40,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(44100,24);wave.writeUInt32LE(88200,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(4,40);
  fs.writeFileSync(rom,'invalid PCM must not be read during preparation');
  const result=spawnSync(host,['--prepare-storage','--rom',rom,'--system','ZX Spectrum','--save-dir',saves,'--silent'],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);const prepared=JSON.parse(result.stdout);assert(prepared.resources.some(row=>row.source===rom));assert(!fs.existsSync(saves));
  fs.writeFileSync(rom,wave);const reservation=await coordinator.reserve(prepared,opened.context,'tape');t.after(()=>reservation.release());await coordinator.initialize(reservation,opened.context);
  fs.writeFileSync(rom,'changed and invalid personal wave');
  const file=path.join(root,'tape.json'),barrier=fs.openSync(coordinator.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600);fs.writeFileSync(file,JSON.stringify({version:1,barrier:5,resources:reservation.nativeResources()}));
  const run=spawnSync(host,['--rom',rom,'--system','ZX Spectrum','--silent','--paused','--save-dir',saves,'--storage-transaction',file],{input:'quit\n',stdio:['pipe','pipe','pipe','ignore',reservation.fd,barrier],timeout:10000});fs.closeSync(barrier);assert.equal(run.status,0,run.stderr?.toString());assert.equal(fs.readFileSync(rom,'utf8'),'changed and invalid personal wave');assert(!fs.existsSync(saves));
});

test('simultaneous subprocess claims publish exactly one overlapping writer and no partial set',async t=>{
  const {root,context,coordinator}=fixture(t),a=path.join(root,'a'),b=path.join(root,'b');fs.writeFileSync(a,'safe-a');fs.writeFileSync(b,'safe-b');
  const code=`import {StorageCoordinator} from ${JSON.stringify(storageURL)};try{const r=await new StorageCoordinator(process.argv[1]).reserve(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),'race');console.log('claimed');process.stdin.once('data',async()=>{await r.release();});}catch(e){console.log(e.message.startsWith('storage_conflict:')?'conflict':e.stack);}`;
  const workers=Array.from({length:5},()=>worker(code,[coordinator.root,JSON.stringify(inventory(a,b)),JSON.stringify({...context,instanceId:randomUUID()})]));t.after(async()=>{for(const w of workers)w.child.kill('SIGKILL');await Promise.all(workers.map(w=>w.closed));});
  const answers=await Promise.all(workers.map(async w=>(await once(w.child.stdout,'data'))[0].toString().trim()));assert.equal(answers.filter(a=>a==='claimed').length,1,answers.join('\n'));assert.equal(answers.filter(a=>a==='conflict').length,4,answers.join('\n'));
  const winner=workers[answers.indexOf('claimed')];winner.child.kill('SIGKILL');await winner.closed;
  const claim=await coordinator.reserve(inventory(a,b),context,'recovered');await claim.release();assert.equal(fs.readFileSync(a,'utf8'),'safe-a');assert.equal(fs.readFileSync(b,'utf8'),'safe-b');
});

test('killing native alone leaves helper ownership until parent cleanup, then permits a new writer',async t=>{
  const {root,context,coordinator}=fixture(t),rom=path.join(root,'kill.gb'),saves=path.join(context.personalRoot,'saves');fs.writeFileSync(rom,batteryRom());const prepared=prepare(rom,saves),source=prepared.resources[0].source;
  fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,Buffer.alloc(8192,0x2a));
  const reservation=await coordinator.reserve(prepared,context,'personal');const running=await native(t,rom,saves,reservation,coordinator);
  running.child.kill('SIGKILL');await running.closed;
  await assert.rejects(new StorageCoordinator(coordinator.root).reserve(prepared,context,'still cleaning'),/storage_conflict/);
  await reservation.release();const recovered=await new StorageCoordinator(coordinator.root).reserve(prepared,context,'new writer');await recovered.release();assert.deepEqual(fs.readFileSync(source),Buffer.alloc(8192,0x2a));
});

test('N64 preparation includes configured controller paks, RTC and companion transfer-cartridge saves',async t=>{
  const {root}=fixture(t),rom=path.join(root,'homebrew.z64'),gb=path.join(root,'companion.gb'),saves=path.join(root,'absent-saves'),config=path.join(root,'settings.bml');
  const image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image.write('ORIGINAL STORAGE TEST',0x20);image.write('NED',0x3b);image[0x3e]=0x45;image[0x3f]=0x11;image[0x34]=2;fs.writeFileSync(rom,image);fs.writeFileSync(gb,batteryRom());fs.writeFileSync(config,'General\n  NoFilePrompt: false\n');
  const args=['--prepare-storage','--rom',rom,'--system','Nintendo 64','--save-dir',saves,'--settings',config,'--silent'];
  const run=()=>{const result=spawnSync(host,args,{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout).resources.map(row=>row.source);};
  let sources=run();assert(sources.some(source=>source.endsWith('.pak')));assert(sources.some(source=>source.endsWith('.eeprom')));assert(sources.some(source=>source.endsWith('.rtc')));
  image[0x34]=3;fs.writeFileSync(rom,image);args.push('--media',gb);sources=run();assert(sources.some(source=>source.endsWith('companion.ram')));assert(!fs.existsSync(saves));
});


test('private mapping follows volume case rules even before a source save exists',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'case');
  const sensitive=spawnSync(host,['--storage-case-sensitive',root],{encoding:'utf8'});assert.equal(sensitive.status,0,sensitive.stderr);
  const first=await coordinator.reserve(inventory(path.join(root,'Missing.ram')),opened.context,'first');t.after(()=>first.release());await coordinator.initialize(first,opened.context);
  const second=await coordinator.reserve(inventory(path.join(root,'missing.ram')),opened.context,'second');t.after(()=>second.release());await coordinator.initialize(second,opened.context);
  const same=first.nativeResources()[0].destination===second.nativeResources()[0].destination;assert.equal(same,sensitive.stdout==='0\n');
});


test('named preparation reuses the effective personal save subtree without creating source folders',async t=>{
  const {context}=fixture(t),opened=await named(t,context,'routing');
  const fallback=personalStorageDirectory(opened.context);assert.equal(fallback,path.join(context.personalRoot,'saves'));assert(!fs.existsSync(fallback));
  const override=path.join(context.personalRoot,'custom','battery');fs.mkdirSync(override,{recursive:true});
  assert.equal(personalStorageDirectory(context,override),override);assert.equal(personalStorageDirectory(opened.context),override);
  fs.writeFileSync(path.join(context.personalRoot,'storage-routing.json'),JSON.stringify({version:1,directory:'../outside'}));
  assert.throws(()=>personalStorageDirectory(opened.context),/invalid_personal_storage_routing/);
});


test('canceled snapshot publishes neither partial files nor initialized entries and can be retried',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'cancel'),source=path.join(root,'source');fs.writeFileSync(source,'personal progress');
  const reservation=await coordinator.reserve(inventory(source),opened.context,'cancel');t.after(()=>reservation.release());const controller=new AbortController();
  await assert.rejects(coordinator.initialize(reservation,opened.context,point=>{if(point==='resource-staged')controller.abort(new Error('canceled'));},controller.signal),/canceled/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot,'data.json'))).initialized,{});assert(!fs.existsSync(reservation.nativeResources()[0].destination));
  const exclusive=await KernelLock.acquire(coordinator.barrierFile()),waitingController=new AbortController();
  const waiting=coordinator.initialize(reservation,opened.context,()=>{},waitingController.signal);waitingController.abort(new Error('canceled while waiting'));await exclusive.release();await assert.rejects(waiting,/canceled while waiting/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot,'data.json'))).initialized,{});
  await coordinator.initialize(reservation,opened.context);assert.equal(fs.readFileSync(reservation.nativeResources()[0].destination,'utf8'),'personal progress');assert.equal(fs.readFileSync(source,'utf8'),'personal progress');
});


test('personal native opens revalidate prepared symlink aliases before save reads',async t=>{
  const {root,context,coordinator}=fixture(t),rom=path.join(root,'alias.gb'),saves=path.join(root,'saves');fs.writeFileSync(rom,batteryRom());const prepared=prepare(rom,saves),source=prepared.resources[0].source;
  const a=path.join(root,'original'),b=path.join(root,'replacement');fs.writeFileSync(a,Buffer.alloc(8192,0x11));fs.writeFileSync(b,Buffer.alloc(8192,0x22));fs.mkdirSync(path.dirname(source),{recursive:true});fs.symlinkSync(a,source);
  const reservation=await coordinator.reserve(prepared,context,'alias');t.after(()=>reservation.release());const resources=reservation.nativeResources();fs.unlinkSync(source);fs.symlinkSync(b,source);
  const barrier=fs.openSync(coordinator.barrierFile(),fs.constants.O_CREAT|fs.constants.O_RDWR,0o600),file=path.join(root,'alias.json');fs.writeFileSync(file,JSON.stringify({version:1,personal:true,barrier:5,resources}));
  const run=spawnSync(host,['--rom',rom,'--system','Game Boy','--silent','--save-dir',saves,'--storage-transaction',file],{stdio:['pipe','pipe','pipe','ignore',reservation.fd,barrier],timeout:10000});fs.closeSync(barrier);assert.notEqual(run.status,0);assert.match(run.stderr.toString(),/storage_path_changed/);assert.deepEqual(fs.readFileSync(a),Buffer.alloc(8192,0x11));assert.deepEqual(fs.readFileSync(b),Buffer.alloc(8192,0x22));
});


test('converted tape reopens the persisted WAV overlay instead of the original decoded media',async t=>{
  const {root,context,coordinator}=fixture(t),opened=await named(t,context,'converted'),tap=path.join(root,'converted.tap'),wav=path.join(root,'original.wav'),saves=path.join(root,'saves');
  fs.writeFileSync(tap,Buffer.from([2,0,0xff,0xff]));const wave=Buffer.alloc(48);wave.write('RIFF');wave.writeUInt32LE(40,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(44100,24);wave.writeUInt32LE(88200,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(4,40);wave.writeUInt16LE(1234,44);wave.writeUInt16LE(4321,46);fs.writeFileSync(wav,wave);
  const hashes=[];
  for(const rom of [tap,wav]){
    const result=spawnSync(host,['--prepare-storage','--rom',rom,'--system','ZX Spectrum','--save-dir',saves,'--silent'],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);const prepared=JSON.parse(result.stdout);
    for(const resource of prepared.resources){fs.mkdirSync(path.dirname(resource.source),{recursive:true});fs.writeFileSync(resource.source,wave);}
    const reservation=await coordinator.reserve(prepared,opened.context,'converted');t.after(()=>reservation.release());await coordinator.initialize(reservation,opened.context);
    const runtime=await native(t,rom,saves,reservation,coordinator,opened.lock,'ZX Spectrum');const reply=await runtime.client.request('checkpoint.info');assert(reply.ok,JSON.stringify(reply));hashes.push(reply.result.hash);await runtime.stop();
  }
  assert.equal(hashes[0],hashes[1],'both loads must mount the same persisted PCM');
});
