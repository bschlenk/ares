import {app,BrowserWindow,nativeImage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {makeFixture} from '../fixture.cjs';
import {localRequestContext,LocalServiceClient} from '../dist/services/local-endpoint.js';
const root=fs.mkdtempSync('/tmp/ares-presentation-'),rom=path.join(root,'fixture.gb');fs.writeFileSync(rom,makeFixture());
const named=!process.argv.includes('--personal-test');
Object.assign(process.env,{ARES_PROFILE_DIR:path.join(root,'personal'),ARES_SERVICE_DIR:path.join(root,'ipc'),ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1'});
process.argv.push('--services',...(named?['--session-name','capture-work']:[]));
const {serviceHost,sessions,externalAccess}=await import('../dist/main.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let n=0;n<600;n++){try{if(await check())return;}catch{}await sleep(25);}throw Error('presentation timeout');}
const deadline=setTimeout(()=>app.exit(1),90000);
app.on('will-quit',()=>{clearTimeout(deadline);fs.rmSync(root,{recursive:true,force:true});});
app.whenReady().then(async()=>{
 let client;
 try{
  await until(()=>serviceHost.info&&sessions.identity&&BrowserWindow.getAllWindows()[0]);
  const win=BrowserWindow.getAllWindows()[0],js=code=>win.webContents.executeJavaScript(code);win.show();
  await until(()=>js('!!window.beginVideoCaptureReady && !!document.querySelector("#named-session-banner")'));
  const expected=game=>[named?'capture-work':undefined,game,'ares'].filter(Boolean).join(' — ');
  async function title(game){await until(async()=>win.getTitle()===expected(game)&&await js(`document.querySelector('#window-game-title').textContent===${JSON.stringify(expected(game))}`));}
  await title();assert.equal(app.getName(),expected());
  client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);
  if(!named){await client.manage({operation:'access_request'});await js('window.ares.externalAccess("allow")');}
  await client.manage({operation:'load_rom',path:rom,system:'Game Boy'});await title('fixture');await sessions.request('session.resume');await sleep(250);await sessions.request('session.pause');
  const banner=named?'named-session-banner':'external-access-banner';
  await until(()=>js(`!document.getElementById('${banner}').hidden`));
  assert.equal(await js(`document.querySelector('#named-session-banner button')===null`),true);
  assert.equal(await js(`document.querySelector('#${banner}').textContent.includes(${JSON.stringify(named?'capture-work':'real personal settings and saves')})`),true);
  // Idle auto-hide and keyboard focus use the same existing visibility container.
  win.focus();app.focus({steal:true});win.webContents.focus();
  await until(()=>js('document.hasFocus()'));
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await js(`document.querySelector('#viewport').dataset.toolbarIdle='true';document.querySelector('#video-pause').focus()`);
  await until(()=>js(`getComputedStyle(document.querySelector('#video-controls')).opacity==='1'`));
  await js(`document.querySelector('#screen').focus();document.querySelector('#viewport').dataset.toolbarIdle='true'`);await until(()=>js(`getComputedStyle(document.querySelector('#video-controls')).opacity==='0'`));
  if(!named){await js(`document.querySelector('#external-access-banner button').focus()`);await until(()=>js(`getComputedStyle(document.querySelector('#video-controls')).opacity==='1'`));}
  async function reload(){const loaded=once(win.webContents,'did-finish-load');win.webContents.reload();await loaded;await until(()=>js(`!!window.beginVideoCaptureReady && !document.querySelector('#${banner}').hidden`));}
  await reload();await title('fixture');
  // Distinct pixels in app chrome and legitimate plugin/game overlay. A supported
  // panel rectangle deliberately crosses both, rather than relying on placement.
  await js(`(()=>{const b=document.getElementById('${banner}');document.body.append(b);Object.assign(b.style,{position:'fixed',left:'50px',top:'80px',width:'80px',height:'80px',background:'#ff00ff',zIndex:'20000'});const overlay=document.createElement('div');overlay.id='pixel-overlay';overlay.dataset.pluginPanel='test:rectangle';Object.assign(overlay.style,{position:'fixed',left:'40px',top:'70px',width:'200px',height:'200px',background:'#00ff00',zIndex:'19000'});document.body.append(overlay);document.querySelector('#video-controls').style.opacity='1';})()`);
  await sleep(200);
  const raw=await win.webContents.capturePage({x:40,y:70,width:200,height:200});
  const count=(image,r,g,b)=>{const bytes=image.toBitmap();let found=0;for(let n=0;n<bytes.length;n+=4)if(Math.abs(bytes[n]-b)<8&&Math.abs(bytes[n+1]-g)<8&&Math.abs(bytes[n+2]-r)<8)found++;return found;};
  assert(count(raw,255,0,255)>100,'sentinel must be visible before ares capture');
  const shot=path.join(root,'presented.png');await client.manage({operation:'screenshot',path:shot,panel:'test:rectangle'});
  const captured=nativeImage.createFromPath(shot);assert.equal(count(captured,255,0,255),0);assert(count(captured,0,255,0)>1000,'plugin overlay preserved: '+JSON.stringify({size:captured.getSize(),colors:[...captured.toBitmap().subarray(0,16)],green:count(captured,0,255,0)}));
  const full=path.join(root,'full.png');await client.manage({operation:'screenshot',path:full});assert.equal(count(nativeImage.createFromPath(full),255,0,255),0);
  assert.equal(await js(`document.documentElement.hasAttribute('data-game-capture')`),false);
  // Native presented crops and managed preview pixels never consume DOM chrome.
  const nativePath=path.join(root,'native.png');
  const native=await client.request('artifact.screenshot',sessions.identity,{path:nativePath,source:'presented',region:[0,0,8,8],scale:1,inline:false,overwrite:false});
  assert(native.ok,JSON.stringify(native));assert.equal(count(nativeImage.createFromPath(nativePath),255,0,255),0);
  const recording=await client.request('video.record.start',sessions.identity,{source:'presented',maxFrames:2,maxBytes:1048576,fps:60,timeoutMs:5000,discard:false});assert(recording.ok);
  await sessions.request('session.resume');await until(async()=>(await client.request('video.record.status',sessions.identity)).result?.frames===2);await sessions.request('session.pause');
  const moviePath=path.join(root,'native.avi'),movie=await client.request('artifact.videoStop',sessions.identity,{path:moviePath,overwrite:false});assert(movie.ok,JSON.stringify(movie));
  const avi=fs.readFileSync(moviePath),chunk=avi.indexOf(Buffer.from('00db'));assert(chunk>0);const pixels=avi.subarray(chunk+8,chunk+8+avi.readUInt32LE(chunk+4));assert(pixels.length>1000);
  let magenta=0;for(let n=0;n<pixels.length;n+=3)if(pixels[n]>247&&pixels[n+1]<8&&pixels[n+2]>247)magenta++;assert.equal(magenta,0,'native AVI excludes banner pixels');
  const saved=await js(`window.ares.checkpoints({operation:'save',session:${JSON.stringify(sessions.identity.session)}})`);assert(saved);
  const entries=await js(`window.ares.checkpoints({operation:'list',session:${JSON.stringify(sessions.identity.session)}})`);
  assert(entries.length>0);assert.equal(count(nativeImage.createFromDataURL(entries[0].screenshotUrl),255,0,255),0);
  const a=await js('window.beginVideoCapture()'),b=await js('window.beginVideoCapture()');
  await sleep(2100);await js(`window.endVideoCapture(${JSON.stringify(a)})`);assert.equal(await js(`document.documentElement.hasAttribute('data-game-capture')`),true);
  await js(`window.endVideoCapture(${JSON.stringify(b)})`);assert.equal(await js(`document.documentElement.hasAttribute('data-game-capture')`),false);
  // Capture failures restore chrome through the real main finally path.
  const capture=win.webContents.capturePage.bind(win.webContents);
  win.webContents.capturePage=async()=>{throw Error('injected_capture_failure');};
  await assert.rejects(client.manage({operation:'screenshot',path:path.join(root,'failed.png')}),/injected_capture_failure/);
  assert.equal(await js(`document.documentElement.hasAttribute('data-game-capture')`),false);
  // Client cancellation cannot publish an in-flight capture and still releases
  // the lease, even if capturePage itself completes after cancellation.
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  win.webContents.capturePage=async rect=>{entered();await new Promise(resolve=>release=resolve);return capture(rect);};
  const abort=new AbortController(),cancelPath=path.join(root,'cancelled.png');
  const cancelled=localRequestContext.run({signal:abort.signal},()=>client.manage({operation:'screenshot',path:cancelPath}));
  const rejected=assert.rejects(cancelled,/cancelled/);await started;abort.abort();await rejected;await sleep(50);release();
  await until(()=>js(`!document.documentElement.hasAttribute('data-game-capture')`));assert.equal(fs.existsSync(cancelPath),false);
  // Reload while capturePage is in flight must discard that image, restore the
  // new document, and reconstruct identity/access from main state.
  win.webContents.capturePage=async rect=>{const image=await capture(rect);await reload();return image;};
  await assert.rejects(client.manage({operation:'screenshot',path:path.join(root,'stale.png')}),/capture_renderer_changed/);
  assert.equal(fs.existsSync(path.join(root,'stale.png')),false);win.webContents.capturePage=capture;
  await title('fixture');assert.equal(await js(`document.documentElement.hasAttribute('data-game-capture')`),false);
  const health=await client.manage({operation:'app_health'});process.kill(health.native.pid,'SIGKILL');await title();
  await reload();await title();
  await client.manage({operation:'load_rom',path:rom,system:'Game Boy'});await title('fixture');
  await client.manage({operation:'close_rom'});await title();
  if(!named){await js(`document.querySelector('#external-access-banner button').click()`);await until(()=>externalAccess.snapshot().state==='unapproved');assert.equal((await sessions.request('session.status')).result.paused,true);}
  client.close();console.log(named?'SESSION_PRESENTATION_NAMED_PASS':'SESSION_PRESENTATION_PERSONAL_PASS');app.quit();
 }catch(error){console.error(error);client?.close();app.exit(1);}
});
