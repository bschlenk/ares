import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {makeFixture} from '../fixture.cjs';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {FrameParser} from '../dist/protocol.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const system of ['Game Boy','Game Boy Color'])for(const bounded of [false,true])test(`${system}: readonly coherent execution evidence (${bounded?'invalid stack boundary':'nested stack'})`,{timeout:20000},async()=>{
 const dir=fs.mkdtempSync('/tmp/ares-execution-'),rom=makeFixture();rom.fill(0,0x150);if(system==='Game Boy Color'){rom[0x143]=0x80;let sum=0;for(let i=0x134;i<=0x14c;i++)sum=(sum-rom[i]-1)&255;rom[0x14d]=sum;}
 const code=bounded?[0xf3,0x31,0xfe,0xff,0xc3,0x80,0x01]:[0xf3,0x3e,0x03,0xe0,0x70,0x31,0xf0,0xdf,0x01,0x34,0x12,0xc5,0x11,0x78,0x56,0xd5,0xcd,0x80,0x01];rom.set(code,0x150);rom.set([0xc3,0x80,0x01],0x180);const file=path.join(dir,'execution.gb');fs.writeFileSync(file,rom);
 const child=spawn(process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',file,'--system',system,'--silent','--save-dir',path.join(dir,'saves'),'--control-session','execution'],{stdio:['pipe','pipe','pipe','pipe']});
 const closed=once(child,'close');let log='',closing=false;child.stderr.on('data',b=>log+=b);const parser=new FrameParser(()=>{if(!closing)child.stdin.write('ack\n')});child.stdout.on('data',b=>parser.push(b));child.stdin.write('ack\n');
 const client=new NativeSessionClient(child.stdin,child.stdio[3],{session:'execution',epoch:1},()=>{}),request=async(m,p)=>{const r=await client.request(m,undefined,p,'execution-test');assert(r.ok,JSON.stringify(r));return r.result;};
 try{
  const regions=(await request('memory.regions')).regions,region=regions.find(r=>r.format==='ares.gb.execution.v1');assert(region);assert.equal(region.size,160);assert.equal(region.writable,false);
  const wram=regions.find(r=>r.name==='CPU WRAM');let w=await request('clock.waitStart',{frames:200,timeoutMs:10000});while(w.state==='waiting'){await sleep(10);w=await request('clock.waitRead',{waitId:w.wait_id});}assert.equal(w.reason,'frames_elapsed');
  const sample=await request('memory.readMany',{reads:[{region:region.id,offset:0,length:160},{region:wram.id,offset:system==='Game Boy Color'?0x3fea:0x1fea,length:6}]});const b=Buffer.from(sample.reads[0].hex,'hex');assert.equal(b.subarray(0,4).toString(),'GBEX');assert.equal(b[4],1);assert(b.readUInt16LE(8)>=0x180&&b.readUInt16LE(8)<=0x183,'PC may point inside the in-flight JP instruction');assert.equal(sample.epoch,1);assert(sample.frame>0);
  if(bounded){assert.equal(b.readUInt16LE(10),0xfffe);assert.equal(b[0x60],1);assert(b.subarray(0x61,0xa0).every(v=>v===0));assert(b.subarray(0x21,0x60).every(v=>v===0));}
  else{assert.equal(b.readUInt16LE(10),0xdfea);assert.equal(b.readUInt16LE(14),0x1234);assert.equal(b.readUInt16LE(16),0x5678);assert.equal(b.subarray(0x20,0x26).toString('hex'),'630178563412');assert.equal(sample.reads[1].hex,'630178563412');assert(b.subarray(0x60,0xa0).every(v=>v===1));}
  const write=await client.request('memory.write',undefined,{region:region.id,offset:8,hex:'0000'},'execution-test');assert.equal(write.error,'region_not_writable');
  const next=await request('session.status');assert.equal(next.paused,false);
 }finally{closing=true;client.close();child.stdin.end('quit\n');await Promise.race([closed,sleep(2000).then(()=>child.kill())]);fs.rmSync(dir,{recursive:true,force:true});}
});
