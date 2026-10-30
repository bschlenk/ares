import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {LocalServiceHost} from '../dist/services/local-endpoint.js';
import {StdioPeer} from './stdio-peer.cjs';
import {SessionRouter} from '../dist/services/session-router.js';
import {encodeRequest} from '../dist/services/contracts.js';
import {makeFixture,makeNesFixture} from '../fixture.cjs';
const nodeHost=process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
test('cross-core contracts bound leases, preserve names and reject malformed requests',()=>{
  const id={session:'contract',epoch:1};
  const request={port:1,buttons:['A','C-Up','Some Button'],leaseFrames:30,leaseMs:1000};
  assert.match(encodeRequest('req',id,'input.set',request,'owner'),/41 432d5570 536f6d6520427574746f6e owner=owner/);
  for(const bad of [{...request,leaseFrames:0},{...request,leaseFrames:601},{...request,leaseMs:0},{...request,buttons:[12]},{...request,extra:true}])assert.throws(()=>encodeRequest('req',id,'input.set',bad));
  assert.throws(()=>encodeRequest('req',id,'clock.waitStart',{frames:601,timeoutMs:1000}));
});
for(const system of ['Game Boy','Famicom'])test(`${system}: shared digital input, passive clock, ownership and lifecycle`,{timeout:25000},async()=>{
  const directory=fs.mkdtempSync('/tmp/ares-core-control-');const gb=system==='Game Boy';
  const rom=path.join(directory,gb?'fixture.gb':'fixture.nes');const bytes=gb?makeFixture():makeNesFixture();
  if(gb){
    // Original program continuously records the real JOYP register in WRAM.
    bytes.set([0xf3,0x31,0xfe,0xff,0x3e,0x10,0xe0,0x00,0xf0,0x00,0xea,0x00,0xc0,0x3e,0x20,0xe0,0x00,0xf0,0x00,0xea,0x01,0xc0,0x18,0xec],0x150);
  }else{
    // Original NROM program strobes the controller and records eight serial bits.
    bytes.set([0x78,0xd8,0xa2,0xff,0x9a,0xa9,1,0x8d,0x16,0x40,0xa9,0,0x8d,0x16,0x40,0xa2,0,0xad,0x16,0x40,0x29,1,0x95,0x10,0xe8,0xe0,8,0xd0,0xf4,0x4c,5,0x80],16);
  }
  fs.writeFileSync(rom,bytes);fs.writeFileSync(path.join(directory,'settings.bml'),'');
  const child=spawn(nodeHost,['--rom',rom,'--system',system,'--silent','--settings',path.join(directory,'settings.bml'),'--save-dir',path.join(directory,'saves'),'--control-session','core-test'],{stdio:['pipe','pipe','pipe','pipe']});
  child.stdout.resume();let log='';child.stderr.on('data',b=>log+=b);const closed=once(child,'close');
  const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'core-test',epoch:1},()=>{});
  const router=new SessionRouter();router.attach(client);const endpoint=new LocalServiceHost(router);let peer;
  const request=async(m,p,owner='owner')=>unwrap(await router.request(m,undefined,p,owner));
  async function wait(frames,timeoutMs=3000){let value=await request('clock.waitStart',{frames,timeoutMs});while(value.state==='waiting'){await sleep(10);value=await request('clock.waitRead',{waitId:value.wait_id});}return value;}
  try{
    const status=await request('session.status');assert.equal(status.support.input.available,true);assert.equal(status.support.elapsed_frames.available,true);assert.equal(status.support.observers.available,true);assert.equal(status.frame_kind,'primary-screen-frame');assert(!status.capabilities.some(m=>m.startsWith('n64.')));assert(status.implemented_services.includes('n64.input.set'));
    const ports=(await request('input.describe')).ports;const port=ports.find(p=>['A','B','Start','Up','Down','Left','Right'].every(b=>p.buttons.includes(b)));assert(port,JSON.stringify(ports));
    if(gb)assert(port.buttons.includes('Select'));
    // Let the unmodified boot ROM finish, using actual frame coordinates.
    assert.equal((await wait(gb?360:30,9000)).reason,'frames_elapsed');
    const region=(await request('memory.regions')).regions.find(r=>r.readable&&/WRAM|CPU RAM|RAM/.test(r.name)&&!/VRAM|OAM|CGRAM|Palette/.test(r.name));assert(region);
    const read=()=>request('memory.read',{region:region.id,offset:gb?0:0x10,length:gb?2:8});
    await endpoint.listen(path.join(directory,'ipc'));
    peer=new StdioPeer(process.execPath,[path.resolve(import.meta.dirname,'../dist/mcp/server.js'),'--connection',endpoint.metadataFile,'--instance',endpoint.instance]);await peer.initialize();
    assert((await peer.tool('input_describe')).ports.some(p=>p.port===port.port));
    assert.equal((await peer.tool('wait_frames',{frames:2,timeout_ms:1000})).reason,'frames_elapsed');
    assert.equal((await peer.tool('input_set',{port:port.port,buttons:['A'],lease_frames:30,lease_ms:1000})).isError,false);
    assert.equal((await peer.tool('input_release',{port:port.port})).isError,false);
    await peer.close();peer=undefined;
    const before=Date.now();const elapsed=await wait(30);assert.equal(elapsed.elapsed_frames,30);assert(Date.now()-before>250&&Date.now()-before<1800);assert.equal((await request('session.status')).paused,false);
    const held=await request('input.set',{port:port.port,buttons:['A','Start','Up','Right'],leaseFrames:120,leaseMs:5000});assert.equal(held.ports[port.port-1].owner,'owner');assert.equal(held.ports[port.port-1].latched_frame,null);
    assert.equal((await client.request('input.set',undefined,{port:port.port,buttons:['B'],leaseFrames:30,leaseMs:1000},'foreign')).error,'busy');
    assert.equal((await client.request('input.release',undefined,{port:port.port},'foreign')).error,'busy');
    await request('input.release',{port:0},'foreign');await wait(3);
    assert(Number.isSafeInteger((await request('input.state')).ports[port.port-1].latched_frame));
    const sample=Buffer.from((await read()).hex,'hex');
    if(gb){assert.equal(sample[0]&15,6);assert.equal(sample[1]&15,10);}else assert.deepEqual([...sample].map(v=>v&1),[1,0,0,1,1,0,0,1]);
    const observer=await request('scripts.observe',{source:'export default({emu})=>({frame:emu.info().frame})',args:{},timeoutMs:3000,maxFrames:0,every:1});
    await wait(3);
    const frozen=await request('script.observerRead',{observerId:observer.observer_id,offset:0,length:16384});
    assert.equal(frozen.error,'');assert(JSON.parse(Buffer.from(frozen.hex,'hex').toString()).frame>0);
    await request('script.observerStop',{observerId:observer.observer_id});
    await request('input.release',{port:0});await wait(3);
    if(gb){const sample=Buffer.from((await read()).hex,'hex');assert.equal(sample[0]&15,15);assert.equal(sample[1]&15,15);}
    await request('input.set',{port:port.port,buttons:['B'],leaseFrames:2,leaseMs:1000});await wait(4);assert.equal((await request('input.state')).ports[port.port-1].owner,null);
    for(let i=0;i<40;i++)assert.equal((await wait(0)).state,'done','zero-frame waits do not leak native handles');
    const cancellable=await request('clock.waitStart',{frames:600,timeoutMs:10000});
    await request('input.set',{port:port.port,buttons:['A'],leaseFrames:60,leaseMs:1000});
    assert.equal((await request('clock.waitCancel',{waitId:cancellable.wait_id})).reason,'cancelled');
    assert.equal((await request('input.state')).ports[port.port-1].owner,null);
    const other=ports.find(p=>p.port!==port.port);
    if(other){await request('input.set',{port:other.port,buttons:[],leaseFrames:60,leaseMs:1000},'foreign');await request('input.release',{port:0});assert.equal((await request('input.state')).ports[other.port-1].owner,'foreign');await request('input.release',{port:0},'foreign');}
    await request('session.pause');const stopped=(await request('session.status')).frame;assert.equal((await wait(2,100)).reason,'deadline');assert.equal((await request('session.status')).frame,stopped);
    await request('input.set',{port:port.port,buttons:['A'],leaseFrames:60,leaseMs:50});await sleep(90);assert.equal((await request('input.state')).ports[port.port-1].owner,null);
    const invalidated=await request('clock.waitStart',{frames:30,timeoutMs:1000});
    const stale={...client.identity};await request('session.reset');assert.equal((await request('clock.waitRead',{waitId:invalidated.wait_id})).reason,'reset');assert.equal((await client.request('input.set',stale,{port:port.port,buttons:['A'],leaseFrames:30,leaseMs:1000},'owner')).error,'stale_epoch');
    await request('input.set',{port:port.port,buttons:['A'],leaseFrames:60,leaseMs:1000});await request('execution.release');assert.equal((await request('input.state')).ports[port.port-1].owner,null);
    await request('input.set',{port:port.port,buttons:['A'],leaseFrames:60,leaseMs:1000});child.stdin.write('key Space 1\n');await sleep(60);assert.equal((await request('input.state')).ports[port.port-1].owner,null);
  }finally{
    if(peer)await peer.close();await endpoint.close();router.detach();client.close();child.stdin.end('quit\n');const [code]=await closed;fs.rmSync(directory,{recursive:true,force:true});assert.equal(code,0,log);
  }
});
