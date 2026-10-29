// Explicit private cross-core inputs. Copies ROM/firmware; never writes originals.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {inflateSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {SessionRouter} from '../dist/services/session-router.js';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
import {Checkpoints} from '../dist/services/checkpoints.js';
const manifest=process.argv[2];assert(manifest,'Usage: node tests/checkpoint-cross-core.js /path/to/private-games.json');
const games=JSON.parse(await fs.readFile(manifest,'utf8'));assert(Array.isArray(games)&&games.length,'Provide a nonempty game array');
const output=path.resolve(process.env.ARES_CHECKPOINT_EVIDENCE||path.join(import.meta.dirname,'../artifacts/save-states/cross-core'));
await fs.mkdir(output,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=reply=>{assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result};
function imageColors(png){
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),chunks=[];
  for(let at=8;at<png.length;){const size=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')chunks.push(png.subarray(at+8,at+8+size));at+=size+12}
  const raw=inflateSync(Buffer.concat(chunks)),colors=new Set();
  for(let y=0;y<height;y++){assert.equal(raw[y*(width*3+1)],0);for(let x=0;x<width;x++){const at=y*(width*3+1)+1+x*3;colors.add(raw.readUIntBE(at,3));if(colors.size>=32)return colors.size}}
  return colors.size;
}
const results=[];
for(const spec of games){
  assert(['Game Boy Advance','Game Boy Color','Super Famicom'].includes(spec.system));assert(typeof spec.rom==='string'&&typeof spec.name==='string');
  const sources=[spec.rom,...(spec.bios?[spec.bios]:[])],before=await Promise.all(sources.map(hash));
  const temporary=await fs.mkdtemp('/tmp/ares-checkpoints-cross-core-'),instances=[];
  const slug=spec.system.toLowerCase().replaceAll(' ','-');
  async function native(label,paused){
    const rom=path.join(temporary,`${label}${path.extname(spec.rom)}`);await fs.copyFile(spec.rom,rom);
    const settings=path.join(temporary,`${label}.bml`);let bml='';
    if(spec.bios){const bios=path.join(temporary,'copied-bios.bin');await fs.copyFile(spec.bios,bios);bml=`GameBoyAdvance\n  Firmware\n    BIOS.World: ${bios}\n`}
    await fs.writeFile(settings,bml);
    const identity={session:randomUUID(),epoch:1};
    const child=spawn(process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',rom,'--system',spec.system,'--silent',...(paused?['--paused']:[]),'--settings',settings,'--save-dir',path.join(temporary,label,'saves'),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});
    const closed=once(child,'close');let log='';child.stdout.resume();child.stderr.on('data',bytes=>log=(log+bytes).slice(-65536));
    const client=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),router=new SessionRouter();router.attach(client);
    const instance={child,closed,client,router,label,log:()=>log};instances.push(instance);unwrap(await router.request('session.status'));return instance;
  }
  const read=(instance,region)=>instance.router.request('memory.read',undefined,{region:region.id,offset:128,length:64}).then(unwrap);
  function controller(instance,game,configuration){return new Checkpoints({request:(method,identity,params,owner)=>instance.router.request(method,identity,method==='checkpoint.commit'?{...params,resume:false}:params,owner)},game,()=>instance.client.identity,()=>true,()=>({configuration_sha256:configuration}))}
  try{
    console.log(`CROSS_CORE_START: ${spec.system}: ${spec.name}`);
    const first=await native('source',false);await sleep(4000);
    // Standard virtual-port mapping: Start, then A/Start through title screens.
    for(const [sequence,mask] of [[1,512],[2,0],[3,32],[4,0],[5,512],[6,0]]){first.child.stdin.write(`input ${sequence} ${mask}\n`);await sleep(mask?150:450)}
    await sleep(1500);unwrap(await first.router.request('session.pause'));
    const info=unwrap(await first.router.request('checkpoint.info'));assert.equal(info.available,true);
    const game={hash:info.hash,system:spec.system,title:spec.name},library=new CheckpointLibrary(path.join(temporary,'states'),file=>fs.rm(file,{recursive:true}));
    const regions=unwrap(await first.router.request('memory.regions')).regions;
    const region=regions.find(r=>r.readable&&r.writable&&r.size>=256&&/WRAM|Work RAM|EWRAM|IWRAM/i.test(r.name))||regions.find(r=>r.readable&&r.writable&&r.size>=256&&/RAM/i.test(r.name)&&!/VRAM|Video|Palette|OAM|Save/i.test(r.name));
    assert(region,JSON.stringify(regions));
    let displayed,visibleColors=0;
    for(let attempt=0;attempt<40;attempt++){
      displayed=unwrap(await first.router.request('artifact.screenshot',undefined,{source:'presented',path:path.join(output,slug+'-before-capture.png'),overwrite:true,inline:false,region:null,scale:1}));
      visibleColors=imageColors(await fs.readFile(path.join(output,slug+'-before-capture.png')));if(visibleColors>=16)break;
      unwrap(await first.router.request('session.resume'));await sleep(500);unwrap(await first.router.request('session.pause'));
    }
    assert(visibleColors>=16,`No visible ${spec.system} game screen after bounded boot wait`);

    const managed=controller(first,game,info.configuration),saved=await managed.save(library,true);
    console.log('SCREENSHOT_CAPTURE',spec.system,{before:displayed.sha256,after:saved.screenshot.sha256,equal:displayed.sha256===saved.screenshot.sha256});
    const baseline=await read(first,region),directory=await library.revealPath(game,saved.id),image=await fs.readFile(path.join(directory,`${saved.id}.png`));
    assert(image.readUInt32BE(16)>1&&image.readUInt32BE(20)>1);assert(imageColors(image)>=16,'managed capture must retain the visible game image');
    const changed=Buffer.from(baseline.hex,'hex');changed[0]^=0xff;
    unwrap(await first.router.request('memory.write',undefined,{region:region.id,offset:128,hex:changed.toString('hex')}));assert.notEqual((await read(first,region)).hex,baseline.hex);
    await managed.load(library,saved.id);assert.equal((await read(first,region)).hex,baseline.hex,'same-host managed restore applies captured work RAM');
    const second=await native('moved-and-renamed',true),freshInfo=unwrap(await second.router.request('checkpoint.info'));assert.equal(freshInfo.hash,info.hash);assert.equal(freshInfo.configuration,info.configuration);
    const freshRegions=unwrap(await second.router.request('memory.regions')).regions,freshRegion=freshRegions.find(r=>r.name===region.name);assert(freshRegion);
    await controller(second,game,freshInfo.configuration).load(library,saved.id);assert.equal((await read(second,freshRegion)).hex,baseline.hex,'fresh-host managed restore applies captured work RAM');
    assert.equal((await library.list({...game,title:'New display title'})).length,1);assert.equal(unwrap(await second.router.request('session.status')).checkpoint_eligible,true);
    unwrap(await second.router.request('session.resume'));await sleep(120);unwrap(await second.router.request('session.pause'));
    const after=await controller(second,game,freshInfo.configuration).save(library,true),afterFolder=await library.revealPath(game,after.id);
    await fs.writeFile(path.join(output,slug+'.png'),image);await fs.copyFile(path.join(afterFolder,`${after.id}.png`),path.join(output,slug+'-resumed.png'));
    const result={result:'CROSS_CORE_CHECKPOINT_PASS',system:spec.system,name:spec.name,source_sha256:before,game,configuration:info.configuration,state_bytes:saved.state.bytes,screenshot_bytes:saved.screenshot.bytes,screenshot_dimensions:[image.readUInt32BE(16),image.readUInt32BE(20)],screenshot_colors:imageColors(image),display_aspect:saved.screenshot.aspect,region:region.name,same_host_ram_equal:true,fresh_host_ram_equal:true,source_checkpoint_unchanged:(await library.read(game,saved.id)).metadata.state.sha256===saved.state.sha256};
    assert(result.source_checkpoint_unchanged);if(spec.system==='Super Famicom')assert(saved.screenshot.aspect<1.6&&saved.screenshot.aspect>1.2,'SNES display aspect must correct its double-width raster');results.push(result);console.log(JSON.stringify(result));
  }finally{
    for(const instance of instances){instance.router.detach();instance.client.close();instance.child.stdin.end('quit\n');await Promise.race([instance.closed,sleep(2000)]);if(instance.child.exitCode===null&&instance.child.signalCode===null){instance.child.kill('SIGKILL');await instance.closed}await fs.writeFile(path.join(output,`${slug}-${instance.label}.log`),instance.log())}
    assert.deepEqual(await Promise.all(sources.map(hash)),before,'original ROM/BIOS files changed');await fs.rm(temporary,{recursive:true,force:true});
  }
}
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({result:'CROSS_CORE_CHECKPOINTS_PASS',games:results},null,2));
console.log('CROSS_CORE_CHECKPOINTS_PASS');
