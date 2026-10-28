// Opt-in private-media regression. Originals are read-only; all writes are isolated.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {waitForScript} from '../dist/services/script-wait.js';
const [bundle,romSource,stateSource,output]=process.argv.slice(2);
assert(bundle&&romSource&&stateSource&&output,'Usage: continuous-packaged.js APP ROM STATE OUTPUT_DIRECTORY');
const dir=await fs.mkdtemp('/tmp/ares-continuous-');
await fs.mkdir(output,{recursive:true});
const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const original=[await digest(romSource),await digest(stateSource)];
const rom=path.join(dir,'game.z64'),state=path.join(dir,'initial.state');
await fs.copyFile(romSource,rom);await fs.copyFile(stateSource,state);
const env={...process.env,ARES_PROFILE_DIR:path.join(dir,'profile'),ARES_SERVICE_DIR:path.join(dir,'ipc'),ARES_ROM:rom,ARES_SYSTEM:'Nintendo 64',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_DISABLE_PLUGINS:'1'};
for(const key of ['ELECTRON_RUN_AS_NODE','ARES_HOST','ARES_SETTINGS','ARES_SAVE_DIR','ARES_AUTOTEST'])delete env[key];
const child=spawn(path.join(bundle,'Contents/MacOS/Ares'),['--services'],{env,stdio:['ignore','ignore','pipe']});
const closed=once(child,'close');let log='',client;
child.stderr.on('data',b=>log=(log+b).slice(-65536));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let n=0;n<400;++n){
  if(child.exitCode!==null)throw Error('App exited: '+log);
  try{const files=(await fs.readdir(env.ARES_SERVICE_DIR)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));if(files.length===1){client??=new LocalServiceClient(path.join(env.ARES_SERVICE_DIR,files[0]),path.basename(files[0],'.json'));const r=await client.request('session.status');if(r.ok&&r.result?.game?.sha256===original[0])break;}}catch{}
  await sleep(50);
 }
 assert(client,'App discovery failed');
 const build=await client.manage({operation:'build_info'});
 const started=await client.request('scripts.run',undefined,{source:`export default async({emu,mem,input,frames,args})=>{await emu.loadState(args.state);mem.writeU32(0x8012e850,20,'rdram');mem.writeU32(0x800d6e90,20,'rdram');await frames(10);const statues=[];for(let i=0;i<1800;++i){input({b:i<1440&&i%120<4});await frames(1);statues.push(mem.u32(0x800d71f8,'rdram'));}return {frames:1800,statues};}`,args:{state},statePaths:[state],videoPath:path.join(output,'continuous.avi'),timeoutMs:600000,maxFrames:2000});
 assert(started.ok,JSON.stringify(started));const identity={session:started.session,epoch:started.epoch};
 const final=await waitForScript(client,started.result,identity,{timeoutMs:610000});assert.equal(final.stop_reason,'script_done',JSON.stringify(final));
 const chunks=[];let offset=0,page;
 do{page=await client.manage({operation:'script_result',handle:started.result.result_handle,offset,length:16384});const bytes=Buffer.from(page.hex,'hex');assert(bytes.length||offset===page.bytes);chunks.push(bytes);offset+=bytes.length;}while(offset<page.bytes);
 const result=JSON.parse(Buffer.concat(chunks));assert.equal(result.frames,1800);assert.equal(result.statues.length,1800);
 const video=final.script_output?.video;assert(video,JSON.stringify(final));assert.equal(video.frames,1810);assert.equal(video.source,'framebuffer');assert.equal(video.width,320);assert.equal(video.height,237);assert.equal(final.script_output.video_complete,true);
 assert.deepEqual([await digest(romSource),await digest(stateSource)],original);
 await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify({build,final,result,original_sha256:original},null,2));
 console.log(JSON.stringify({result:'CONTINUOUS_PACKAGED_PASS',frames:video.frames,bytes:video.bytes,source:video.source,build}));
}finally{
 client?.close();child.kill('SIGTERM');await Promise.race([closed,sleep(3000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
 await fs.writeFile(path.join(output,'stderr.log'),log);await fs.rm(dir,{recursive:true,force:true});
}
