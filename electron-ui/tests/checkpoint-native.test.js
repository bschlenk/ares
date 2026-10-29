import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeZip} from './fixtures/zip.js';
import {makeFixture} from '../fixture.cjs';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {FrameParser} from '../dist/protocol.js';
import {Checkpoints} from '../dist/services/checkpoints.js';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
const host=process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=reply=>{assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result};
async function native(t,rom,options={}){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ares-checkpoint-native-'));
  if(rom)await fs.writeFile(path.join(temporary,'fixture.'+(options.extension||'gb')),rom);
  const child=spawn(host,[...(rom?['--rom',path.join(temporary,'fixture.'+(options.extension||'gb'))]:['--synthetic']),...(options.system?['--system',options.system]:[]),...(options.paused?['--paused']:[]),'--silent','--save-dir',temporary,'--control-session','checkpoint-test'],{stdio:['pipe','pipe','pipe','pipe']});
  const closed=once(child,'close');let errors='';child.stderr.on('data',b=>errors+=b);
  const parser=new FrameParser(()=>{});child.stdout.on('data',b=>parser.push(b));child.stdin.write('ack\n');
  const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'checkpoint-test',epoch:1},error=>{throw error});
  t.after(async()=>{client.close();child.stdin.end('quit\n');await closed;await fs.rm(temporary,{recursive:true,force:true})});
  return {client,temporary,errors};
}
test('generic GB checkpoints preserve pause, stream immutable captures and round-trip with epoch guards',{timeout:30000},async t=>{
  const {client,temporary}=await native(t,makeFixture());
  const info=unwrap(await client.request('checkpoint.info'));assert.equal(info.available,true);assert.match(info.hash,/^[a-f0-9]{64}$/);
  await sleep(150);unwrap(await client.request('session.pause'));
  const controller=new Checkpoints(client,{hash:info.hash,system:'Game Boy',title:'Fixture'},()=>client.identity,()=>true,()=>({fixture:true}));
  const library=new CheckpointLibrary(path.join(temporary,'states'),async file=>fs.rm(file,{recursive:true}));
  const first=await controller.save(library,true);assert.equal(unwrap(await client.request('session.status')).paused,true);
  const state=await library.read(controller.game,first.id);assert.equal(state.state[4],1,'portable synchronized serializer bytes');
  unwrap(await client.request('session.resume'));await sleep(50);
  const second=await controller.save(library,true);assert.equal(unwrap(await client.request('session.status')).paused,false);
  assert.equal((await library.list(controller.game,true)).length,2);
  const epoch=client.identity.epoch;await controller.load(library,first.id);assert.equal(client.identity.epoch,epoch+1);
  const status=unwrap(await client.request('session.status'));assert.equal(status.paused,false);assert.equal(status.checkpoint_eligible,true);
  assert.equal((await library.list(controller.game)).length,2,'loading never writes a recovery checkpoint');
  const reopened=await native(t,makeFixture());
  const reopenedInfo=unwrap(await reopened.client.request('checkpoint.info'));assert.equal(reopenedInfo.hash,info.hash);
  const reopenedController=new Checkpoints(reopened.client,controller.game,()=>reopened.client.identity,()=>true,()=>({fixture:true}));
  await reopenedController.load(library,first.id);await sleep(100);assert.equal(unwrap(await reopened.client.request('session.status')).paused,false,'portable checkpoint survives native process replacement');
  const mismatch=new Checkpoints(client,controller.game,()=>client.identity,()=>true,()=>({fixture:false}));
  await assert.rejects(mismatch.load(library,second.id),/configuration_mismatch/);
  assert.equal(client.identity.epoch,epoch+1);
});
test('synthetic capture is truthfully unavailable',async t=>{
  const {client}=await native(t);assert.equal(unwrap(await client.request('checkpoint.info')).available,false);
  assert.equal((await client.request('checkpoint.capture')).error,'unavailable');
});
test('native gameplay qualification excludes paused time and reaches ten accumulated seconds',{timeout:18000},async t=>{
  const {client}=await native(t,makeFixture());unwrap(await client.request('session.pause'));
  assert.equal(unwrap(await client.request('session.status')).checkpoint_eligible,false);
  await sleep(1000);assert.equal(unwrap(await client.request('session.status')).checkpoint_eligible,false);
  unwrap(await client.request('session.resume'));await sleep(4500);unwrap(await client.request('session.pause'));
  await sleep(1000);assert.equal(unwrap(await client.request('session.status')).checkpoint_eligible,false);
  unwrap(await client.request('session.resume'));await sleep(5700);assert.equal(unwrap(await client.request('session.status')).checkpoint_eligible,true);
});

test('normalized identities share raw/archive/moved content and separate patched content',async t=>{
  const raw=await native(t,makeFixture()),zip=await native(t,makeZip([['Inner (USA).gb',makeFixture()]]),{extension:'zip'});
  const a=unwrap(await raw.client.request('checkpoint.info')),b=unwrap(await zip.client.request('checkpoint.info'));assert.equal(a.hash,b.hash);
  const patched=makeFixture();patched[0x2000]^=1;const other=await native(t,patched);assert.notEqual(unwrap(await other.client.request('checkpoint.info')).hash,a.hash);
});
test('N64 alternate byte order shares identity and managed states round-trip a fresh native host',{timeout:60000},async t=>{
  const image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image.write('CHECKPOINT FIXTURE',0x20);image[0x3e]=0x45;image.writeUInt32BE(0x1000ffff,0x40);
  const big=await native(t,image,{extension:'z64',system:'Nintendo 64',paused:true});
  const little=await native(t,Buffer.from(image).swap32(),{extension:'n64',system:'Nintendo 64',paused:true});
  const info=unwrap(await big.client.request('checkpoint.info'));assert.equal(info.available,true);assert.equal(unwrap(await little.client.request('checkpoint.info')).hash,info.hash);
  const game={hash:info.hash,system:'Nintendo 64',title:'Fixture'},library=new CheckpointLibrary(path.join(big.temporary,'states'),async file=>fs.rm(file,{recursive:true}));
  const before=unwrap(await big.client.request('n64.debug.registers'));
  const registers=value=>({gpr:[{index:8,value}],pc:'0xb0000040',hi:null,lo:null,llbit:null,status:null});
  unwrap(await big.client.request('n64.cpu.setRegisters',undefined,registers('0x1122aabb')));
  unwrap(await little.client.request('n64.cpu.setRegisters',undefined,registers('0x8899ccdd')));
  const controller=new Checkpoints(big.client,game,()=>big.client.identity,()=>true,()=>({fixture:true}));
  const saved=await controller.save(library,true);assert.equal(unwrap(await big.client.request('session.status')).paused,true);
  const reopened=new Checkpoints(little.client,game,()=>little.client.identity,()=>true,()=>({fixture:true}));await reopened.load(library,saved.id);
  // Original branch-to-self instructions keep the restored register stable.
  // This artificial cartridge tests restoration, not commercial-game playback.
  unwrap(await little.client.request('session.pause'));
  assert.equal(unwrap(await little.client.request('session.status')).checkpoint_eligible,true);
  assert.equal(BigInt(unwrap(await little.client.request('n64.debug.registers')).gpr[8]),0x1122aabbn,'managed restore applies captured CPU registers in a fresh host');
  assert.ok(before.pc);assert.equal(little.client.identity.epoch,2);
});
