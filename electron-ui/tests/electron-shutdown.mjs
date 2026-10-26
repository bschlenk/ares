import {app, BrowserWindow} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync('/tmp/ares-quit-regression-');app.setPath('userData',path.join(dir,'profile'));
Object.assign(process.env,{ARES_PROFILE_DIR:path.join(dir,'profile'),ARES_SERVICE_DIR:path.join(dir,'ipc'),ARES_ENABLE_SERVICES:'1',ARES_DEFAULT_PLUGINS:'0',ARES_BACKGROUND_TEST:'1',ARES_SILENT:'1'});delete process.env.ARES_ROM;delete process.env.ARES_AUTOTEST;
// Keep fatal diagnostics visible even when the profile is removed at quit.
process.on('uncaughtExceptionMonitor', error => console.error('SHUTDOWN_UNCAUGHT', error));
process.on('unhandledRejection', error => console.error('SHUTDOWN_REJECTION', error));
// Hold the navigation promise until quit, even if the page loads quickly locally.
// This reproduces Chromium's ERR_ABORTED when startup overlaps window closure.
let abortedLoad=false,loadStarted=false;
const loadFile=BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile=function(...args){
 loadStarted=true;
 return new Promise((resolve,reject)=>{
  app.once('before-quit',()=>{abortedLoad=true;reject(Object.assign(new Error('fixture navigation aborted by shutdown'),{code:'ERR_ABORTED',errno:-3}));});
  loadFile.apply(this,args).catch(reject);
 });
};
const {serviceHost}=await import('../dist/main.js');
const until=async fn=>{for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('shutdown fixture timed out');};
const timeout=setTimeout(()=>{console.error('SHUTDOWN_TIMEOUT');app.exit(1);},10000);
let metadataFile,release,started=false,finished=false,allowed=false;
const close=serviceHost.close.bind(serviceHost);

app.on('will-quit',()=>{try{assert(allowed&&finished,'repeat quit must wait for service cleanup');assert(abortedLoad,'shutdown must overlap the pending navigation');assert.equal(fs.existsSync(metadataFile),false);console.log('SHUTDOWN_REENTRANCY_PASS');}catch(error){console.error(error);app.exit(1);}clearTimeout(timeout);fs.rmSync(dir,{recursive:true,force:true});});
app.whenReady().then(async()=>{try{
 await until(()=>loadStarted&&serviceHost.metadataFile&&fs.existsSync(serviceHost.metadataFile));const metadata=metadataFile=serviceHost.metadataFile;
 serviceHost.close=async()=>{started=true;await new Promise(r=>release=r);await close();finished=true;};
 app.quit();await until(()=>started);app.quit();process.emit('SIGTERM');
 await new Promise(r=>setTimeout(r,100));assert.equal(finished,false);assert(fs.existsSync(metadata));allowed=true;release();
}catch(error){console.error(error);app.exit(1);}});
