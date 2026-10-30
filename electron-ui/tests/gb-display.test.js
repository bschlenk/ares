import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {SessionRouter} from '../dist/services/session-router.js';
import {LocalServiceHost} from '../dist/services/local-endpoint.js';
import {StdioPeer} from './stdio-peer.cjs';
import {FrameParser} from '../dist/protocol.js';
import {makeDisplayFixture} from './gb-display-fixture.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.result;};
function composeDmg(data,x,y){
  const reg=i=>data[0x40+i],vram=data.subarray(0x100,0x4100),lcdc=reg(0),palette=reg(7);
  if(!(lcdc&128))return 0;
  const window=!!(lcdc&32)&&y>=reg(10)&&x>=reg(11)-7;
  const sx=window?x-reg(11)+7:(x+reg(3))&255,sy=window?y-reg(10):(y+reg(2))&255;
  const map=(window?(lcdc&64?0x1c00:0x1800):(lcdc&8?0x1c00:0x1800));
  const tile=vram[map+((sy>>3)*32)+(sx>>3)];
  const address=(lcdc&16?tile*16:0x1000+(tile<128?tile:tile-256)*16)+(sy&7)*2;
  let color=(lcdc&1)?((vram[address]>>(7-(sx&7)))&1)|(((vram[address+1]>>(7-(sx&7)))&1)<<1):0;
  let shade=(palette>>(color*2))&3;
  if(lcdc&2)for(let i=0;i<40;i++){
    const o=0x4100+i*4,ox=data[o+1]-8,oy=data[o]-16;
    if(x<ox||x>=ox+8||y<oy||y>=oy+8)continue;
    const attr=data[o+3],row=attr&64?7-(y-oy):y-oy,col=attr&32?x-ox:7-(x-ox),a=data[o+2]*16+row*2;
    const pixel=((vram[a]>>col)&1)|(((vram[a+1]>>col)&1)<<1);
    if(pixel&&(!(attr&128)||!color)){shade=(reg(attr&16?9:8)>>(pixel*2))&3;break;}
  }
  return shade;
}
for(const system of ['Game Boy','Game Boy Color'])test(`${system}: frozen PPU state, frame identity and readonly display data`,{timeout:25000},async()=>{
  const directory=fs.mkdtempSync('/tmp/ares-display-'),rom=path.join(directory,'display.gb');fs.writeFileSync(rom,makeDisplayFixture());
  const settings=path.join(directory,'settings.bml');fs.writeFileSync(settings,'Video\n  InterframeBlending: false\n');
  const child=spawn(process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',rom,'--system',system,'--silent','--settings',settings,'--save-dir',path.join(directory,'saves'),'--control-session','display'],{stdio:['pipe','pipe','pipe','pipe']});
  const closed=once(child,'close');let closing=false,log='';child.stderr.on('data',b=>log+=b);
  const frames=new Map(),parser=new FrameParser(frame=>{if(frame.frameReference)frames.set(frame.frameReference.frame,frame);while(frames.size>32)frames.delete(frames.keys().next().value);if(!closing)child.stdin.write('ack\n');});child.stdout.on('data',b=>parser.push(b));child.stdin.write('ack\n');
  const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'display',epoch:1},()=>{});
  const router=new SessionRouter();router.attach(client);const endpoint=new LocalServiceHost(router);let peer;
  const request=async(m,p,owner='display-owner')=>unwrap(await client.request(m,undefined,p,owner));
  async function wait(n){let w=await request('clock.waitStart',{frames:n,timeoutMs:10000});while(w.state==='waiting'){await sleep(10);w=await request('clock.waitRead',{waitId:w.wait_id});}assert.equal(w.reason,'frames_elapsed');}
  async function capture(region){
    const sample=await request('memory.sample',{reads:[{region:region.id,offset:0,length:region.size}],scheduling:'boundary'});let status;
    do{status=await request('memory.capture.status',{handle:sample.handle});if(status.pending)await sleep(5);}while(status.pending);
    const parts=[];let reference;
    for(let offset=0;offset<region.size;offset+=16384){const page=await request('memory.capture.read',{handle:sample.handle,sequence:0,range:0,offset,length:Math.min(16384,region.size-offset)});parts.push(Buffer.from(page.hex,'hex'));reference=page.frame_reference;assert.equal(page.frame,status.first_frame);}
    return {data:Buffer.concat(parts),reference,handle:sample.handle};
  }
  try{
    const regions=(await request('memory.regions')).regions,region=regions.find(r=>r.format==='ares.gb.ppu-display.v1');assert(region);assert.equal(region.size,0xf700);assert.equal(region.writable,false);
    assert.equal((await client.request('memory.write',undefined,{region:region.id,offset:0x40,hex:'00'},'display-owner')).error,'region_not_writable');
    await wait(400);
    await endpoint.listen(path.join(directory,'ipc'));peer=new StdioPeer(process.execPath,[path.resolve(import.meta.dirname,'../dist/mcp/server.js'),'--connection',endpoint.metadataFile,'--instance',endpoint.instance]);await peer.initialize();
    const advertised=(await peer.tool('memory_regions')).regions.find(r=>r.format==='ares.gb.ppu-display.v1');assert.equal(advertised.id,region.id);assert.equal(advertised.writable,false);
    const mcp=await peer.tool('memory_sample',{reads:[{region:region.id,offset:0,length:128}],scheduling:'boundary'});assert.equal(mcp.isError,false);
    let ready;do{ready=await peer.tool('memory_capture_status',{handle:mcp.handle});if(ready.pending)await sleep(5);}while(ready.pending);
    const page=await peer.tool('memory_capture_read',{handle:mcp.handle,sequence:0,range:0,offset:0,length:128});assert.equal(Buffer.from(page.hex,'hex').toString('ascii',0,4),'GBDS');assert.equal(page.frame_reference.boundary,'primary-screen-frame');
    await peer.close();peer=undefined;
    const first=await capture(region),d=first.data;assert.equal(d.toString('ascii',0,4),'GBDS');assert.equal(d[4],1);assert.equal(d[5]&1,system==='Game Boy Color'?1:0);assert.equal(d.readUInt16LE(12),system==='Game Boy Color'?16384:8192);
    const named=[['PPU VRAM',0x100],['PPU OAM',0x4100],['PPU BGP',0x41a0],['PPU OBP',0x41a4],['PPU BGPD',0x41b0],['PPU OBPD',0x41f0]].map(([name,offset])=>({region:regions.find(r=>r.name===name),offset})).filter(r=>r.region);
    const separate=await request('memory.readMany',{reads:named.map(({region})=>({region:region.id,offset:0,length:region.size}))});
    separate.reads.forEach((read,i)=>assert.equal(read.hex,d.subarray(named[i].offset,named[i].offset+named[i].region.size).toString('hex')));
    assert.equal(d[0x40],0xf3);assert.equal(d[0x42],11);assert.equal(d[0x43],7);assert.equal(d[0x4a],64);assert.equal(d[0x4b],87);assert.equal(d[6],0);assert.equal(d[10],144);
    assert.equal(first.reference.boundary,'primary-screen-frame');assert.equal(first.reference.epoch,1);assert.equal(first.reference.native_session,'display');
    if(system==='Game Boy'){
      for(let y=0;y<144;y++)for(let x=0;x<160;x++)assert.equal(d.readUInt16LE(0x4300+(y*160+x)*2),composeDmg(d,x,y),`pixel ${x},${y}`);
      for(let i=0;i<100&&!frames.has(first.reference.frame);i++)await sleep(5);
      const presented=frames.get(first.reference.frame);assert(presented,'snapshot matches an actually presented frame');
      const palette=[[174,217,39],[88,160,40],[32,98,41],[26,69,42]];
      for(let n=0;n<160*144;n++){const rgb=palette[d.readUInt16LE(0x4300+n*2)];assert.deepEqual([...presented.pixels.subarray(n*4,n*4+3)],rgb);}
    }
    const port=(await request('input.describe')).ports.find(p=>p.buttons.includes('Start'));
    await request('input.set',{port:port.port,buttons:['Start'],leaseFrames:60,leaseMs:3000});await wait(4);const moved=await capture(region);assert.equal(moved.data[0x43],15);assert.equal(moved.data[0x4a],40);assert.equal(moved.data[0x4b],47);await request('memory.capture.release',{handle:moved.handle});
    await request('input.set',{port:port.port,buttons:['A'],leaseFrames:60,leaseMs:3000});await wait(4);const off=await capture(region);assert.equal(off.data[7],0);assert.equal(off.data[0x40],0);assert(off.data.subarray(0x4300).every(v=>v===0||system!=='Game Boy'));await request('memory.capture.release',{handle:off.handle});
    await request('input.release',{port:0});await wait(4);assert.equal((await request('session.status')).paused,false);
    const retained=await request('memory.capture.read',{handle:first.handle,sequence:0,range:0,offset:0,length:128});assert.equal(retained.hex,d.subarray(0,128).toString('hex'));
    assert.equal((await client.request('memory.capture.status',undefined,{handle:first.handle},'foreign')).error,'stale_memory_handle');
    await request('session.reset');assert.equal((await client.request('memory.capture.status',undefined,{handle:first.handle},'display-owner')).error,'stale_memory_handle');
  }finally{if(peer)await peer.close();await endpoint.close();router.detach();closing=true;client.close();child.stdin.end('quit\n');assert.equal((await closed)[0],0,log);fs.rmSync(directory,{recursive:true,force:true});}
});
