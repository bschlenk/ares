import {app} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync('/tmp/ares-quit-regression-');app.setPath('userData',path.join(dir,'profile'));
Object.assign(process.env,{ARES_PROFILE_DIR:path.join(dir,'profile'),ARES_SERVICE_DIR:path.join(dir,'ipc'),ARES_ENABLE_SERVICES:'1',ARES_DEFAULT_PLUGINS:'0',ARES_BACKGROUND_TEST:'1',ARES_SILENT:'1'});delete process.env.ARES_ROM;delete process.env.ARES_AUTOTEST;
const {serviceHost}=await import('../dist/main.js');
const until=async fn=>{for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('shutdown fixture timed out');};
const timeout=setTimeout(()=>{console.error('SHUTDOWN_TIMEOUT');app.exit(1);},10000);
let metadataFile,release,started=false,finished=false,allowed=false;
const close=serviceHost.close.bind(serviceHost);

app.on('will-quit',()=>{try{assert(allowed&&finished,'repeat quit must wait for service cleanup');assert.equal(fs.existsSync(metadataFile),false);console.log('SHUTDOWN_REENTRANCY_PASS');}catch(error){console.error(error);app.exit(1);}clearTimeout(timeout);fs.rmSync(dir,{recursive:true,force:true});});
app.whenReady().then(async()=>{try{
 await until(()=>serviceHost.metadataFile&&fs.existsSync(serviceHost.metadataFile));const metadata=metadataFile=serviceHost.metadataFile;
 serviceHost.close=async()=>{started=true;await new Promise(r=>release=r);await close();finished=true;};
 app.quit();await until(()=>started);app.quit();process.emit('SIGTERM');
 await new Promise(r=>setTimeout(r,100));assert.equal(finished,false);assert(fs.existsSync(metadata));allowed=true;release();
}catch(error){console.error(error);app.exit(1);}});
