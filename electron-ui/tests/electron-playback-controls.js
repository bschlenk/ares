import {app, BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeFixture} from '../fixture.cjs';
const temporary=fs.mkdtempSync('/tmp/ares-playback-ui-'), profile=path.join(temporary,'profile'), rom=path.join(temporary,'fixture.gb');
fs.mkdirSync(profile);fs.writeFileSync(rom,makeFixture());app.setPath('userData',profile);
Object.assign(process.env,{ARES_PROFILE_DIR:profile,ARES_ROM:rom,ARES_AUTOTEST:'',ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1'});
delete process.env.ARES_DISABLE_PLUGINS;process.argv.push('--no-services');
const host = path.resolve(import.meta.dirname,'../../build_macos/workbench/bin/ares-electron-host');
if (!process.env.ARES_HOST && fs.existsSync(host)) process.env.ARES_HOST = host;
const {sessions} = await import('../dist/main.js');
const until=async check=>{for(let i=0;i<400;i++){try{const result=await check();if(result)return result;}catch{}await new Promise(r=>setTimeout(r,20));}throw new Error('Playback UI timed out');};
const deadline=setTimeout(()=>app.exit(1),30000);
app.on('will-quit',()=>{clearTimeout(deadline);fs.rmSync(temporary,{recursive:true,force:true});});
app.whenReady().then(async()=>{try{
  const window=await until(()=>BrowserWindow.getAllWindows()[0]), js=code=>window.webContents.executeJavaScript(code);
  app.focus({steal:true});window.show();window.focus();await until(()=>js("window.stats?.().system==='Game Boy' && !document.querySelector('#video-controls').hidden"));
  app.focus({steal:true});window.focus();window.webContents.focus();
  await until(()=>js('document.hasFocus()'));
  // Native activation is unreliable for background automation on macOS.
  // Simulate the host focus policy while retaining real renderer/native input.
  const isFocused=window.isFocused.bind(window);
  window.isFocused=()=>true;
  const status=async()=>{const r=await sessions.request('session.status');assert.equal(r.ok,true);return r.result;};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const key=(type,keyCode)=>window.webContents.sendInputEvent({type,keyCode});
  const held=()=>js("document.querySelector('#video-fast-forward').getAttribute('aria-pressed')==='true'");
  const frame=()=>js('window.stats().frames + window.stats().skipped');
  await js("document.querySelector('#screen').focus()");
  const start=await frame();await sleep(250);const normal=(await frame())-start;
  key('keyDown','Space');await until(held);
  const fastStart=await frame();await sleep(250);const fast=(await frame())-fastStart;
  assert.ok(fast>normal*1.5,`fast-forward accelerated native frames: normal=${normal}, fast=${fast}`);
  key('keyUp','Space');await until(async()=>!await held());
  const released=await frame();await sleep(250);const regular=(await frame())-released;
  assert.ok(regular<fast/1.5,'release restores pacing');
  await js("window.ares.preferences.set('emulation.fastForwardKey','KeyF')");
  await sleep(100);key('keyDown','Space');await sleep(50);assert.equal(await held(),false);key('keyUp','Space');
  key('keyDown','F');await until(held);await js("window.dispatchEvent(new Event('blur'))");await until(async()=>!await held());key('keyUp','F');
  const button=await js("document.querySelector('#video-fast-forward').getBoundingClientRect().toJSON()");
  const point={x:Math.round(button.x+button.width/2),y:Math.round(button.y+button.height/2)};
  window.webContents.sendInputEvent({type:'mouseMove',...point});
  await sleep(50);window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});await until(held);
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await until(async()=>!await held());
  await js("document.querySelector('#screen').focus()");
  await js("window.ares.preferences.set('emulation.pauseOnFocusLoss',true)");
  // Exercise main's native-window event wiring deterministically, without
  // depending on macOS's focus policy for an automated test application.
  window.isFocused=()=>false;window.emit('blur');
  await until(async()=>(await status()).focus_paused===true);
  const automatic=await status();assert.equal(automatic.paused,true);assert.equal(automatic.manual_paused,false);
  assert.equal(await js("document.querySelector('#video-pause').getAttribute('aria-label')"),'Pause');
  await sleep(50);const stopped=await frame();await sleep(100);assert.equal(await frame(),stopped);
  window.isFocused=()=>true;window.emit('focus');await until(async()=>!(await status()).paused);
  await sessions.request('session.pause');window.isFocused=()=>false;window.emit('blur');await sleep(50);window.isFocused=()=>true;window.emit('focus');await sleep(50);
  assert.equal((await status()).paused,true,'manual pause survives focus cycle');
  await sessions.request('session.resume');window.isFocused=()=>false;window.emit('blur');await until(async()=>(await status()).focus_paused===true);
  await sessions.request('session.resume',undefined,undefined,'mcp-test');
  window.isFocused=()=>true;window.emit('focus');window.isFocused=()=>false;window.emit('blur');await sleep(100);
  assert.equal((await status()).paused,false,'MCP resume owns playback despite blur');
  await sessions.request('session.pause',undefined,undefined,'mcp-test');window.isFocused=()=>true;window.emit('focus');await sleep(100);
  assert.equal((await status()).paused,true,'focus does not undo MCP pause');
  await sessions.request('session.resume');window.isFocused=()=>false;window.emit('blur');await until(async()=>(await status()).focus_paused===true);
  await js("window.ares.preferences.set('emulation.pauseOnFocusLoss',false)");await until(async()=>!(await status()).paused);
  window.isFocused=isFocused;
  assert.deepEqual(await js("({button:document.querySelector('#video-fast-forward').getBoundingClientRect().width,toolbar:document.querySelector('#video-controls').getBoundingClientRect().height})"),{button:32,toolbar:48});
  if(process.platform==='darwin') {
    await sessions.request('session.pause');
    await until(()=>js("!document.querySelector('#paused-indicator').hidden"));
    assert.ok(await js("document.querySelector('#paused-indicator').getBoundingClientRect().top>=44"));
    window.webContents.send('app-action','edit-workspace');
    await until(()=>js("document.querySelector('#workspace').classList.contains('editing')"));
    assert.ok(await js("document.querySelector('.area-toolbar').getBoundingClientRect().top>=28"));
    window.webContents.send('app-action','edit-workspace');

  }
  console.log('PASS fast-forward native acceleration, release, remapping, pointer hold; focus pause, manual/MCP precedence, live disable, safe badge');app.quit();
}catch(error){console.error(error);app.exit(1);}});
