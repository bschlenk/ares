import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {appContext,sessions,serviceHost,preferences,externalAccess} from '../dist/main.js';

app.whenReady().then(async()=>{
  try{
    for(let attempt=0;attempt<500&&(!serviceHost.metadataFile||!fs.existsSync(serviceHost.metadataFile)||!BrowserWindow.getAllWindows().length);attempt++)await new Promise(resolve=>setTimeout(resolve,20));
    const {LocalServiceClient}=await import('../dist/services/local-endpoint.js');
    if(appContext.kind==='personal'){externalAccess.request('storage-fixture');externalAccess.decide(true);}
    const client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);
    await preferences.set('emulation.pauseOnFocusLoss',false);
    await client.manage({operation:'load_rom',path:process.env.ARES_STORAGE_ROM,system:'Game Boy'});client.close();
    const resume=await sessions.request('session.resume');assert(resume.ok,JSON.stringify(resume));
    const wait=await sessions.request('clock.waitStart',undefined,{frames:400,timeoutMs:15000});assert(wait.ok,JSON.stringify(wait));let state=wait.result;
    while(state.state==='waiting'){await new Promise(resolve=>setTimeout(resolve,20));const next=await sessions.request('clock.waitRead',undefined,{waitId:state.wait_id});assert(next.ok,JSON.stringify(next));state=next.result;}
    assert.equal(state.reason,'frames_elapsed');
    console.log('STORAGE_READY '+JSON.stringify(appContext));
  }catch(error){console.error(error);for(const name of fs.readdirSync(appContext.runtimeRoot+'/logs')){const file=appContext.runtimeRoot+'/logs/'+name;if(fs.statSync(file).isFile())console.error(name,fs.readFileSync(file,'utf8').slice(-12000));}app.exit(1);}
});
