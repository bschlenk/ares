import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {makeFixture} from '../fixture.cjs';
const require=createRequire(import.meta.url),electron=require('electron');
test('Electron crash startup restores paired state before plugin activation; normal close never rewinds',{timeout:100000},async()=>{
  const root=await fs.mkdtemp('/tmp/ares-paired-ui-'),source=path.join(root,'plugin'),profile=path.join(root,'profile');
  try{
    await fs.mkdir(source);await fs.mkdir(path.join(profile,'plugins'),{recursive:true});await fs.writeFile(path.join(root,'fixture.gb'),makeFixture());
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({id:'test.paired',name:'Paired recovery fixture',version:'1.0.0',apiVersion:1,entry:'plugin.js',storageVersion:1,capabilities:['storage.journal','recovery.manage'],contributes:{commands:[{id:'ready',title:'Recovery ready'}]}}));
    await fs.writeFile(path.join(source,'plugin.js'),"export function activate(ctx){window.recoveryCtx=ctx;ctx.ui.registerCommand('ready',()=>{});}");
    await fs.writeFile(path.join(profile,'plugins','enabled.json'),JSON.stringify({directories:[source],enabled:['test.paired']}));
    for(const phase of ['prepare','recover','clean','blocked']){
      if(phase==='blocked'){
        const folder=path.join(profile,'paired-recovery','test.paired-v1'),file=path.join(folder,'latest.json'),index=JSON.parse(await fs.readFile(file,'utf8'));
        await fs.writeFile(file,JSON.stringify({...index,armed:true}));await fs.writeFile(path.join(folder,index.pointId,'state.bin'),'corrupt checkpoint fixture');
      }
      const env={...process.env,ARES_PAIRED_TEST_ROOT:root,ARES_PAIRED_TEST_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn(electron,['tests/electron-paired-recovery.js'],{cwd:path.resolve(import.meta.dirname,'..'),env,stdio:['ignore','pipe','pipe']});let log='',killed=false;
      const timeout=setTimeout(()=>child.kill('SIGKILL'),35000);
      child.stdout.on('data',b=>{log+=b;if(phase==='prepare'&&!killed&&log.includes('RECOVERY_CRASH_READY')){killed=true;child.kill('SIGKILL');}});child.stderr.on('data',b=>log+=b);
      const {code,signal}=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timeout);
      if(phase==='prepare'){assert(killed,log);assert.equal(signal,'SIGKILL',log);}else{assert.equal(code,0,log);assert.match(log,phase==='recover'?/RECOVERY_RESTART_PASS/:phase==='clean'?/RECOVERY_CLEAN_PASS/:/RECOVERY_BLOCKED_PASS/);}
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
