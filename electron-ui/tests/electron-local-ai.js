import {app,BrowserWindow,session,protocol,utilityProcess} from 'electron';
import assert from 'node:assert/strict';
import manifest from '../package.json' with {type:'json'};
import fs from 'node:fs';
import path from 'node:path';
const temporary=fs.mkdtempSync('/tmp/ares-local-ai-');app.setPath('userData',path.join(temporary,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'ares-ai-test',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let handler,window;const timer=setTimeout(()=>{console.error('Local AI test deadline');app.exit(1);},15000);
app.whenReady().then(async()=>{
  try{
    assert.equal(process.versions.electron,manifest.devDependencies.electron);
    const isolated=session.fromPartition('local-ai-fixture');assert.equal(typeof isolated.registerLocalAIHandler,'function');
    handler=utilityProcess.fork(path.join(import.meta.dirname,'local-ai-unavailable-handler.js'),[],{serviceName:'Ares local AI test'});
    await new Promise((resolve,reject)=>{handler.once('message',value=>value.ready?resolve():reject(new Error('invalid handler readiness')));handler.once('exit',code=>reject(new Error('handler exited '+code)));});
    isolated.registerLocalAIHandler(handler);
    isolated.protocol.handle('ares-ai-test',()=>new Response('<!doctype html><title>Ares local AI test</title>'));
    window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true}});
    await window.loadURL('ares-ai-test://fixture/');
    const observed=await window.webContents.executeJavaScript(`(async()=>{
      if(typeof LanguageModel==='undefined')return {exposed:false};
      const availability=await LanguageModel.availability();let rejected=false;
      try{const model=await LanguageModel.create();model.destroy();}catch{rejected=true;}
      return {exposed:true,availability,rejected};
    })()`);
    assert.deepEqual(observed,{exposed:true,availability:'unavailable',rejected:true});
    isolated.registerLocalAIHandler(null);
    console.log('LOCAL_AI_HANDLER_PASS',JSON.stringify({electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,provider:'test-unavailable',...observed}));
  }finally{clearTimeout(timer);if(window&&!window.isDestroyed())window.destroy();handler?.kill();fs.rmSync(temporary,{recursive:true,force:true});}
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
