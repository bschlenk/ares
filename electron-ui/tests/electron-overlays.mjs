import {app,BrowserWindow,Menu} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync('/tmp/ares-overlays-ui-'),profile=path.join(dir,'profile'),source=path.join(dir,'plugin');fs.mkdirSync(profile);fs.mkdirSync(source);
fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({id:'test.overlay',name:'Overlay acceptance',version:'1.0.0',apiVersion:1,entry:'plugin.js',mode:'overlay',capabilities:['memory.read'],contributes:{}}));
fs.writeFileSync(path.join(source,'plugin.js'),`export function activate(ctx){
 window.overlayChecks={fast:0,slow:0,skipped:0,resizes:0,cleanups:0};
 ctx.ui.registerOverlay('static',overlay=>{
  const canvas=document.createElement('canvas');canvas.style.width='100%';canvas.style.height='100%';overlay.element.append(canvas);window.overlayChecks.element=overlay.element;
  const resize=overlay.onResize(size=>{window.overlayChecks.size={...size};window.overlayChecks.resizes++;canvas.width=size.pixelWidth;canvas.height=size.pixelHeight;const c=canvas.getContext('2d');c.setTransform(size.pixelWidth/(size.logicalWidth||1),0,0,size.pixelHeight/(size.logicalHeight||1),0,0);c.fillStyle='#ff0000';c.fillRect(0,0,10,10);});
  return ()=>{resize();window.overlayChecks.cleanups++;};
 });
 ctx.ui.registerOverlay('sample',overlay=>{
  const stop=ctx.scope.onFrame({source:'export default({emu})=>({vi:emu.frame})',args:{},timeoutMs:30000,maxFrames:0},sample=>{window.overlayChecks.fast++;if(!Object.isFrozen(sample.value))throw Error('mutable sample');overlay.present(sample,()=>{overlay.element.textContent='VI '+sample.value.vi;window.overlayChecks.matched=overlay.frame.vi===sample.frame.vi;});});return stop;
 },{order:1});
 ${process.env.ARES_PLUGIN_TEST_ROM?"ctx.scope.onFrame({source:'export default({emu})=>({ref:emu.info().frame_reference})',boundary:'vi_origin'},sample=>{window.overlayChecks.origin=sample;});":''}
 window.overlayChecks.stopSlow=ctx.scope.onFrame({source:'export default({emu})=>({vi:emu.frame})',args:{},timeoutMs:30000,maxFrames:0},async sample=>{window.overlayChecks.slow++;window.overlayChecks.skipped+=sample.skipped;await new Promise(r=>setTimeout(r,80));});
}`);
app.setPath('userData',profile);Object.assign(process.env,{ARES_PROFILE_DIR:profile,ARES_PLUGIN_DIRS:source,ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0',ARES_ENABLE_SERVICES:'1',ARES_SERVICE_DIR:path.join(dir,'ipc')});delete process.env.ARES_ROM;if(process.env.ARES_PLUGIN_TEST_ROM){const rom=path.join(dir,'game.z64');fs.copyFileSync(process.env.ARES_PLUGIN_TEST_ROM,rom);process.env.ARES_ROM=rom;process.env.ARES_SYSTEM='Nintendo 64';}delete process.env.ARES_AUTOTEST;delete process.env.ARES_DISABLE_PLUGINS;
const {plugins,sessions,serviceHost}=await import('../dist/main.js');
const until=async check=>{for(let n=0;n<300;n++){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('overlay check timed out');};
const timer=setTimeout(()=>{console.error('OVERLAY_TIMEOUT');app.exit(1);},30000);app.on('will-quit',()=>{clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true});});
app.whenReady().then(async()=>{try{
 const win=await until(()=>BrowserWindow.getAllWindows()[0]),js=code=>win.webContents.executeJavaScript(code);
 if(process.env.ARES_PLUGIN_TEST_STATE){await until(()=>sessions.identity);const state=path.join(dir,'game.bs');fs.copyFileSync(process.env.ARES_PLUGIN_TEST_STATE,state);const loaded=await sessions.request('state.load',sessions.identity,{path:state,resume:true,keepOverrides:false});assert(loaded.ok,JSON.stringify(loaded));}
 await until(()=>js('window.overlayChecks?.fast>8&&window.overlayChecks?.slow>2'));
 if(process.env.ARES_PLUGIN_TEST_ROM){await until(()=>js('!!window.overlayChecks.origin'));const origin=await js('window.overlayChecks.origin');assert.equal(origin.frame.boundary,'vi_origin');assert.equal(origin.value.ref.origin_commit,origin.frame.origin_commit);}
 assert.equal(await js('document.querySelectorAll(".ares-screen-overlay").length'),2);
 const aligned=()=>js(`(()=>{const a=window.overlayChecks.element.getBoundingClientRect(),b=document.querySelector('#screen').getBoundingClientRect(),s=window.overlayChecks.size;return Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1&&s.pixelWidth===Math.round(s.width*devicePixelRatio)&&s.pixelHeight===Math.round(s.height*devicePixelRatio)})()`);
 assert(await aligned());if(process.env.ARES_PLUGIN_TEST_STATE){const logical=await js('window.overlayChecks.size');assert.equal(logical.logicalWidth,320);assert.equal(logical.logicalHeight,240);assert.equal(logical.sourceWidth,640);assert.equal(logical.sourceHeight,240);assert(logical.geometry);assert.equal(logical.geometry.rotation,0);assert.equal(logical.geometry.cropX,0);assert.equal(logical.geometry.cropY,0);assert.equal(logical.canvasToCss.length,6);assert.equal(logical.canvasToPixels.length,6);assert(Math.abs(logical.canvasToPixels[0]-logical.width*logical.dpr/logical.sourceWidth)<0.01);}
 win.setSize(980,650);await until(aligned);win.webContents.setZoomFactor(1.25);await until(aligned);
 await until(()=>js('window.overlayChecks.skipped>0&&window.overlayChecks.matched'));
 const initial=await js('({fast:window.overlayChecks.fast,slow:window.overlayChecks.slow})');await js('window.overlayChecks.stopSlow()');await new Promise(r=>setTimeout(r,150));assert((await js('window.overlayChecks.fast'))>initial.fast);
 const settings=Menu.getApplicationMenu().items.flatMap(i=>i.submenu?.items??[]).find(i=>i.label==='Settings…');settings.click();await until(()=>js('document.querySelector("#settings-dialog").open'));assert.equal(await js('document.querySelectorAll(".ares-screen-overlay").length'),2);await js('document.querySelector("#settings-dialog").close()');
 // Move the single host viewport into a floating workspace window.
 await js(`document.querySelector('#floating-panel').value='video';document.querySelector('#add-floating').click()`);await until(()=>js('!!document.querySelector("[data-floating] #viewport")'));await until(aligned);
 win.webContents.setZoomFactor(1);
 await sessions.request('session.pause');await new Promise(r=>setTimeout(r,100));
 await js(`const floating=document.querySelector('[data-floating]');floating.style.width='700px';floating.style.height='400px'`);await new Promise(r=>setTimeout(r,100));
 // Explicit 320x240 logical picture in a 640x240 display rectangle.
 await js(`(async()=>{const api=await import('./dist/browser/plugins/overlays.js');const c=document.querySelector('#screen');c.style.width='640px';c.style.height='240px';api.layoutOverlays(320,240);})()`);
 await until(()=>js('window.overlayChecks.size.logicalWidth===320&&window.overlayChecks.size.logicalHeight===240'));assert(await aligned());
 const screenshot=path.resolve('artifacts/overlay-composition.png');fs.mkdirSync(path.dirname(screenshot),{recursive:true});fs.rmSync(screenshot,{force:true});
 const {LocalServiceClient}=await import('../dist/services/local-endpoint.js');const client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);const shot=await client.manage({operation:'screenshot',path:screenshot});client.close();assert(shot.frame_reference);assert.equal(shot.frame_reference.presentation.stage,'renderer_submit');assert(shot.overlay_geometry);assert.equal(shot.overlay_geometry.coordinate_space,'overlay_css');assert.equal(shot.overlay_geometry.rect.width,640);if(process.env.ARES_PLUGIN_TEST_ROM)assert(shot.overlay_geometry.geometry);
 const bounds=await js('(()=>{const r=window.overlayChecks.element.getBoundingClientRect();return {x:r.x,y:r.y}})()');const image=await win.webContents.capturePage({x:Math.ceil(bounds.x+2),y:Math.ceil(bounds.y+2),width:1,height:1});const pixel=image.toBitmap();assert(pixel[2]>240&&pixel[1]<20&&pixel[0]<20,JSON.stringify([...pixel]));
 await plugins.enable('test.overlay',false);await until(()=>js('document.querySelectorAll(".ares-screen-overlay").length===0'));assert.equal(await js('window.overlayChecks.cleanups'),1);
 console.log('OVERLAY_UI_PASS');app.quit();
}catch(error){console.error(error);app.exit(1);}});
