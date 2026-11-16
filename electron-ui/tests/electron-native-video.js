import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {makeFixture,makeNesFixture} from '../fixture.cjs';
const sessionErrors=[];const originalStderr=process.stderr.write.bind(process.stderr);process.stderr.write=(chunk,...args)=>{const text=String(chunk);if(text.includes("Error occurred in handler for 'session'"))sessionErrors.push(text);return originalStderr(chunk,...args);};
const run=promisify(execFile),temporary=fs.mkdtempSync('/tmp/ares-native-video-'),profile=path.join(temporary,'profile'),source=path.join(temporary,'plugin');
fs.mkdirSync(source);
const denied=path.join(temporary,'denied');fs.mkdirSync(denied);
fs.writeFileSync(path.join(denied,'manifest.json'),JSON.stringify({id:'test.denied',name:'No video grant',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities:[],contributes:{panels:[{id:'proof',title:'No video grant'}]}}));
fs.writeFileSync(path.join(denied,'plugin.js'),`export function activate(ctx){ctx.ui.registerPanel('proof',({element})=>{try{ctx.video.mount(element)}catch(e){window.deniedVideo=e.message}});}`);

const gb=path.join(temporary,'original.gb'),nes=path.join(temporary,'original.nes');fs.writeFileSync(gb,makeFixture());fs.writeFileSync(nes,makeNesFixture());
fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({id:'test.video',name:'Video fixture',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities:['video.read'],contributes:{panels:[{id:'dashboard',title:'Native dashboard'}]}}));
fs.writeFileSync(path.join(source,'plugin.js'),`export function activate(ctx){window.videoCtx=ctx;window.testSurfaces=[];ctx.ui.registerPanel('dashboard',({element,signal})=>{
 element.style.cssText='display:flex;gap:8px;flex-direction:column;height:100%';
 for(let n=0;n<2;n++){const e=document.createElement('div');e.style.cssText='flex:1;min-height:0';element.append(e);const mount=()=>{if(!signal.aborted)window.testSurfaces.push(ctx.video.mount(e,{filtering:'nearest'}));};if(n===0)mount();else queueMicrotask(mount);}
});}`);
app.setPath('userData',profile);
Object.assign(process.env,{ARES_PROFILE_DIR:profile,ARES_SAVE_DIR:path.join(profile,'saves'),ARES_PLUGIN_DIRS:[source,denied].join(path.delimiter),ARES_DEFAULT_PLUGINS:'0',ARES_ENABLE_SERVICES:'1',ARES_SERVICE_DIR:path.join(temporary,'ipc'),ARES_ROM:gb,ARES_SYSTEM:'Game Boy',ARES_SILENT:'1',ARES_AUTOTEST:'',ARES_BACKGROUND_TEST:'1'});
delete process.env.ARES_DISABLE_PLUGINS;delete process.env.ARES_SETTINGS;delete process.env.ARES_SAVE_DIR;
process.argv.push('--session-name','video-fixture');
const {sessions,plugins,serviceHost}=await import('../dist/main.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<400;i++){try{const value=await check();if(value)return value}catch{}await sleep(25)}throw Error('Timed out: '+label)}
const deadline=setTimeout(()=>{console.error('native video deadline');app.exit(1)},90000);
app.on('will-quit',()=>{clearTimeout(deadline);fs.rmSync(temporary,{recursive:true,force:true})});
app.whenReady().then(async()=>{try{
 const window=await until(()=>BrowserWindow.getAllWindows()[0],'window');window.setContentSize(1600,900);
 const js=code=>window.webContents.executeJavaScript(code);
 const cli=async(...args)=>JSON.parse((await run(process.execPath,[path.resolve(import.meta.dirname,'../dist/plugins/cli.js'),...args,'--connection',serviceHost.metadataFile,'--instance',serviceHost.instance],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:''},timeout:15000})).stdout);
 const live=()=>js('window.testSurfaces?.length===2&&window.testSurfaces.every(s=>s.status.state==="live")');
 await until(()=>plugins.catalog().plugins.find(p=>p.manifest?.id==='test.video'&&p.phase==='active'),'active');
 await until(()=>plugins.catalog().plugins.find(p=>p.manifest?.id==='test.denied'&&p.phase==='active'),'no-grant plugin');
 await cli('open','test.denied','proof');await until(()=>js('window.deniedVideo'),'permission refusal');assert.equal(await js('window.deniedVideo'),'capability_required: video.read');await plugins.enable('test.denied',false);
 await cli('open','test.video','dashboard');await until(live,'two native views');
 await until(async()=>{const s=await js('window.testSurfaces[0].status');return s.sourceWidth===160&&s.frame.frame>200},'GB pixels after boot');
 assert.equal(sessionErrors.length,0,'background startup must not reject session IPC');
 const before=await sessions.request('session.status');const count=await js('window.testSurfaces[0].status.submitted');
 await sleep(1200);const after=await sessions.request('session.status'),rendered=await js('window.testSurfaces[0].status.submitted');
 assert.equal(after.epoch,before.epoch);assert.equal(after.result.paused,false);assert(after.result.frame-before.result.frame>40);assert(rendered-count>35,`full-rate video (${rendered-count} submissions/1.2s)`);
 // Capture holds presentation only. Frame metadata must describe both actual canvases.
 const shot=await cli('screenshot','--panel','test.video:dashboard','--output',path.join(temporary,'dashboard.png'));
 assert.equal(shot.video_surfaces.length,2);assert(shot.video_surfaces.every(s=>s.frame&&s.frame_match==='renderer_submit'));
 assert(fs.statSync(shot.path).size>1000);
 if(process.env.ARES_VIDEO_ARTIFACT_DIR){fs.mkdirSync(process.env.ARES_VIDEO_ARTIFACT_DIR,{recursive:true});fs.copyFileSync(shot.path,path.join(process.env.ARES_VIDEO_ARTIFACT_DIR,'native-video-dashboard.png'));}

 await sessions.request('session.pause');await sleep(150);
 await until(()=>js('window.testSurfaces.every(s=>s.status.frame?.video_sequence===window.overlayFrame()?.video_sequence)'), 'paused frame match');
 const pixels=await js(`(()=>{const canvases=[document.querySelector('#screen'),...document.querySelectorAll('[data-video-surface] canvas')];return canvases.map(c=>{const gl=c.getContext('webgl2'),b=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b]})})()`);
 assert.deepEqual(pixels[1],pixels[0]);assert.deepEqual(pixels[2],pixels[0]);
 const paused=await js('window.testSurfaces[0].status');await sleep(100);assert.equal((await js('window.testSurfaces[0].status')).frame.frame,paused.frame.frame);
 assert.equal(paused.state,'live');
 assert.equal(await js(`(()=>{const s=window.testSurfaces[0];let painted=0;const off=s.overlay.onResize(size=>window.videoOverlaySize=size);s.overlay.present({frame:s.status.frame},()=>{painted++;s.overlay.element.textContent='Matched frame'});const matched=!s.overlay.element.hidden;s.overlay.present({frame:{...s.status.frame,epoch:s.status.frame.epoch+1}},()=>painted++);const stale=s.overlay.element.hidden;off();s.overlay.setVisible(false);return matched&&stale&&painted===1&&window.videoOverlaySize.canvasToPixels?.length===6})()`),true,'embedded overlay matches only this view frame');
 await sessions.request('session.resume');
 await js('window.testSurfaces[0].setVisible(false)');await until(()=>js('window.testSurfaces[0].status.state==="suspended"'),'hidden view');
 const hiddenCount=await js('window.testSurfaces[0].status.submitted');await sleep(150);assert.equal(await js('window.testSurfaces[0].status.submitted'),hiddenCount);assert.equal(await js('window.testSurfaces[0].status.frame'),null);
 assert.equal(await js('window.testSurfaces[1].status.state'),'live');await js('window.testSurfaces[0].setVisible(true)');await until(live,'visible again');
 // Real panel hiding also suspends all surfaces without destroying the mounts.
 await js('window.videoCtx.ui.closePanel("dashboard")');await until(()=>js('window.testSurfaces.every(s=>s.status.state==="suspended")'),'panel hidden');
 await cli('open','test.video','dashboard');await until(live,'panel reopened');
 window.setContentSize(1000,700);await sleep(100);assert.equal((await js('window.videoSnapshot()')).length,2);
 window.webContents.setZoomFactor(1.25);await until(()=>js('window.videoSnapshot().every(s=>s.overlayGeometry.dpr===devicePixelRatio)'), 'DPR resize');window.webContents.setZoomFactor(1);

 const limit=await js(`(()=>{const panel=document.querySelector('[data-plugin-panel="test.video:dashboard"]');const extra=[];try{extra.push(window.videoCtx.video.mount(panel),window.videoCtx.video.mount(panel));try{window.videoCtx.video.mount(panel)}catch(e){return e.message}}finally{extra.forEach(v=>v.dispose())}})()`);assert.equal(limit,'video_surface_limit');
 const error=await js(`(()=>{try{window.videoCtx.video.mount(document.body)}catch(e){return e.message}})()`);assert.equal(error,'video_requires_panel_mount');
 const identity=await sessions.request('session.status');
 window.webContents.forcefullyCrashRenderer();await until(async()=>(await cli('renderer-status')).state==='crashed','renderer crash');
 const crashed=await cli('list');assert.equal(crashed.plugins.find(p=>p.manifest?.id==='test.video').unavailableReason,'renderer_crashed');
 assert.equal((await cli('recover-renderer')).native_preserved,true);
 await until(()=>plugins.catalog().plugins.find(p=>p.manifest?.id==='test.video'&&p.phase==='active'),'plugin recovered');await cli('open','test.video','dashboard');await until(live,'surfaces recreated');
 const recovered=await sessions.request('session.status');assert.equal(recovered.session,identity.session);assert.equal(recovered.epoch,identity.epoch);
 await plugins.enable('test.video',false);await until(()=>js('window.videoSnapshot().length===0'),'unload cleanup');assert.equal(await js('window.testSurfaces[0].status.state'),'disposed');
 await plugins.enable('test.video',true);await until(()=>plugins.catalog().plugins.find(p=>p.manifest?.id==='test.video'&&p.phase==='active'),'enabled');await cli('open','test.video','dashboard');await until(live,'new views');
 // Resolution and core changes reuse the native transport, with new session-bound scopes.
 const client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);
 try{await client.manage({operation:'load_rom',path:nes,system:'Famicom'});}finally{client.close();}
 await sessions.request('session.resume');await until(async()=>{const rows=await js('window.videoSnapshot()');return rows.length===2&&rows.every(s=>s.state==='live'&&s.sourceWidth===256&&s.sourceHeight===240&&s.frame.native_session!==identity.session)},'NES core switch');
 const last=await sessions.request('session.status');assert.equal(last.result.paused,false);
 const oldEpoch=last.epoch;await sessions.request('session.reset');await until(async()=>{const rows=await js('window.videoSnapshot()');return rows.length===2&&rows.every(s=>s.state==='live'&&s.frame.epoch>oldEpoch)},'reset invalidates views');
 // Retiring many surfaces must release WebGL context slots, preserving the primary view.
 for(let n=0;n<8;n++){const old=await js('window.testSurfaces[0].status.id');await plugins.reload('test.video');await until(async()=>await live()&&(await js('window.testSurfaces[0].status.id'))!==old,'reloaded views');}
 assert.equal(await js('document.querySelector("#screen").getContext("webgl2").isContextLost()'),false);
 assert.equal(await js('window.videoSnapshot().length'),2);
 // Real graphics-context loss is explicit and restoration reconnects to the latest packet.
 await js(`(()=>{const c=document.querySelector('[data-video-surface] canvas');window.loss=c.getContext('webgl2').getExtension('WEBGL_lose_context');window.loss.loseContext()})()`);
 await until(()=>js('window.testSurfaces[0].status.reason==="graphics_context_lost"'),'context loss');
 await sleep(100);await js('window.loss.restoreContext()');await until(live,'context restored');
 const diagnostic=await cli('video-status');assert.equal(diagnostic.available,true);assert.equal(diagnostic.surfaces.length,2);
 const healthClient=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);let health;
 try{health=await healthClient.manage({operation:'app_health'});const logs=await healthClient.manage({operation:'app_logs',source:'plugin-import',limit:64,cursor:0});assert(logs.entries.some(e=>e.message.includes('elapsed_ms')),'import diagnostics persisted');}finally{healthClient.close();}
 process.kill(health.native.pid);
 await until(()=>js('window.testSurfaces.every(s=>(s.status.state==="disposed"||s.status.state==="unavailable")&&s.status.frame===null)'),'disconnected native feed');
 const disconnected=await cli('video-status');assert.equal(disconnected.available,false);assert.equal(disconnected.reason,'native_disconnected');

 console.log('video metrics',JSON.stringify({gbNativeFrames:after.result.frame-before.result.frame,gbViewSubmissions:rendered-count,intervalMs:1200}));

 console.log('NATIVE_VIDEO_PASS: GB/NES native pixels, two views, full rate, capture provenance, paused frame, visibility, resize, unload, ROM switch and isolated renderer recovery');app.quit();
}catch(error){console.error(error);console.error(plugins.logs('test.video',0,8));const w=BrowserWindow.getAllWindows()[0];if(w&&!w.webContents.isDestroyed())console.error(await w.webContents.executeJavaScript('({surfaces:window.videoSnapshot?.(),text:document.body.innerText.slice(-500)})').catch(()=>null));app.exit(1)}});
