// Opt-in real-media regression. All emulation and filesystem writes use copies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {SessionRouter} from '../dist/services/session-router.js';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
import {Checkpoints} from '../dist/services/checkpoints.js';
const romSource=process.env.ARES_PLUGIN_TEST_ROM,stateSource=process.env.ARES_PLUGIN_TEST_STATE,oldSource=process.env.ARES_PLUGIN_TEST_OLD_STATE;
assert(romSource&&stateSource,'Set ARES_PLUGIN_TEST_ROM and ARES_PLUGIN_TEST_STATE');
const output=path.resolve(process.env.ARES_CHECKPOINT_EVIDENCE||path.join(import.meta.dirname,'../artifacts/save-states/private'));
await fs.mkdir(output,{recursive:true});
const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sources=[romSource,stateSource,...(oldSource?[oldSource]:[])],before=await Promise.all(sources.map(digest));
const temporary=await fs.mkdtemp('/tmp/ares-checkpoints-private-'),instances=[];
const unwrap=reply=>{assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result};
async function native(file,label){
  const settings=path.join(temporary,`${label}.bml`);await fs.writeFile(settings,'');
  const child=spawn(process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',file,'--system','Nintendo 64','--silent','--paused','--settings',settings,'--save-dir',path.join(temporary,label,'saves'),'--control-session',randomUUID()],{stdio:['pipe','pipe','pipe','pipe']});
  // Match the explicit session argument, never discover a running user app.
  const identity={session:child.spawnargs.at(-1),epoch:1},closed=once(child,'close');let log='';
  child.stdout.resume();child.stderr.on('data',bytes=>log=(log+bytes).slice(-65536));
  const client=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),router=new SessionRouter();router.attach(client);
  const instance={child,closed,client,router,label,log:()=>log};instances.push(instance);
  unwrap(await router.request('session.status'));return instance;
}
function controller(instance,game,configuration){
  // Keep restored positions paused for exact register/pixel comparisons. Product
  // UI uses resume:true; its behavior is covered by the Electron fixture.
  const client={request:(method,identity,params,owner)=>instance.router.request(method,identity,method==='checkpoint.commit'?{...params,resume:false}:params,owner)};
  return new Checkpoints(client,game,()=>instance.client.identity,()=>true,()=>({configuration_sha256:configuration}));
}
try{
  const rom=path.join(temporary,'renamed-game.z64'),state=path.join(temporary,'legacy-position.arbitrary');
  await fs.copyFile(romSource,rom);await fs.copyFile(stateSource,state);
  try{await fs.copyFile(stateSource+'.json',state+'.json')}catch(error){if(error.code!=='ENOENT')throw error}
  const first=await native(rom,'first');unwrap(await first.router.request('state.load',undefined,{path:state,resume:false,keepOverrides:false}));
  const info=unwrap(await first.router.request('checkpoint.info'));assert.equal(info.available,true);
  const game={hash:info.hash,system:'Nintendo 64',title:'Kirby 64 - The Crystal Shards'},warnings=[];
  const library=new CheckpointLibrary(path.join(temporary,'library'),file=>fs.rm(file,{recursive:true}),message=>warnings.push(message));
  const managed=controller(first,game,info.configuration),registers=unwrap(await first.router.request('n64.debug.registers'));
  const saved=await managed.save(library,true),original=await library.read(game,saved.id),folder=await library.revealPath(game,saved.id);
  const png=await fs.readFile(path.join(folder,`${saved.id}.png`));
  assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),237,'private gameplay position has an actual VI screenshot');
  const changed='0x'+(BigInt(registers.gpr[8])^0x55n).toString(16);
  unwrap(await first.router.request('n64.cpu.setRegisters',undefined,{gpr:[{index:8,value:changed}],pc:null,hi:null,lo:null,llbit:null,status:null}));
  assert.notEqual(unwrap(await first.router.request('n64.debug.registers')).gpr[8],registers.gpr[8]);
  await managed.load(library,saved.id);assert.deepEqual(unwrap(await first.router.request('n64.debug.registers')),registers);
  const restored=await managed.save(library,true);assert.equal(restored.screenshot.sha256,saved.screenshot.sha256,'screenshot matches restored saved position');
  assert.equal((await library.read(game,saved.id)).metadata.state.sha256,original.metadata.state.sha256,'source checkpoint remains unchanged');
  const swapped=path.join(temporary,'moved-game.v64');await fs.writeFile(swapped,Buffer.from(await fs.readFile(romSource)).swap16());
  const second=await native(swapped,'reopened'),secondInfo=unwrap(await second.router.request('checkpoint.info'));
  assert.equal(secondInfo.hash,info.hash,'ROM rename/move and alternate byte order keep collection identity');assert.equal(secondInfo.configuration,info.configuration);
  await controller(second,game,secondInfo.configuration).load(library,saved.id);
  assert.deepEqual(unwrap(await second.router.request('n64.debug.registers')),registers,'exact private position restores in a fresh host');
  const fresh=await controller(second,game,secondInfo.configuration).save(library,true);assert.equal(fresh.screenshot.sha256,saved.screenshot.sha256);
  const inventory=await library.list({...game,title:'Renamed display title'},true);assert.equal(inventory.length,3);
  let oldVersion;
  if(oldSource){
    const old=path.join(temporary,'old-version.arbitrary');await fs.copyFile(oldSource,old);const epoch=second.client.identity.epoch;
    const rejected=await second.router.request('state.load',undefined,{path:old,resume:false,keepOverrides:false});assert.equal(rejected.error,'unsupported_version');assert.equal(second.client.identity.epoch,epoch);
    assert.deepEqual(unwrap(await second.router.request('n64.debug.registers')),registers);oldVersion='unsupported_version_without_mutation';
  }
  assert.equal(unwrap(await second.router.request('session.status')).checkpoint_eligible,true);assert.deepEqual(warnings,[]);
  await fs.writeFile(path.join(output,'position.png'),png);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({result:'PRIVATE_CHECKPOINT_PASS',game,configuration:info.configuration,original_sha256:before,captures:inventory.map(({screenshotUrl,...entry})=>entry),old_version:oldVersion,legacy_arbitrary_extension:true,fresh_host_registers_equal:true,fresh_host_screenshot_equal:true},null,2));
  console.log('PRIVATE_CHECKPOINT_PASS: current legacy state loads under arbitrary suffix; managed state/pixels match after mutation and fresh-host restore; renamed/swapped ROM shares collection; originals unchanged');
}finally{
  for(const instance of instances){instance.router.detach();instance.client.close();instance.child.stdin.end('quit\n');await Promise.race([instance.closed,new Promise(resolve=>setTimeout(resolve,2000))]);if(instance.child.exitCode===null&&instance.child.signalCode===null){instance.child.kill('SIGKILL');await instance.closed}await fs.writeFile(path.join(output,instance.label+'.log'),instance.log())}
  const after=await Promise.all(sources.map(digest));assert.deepEqual(after,before,'original private media/state bytes changed');
  await fs.rm(temporary,{recursive:true,force:true});
}
