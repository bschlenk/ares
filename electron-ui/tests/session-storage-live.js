import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import electron from 'electron';
import {makeFixture} from '../fixture.cjs';

// Original battery cartridge: increment its first saved byte after boot, then
// run the ordinary graphics fixture. Each app must retain its own progression.
const root=fs.mkdtempSync('/tmp/ares-storage-live-'),profile=path.join(root,'personal'),rom=path.join(root,'battery.gb'),children=[];
fs.mkdirSync(profile);const bytes=makeFixture();bytes[0x147]=3;bytes[0x149]=2;let checksum=0;for(let n=0x134;n<=0x14c;n++)checksum=(checksum-bytes[n]-1)&255;bytes[0x14d]=checksum;
bytes.set([0xc3,0x00,0x30],0x150);bytes.set([0xf3,0x31,0xfe,0xff,0x3e,0x0a,0xea,0x00,0x00,0xfa,0x00,0xa0,0x3c,0xea,0x00,0xa0,0xc3,0x54,0x01],0x3000);fs.writeFileSync(rom,bytes);
function launch(name){
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ARES_')&&key!=='ARES_HOST')delete env[key];
  Object.assign(env,{ARES_PROFILE_DIR:profile,ARES_SERVICE_DIR:path.join(root,'ipc-'+children.length),ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0',ARES_ENABLE_SERVICES:'1',ARES_SILENT:'1',ARES_STORAGE_ROM:rom});
  const child=spawn(electron,[new URL('./electron-session-storage.js',import.meta.url).pathname,...(name?['--session-name',name]:[])],{env,stdio:['ignore','pipe','pipe']});const result={child,closed:once(child,'close'),log:''};for(const stream of [child.stdout,child.stderr])stream.on('data',data=>result.log+=data);children.push(result);return result;
}
async function ready(result){for(let attempt=0;attempt<1000;attempt++){const match=result.log.match(/STORAGE_READY (.+)\n/);if(match)return JSON.parse(match[1]);if(result.child.exitCode!==null)throw Error(result.log);await new Promise(resolve=>setTimeout(resolve,20));}throw Error('storage startup timeout: '+result.log);}
async function close(result){result.child.kill('SIGTERM');assert.equal((await result.closed)[0],0,result.log);}
const timer=setTimeout(()=>{for(const result of children)result.child.kill('SIGKILL')},90000);
try{
  const personalSave=path.join(profile,'saves','Game Boy','battery.ram');fs.mkdirSync(path.dirname(personalSave),{recursive:true});fs.writeFileSync(personalSave,Buffer.alloc(8192,0x20));
  const personal=launch(),personalInfo=await ready(personal);assert.equal(personalInfo.kind,'personal');
  const a=launch('alpha'),aInfo=await ready(a),b=launch('beta'),bInfo=await ready(b);
  assert.notEqual(aInfo.dataRoot,bInfo.dataRoot);assert.notEqual(aInfo.dataRoot,profile);
  await Promise.all([close(a),close(b),close(personal)]);
  const localSave=context=>{const data=JSON.parse(fs.readFileSync(path.join(context.dataRoot,'data.json')));const entry=Object.entries(data.initialized).find(([,row])=>row.source===fs.realpathSync(personalSave));assert(entry);return path.join(context.dataRoot,'storage',entry[0],'data');};
  const as=localSave(aInfo),bs=localSave(bInfo);for(const file of [personalSave,as,bs])assert.equal(fs.readFileSync(file)[0],0x21,file);
  const originalPersonal=fs.readFileSync(personalSave);const reopened=launch('alpha'),again=await ready(reopened);assert.equal(again.dataRoot,aInfo.dataRoot);await close(reopened);
  assert.equal(fs.readFileSync(as)[0],0x22);assert.equal(fs.readFileSync(bs)[0],0x21);assert.deepEqual(fs.readFileSync(personalSave),originalPersonal);
  console.log('SESSION_STORAGE_PASS: personal plus two named games, actual independent battery writes, persistent reopen');
}catch(error){console.error(error);process.exitCode=1;}
finally{clearTimeout(timer);for(const result of children)if(result.child.exitCode===null&&result.child.signalCode===null)result.child.kill('SIGKILL');await Promise.all(children.map(result=>result.closed));fs.rmSync(root,{recursive:true,force:true});}
