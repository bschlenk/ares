import {app, BrowserWindow} from 'electron';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const profile = fs.mkdtempSync('/tmp/ares-fullscreen-');
app.setPath('userData', profile);
Object.assign(process.env, {ARES_PROFILE_DIR:profile, ARES_ROM:'', ARES_AUTOTEST:'', ARES_DISABLE_PLUGINS:'1', ARES_ENABLE_SERVICES:'0'});
const deadline = setTimeout(() => app.exit(1), 30000);
app.on('will-quit', () => {clearTimeout(deadline); fs.rmSync(profile,{recursive:true,force:true});});
const until = async check => {
  for (let i=0; i<300; ++i) {
    try {if(await check()) return;} catch {}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Fullscreen state timed out');
};
await import('../dist/main.js');
app.whenReady().then(async()=>{
  try {
    let window;
    await until(()=>{window=BrowserWindow.getAllWindows()[0];return window;});
    const state=()=>window.webContents.executeJavaScript(`({fullscreen:document.body.dataset.fullscreen,padding:getComputedStyle(document.body).paddingTop,drag:getComputedStyle(document.querySelector('#window-drag-region')).display,top:getComputedStyle(document.querySelector('#floating-layer')).top})`);
    await until(async()=> (await state()).fullscreen==='false');
    if(process.platform==='darwin') {
      assert.equal((await state()).padding,'0px');
      assert.deepEqual(await window.webContents.executeJavaScript(`({top:document.querySelector('#viewport').getBoundingClientRect().top,background:getComputedStyle(document.querySelector('#window-drag-region')).backgroundColor,drag:getComputedStyle(document.querySelector('#window-drag-region')).getPropertyValue('app-region')})`), {top:0,background:'rgba(0, 0, 0, 0)',drag:'drag'});
    }
    app.focus({steal:true}); window.show(); window.focus();
    await until(()=>window.isFocused());
    window.setFullScreen(true);
    await until(async()=> (await state()).fullscreen==='true');
    assert.deepEqual(await state(),{fullscreen:'true',padding:'0px',drag:'none',top:'0px'});
    const reloaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload();
    await reloaded;
    await until(async()=> (await state()).fullscreen==='true');
    assert.equal((await state()).padding,'0px');
    window.setFullScreen(false);
    await until(async()=> (await state()).fullscreen==='false');
    if(process.platform==='darwin') {
      const restored=await state();
      assert.equal(restored.padding,'0px'); assert.equal(restored.drag,'block'); assert.equal(restored.top,'28px');
    }
    console.log('PASS windowed video extends beneath transparent drag region; fullscreen and reload preserve layout');
    app.quit();
  } catch(error) {console.error(error);app.exit(1);}
});
