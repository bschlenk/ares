// Invoked by paired-recovery-electron.test.js; every process owns a disposable profile.
import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.env.ARES_PAIRED_TEST_ROOT,phase=process.env.ARES_PAIRED_TEST_PHASE;
assert(root?.startsWith('/tmp/ares-paired-ui-'));
const profile=path.join(root,'profile');app.setPath('userData',profile);
Object.assign(process.env,{ARES_PROFILE_DIR:profile,ARES_SAVE_DIR:path.join(profile,'saves'),ARES_ROM:path.join(root,'fixture.gb'),ARES_SYSTEM:'Game Boy',ARES_AUTOTEST:'',ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_SERVICE_DIR:path.join(root,'ipc')});
process.argv.push('--no-services');
const {sessions,plugins,stopNative}=await import('../dist/main.js');
const until=async fn=>{for(let i=0;i<600;i++){try{const r=await fn();if(r)return r;}catch{}await new Promise(r=>setTimeout(r,20));}throw new Error('paired UI timeout '+phase);};
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.result;};
const deadline=setTimeout(()=>{console.error('paired UI deadline '+phase);app.exit(1);},30000);
app.whenReady().then(async()=>{
  const window=await until(()=>BrowserWindow.getAllWindows()[0]),js=code=>window.webContents.executeJavaScript(code);
  if(phase==='blocked'){
    await until(async()=>{const r=await sessions.request('session.status');return r.ok&&r.result.system==='Game Boy';});
    await new Promise(r=>setTimeout(r,200));
    assert.equal((await sessions.request('session.status')).result.paused,true,'invalid recovery keeps the new game paused');
    assert(plugins.catalog().plugins.every(p=>!p.lease),'failed recovery never publishes a player plugin scope');
    clearTimeout(deadline);console.log('RECOVERY_BLOCKED_PASS');app.exit(0);return;
  }
  await until(()=>js("!!window.recoveryCtx && !window.recoveryCtx.signal.aborted && !!document.querySelector('[data-plugin-command=\"test.paired:ready\"]')"));
  await js("window.ares.preferences.set('emulation.pauseOnFocusLoss',false)");
  const request=async(method,params)=>unwrap(await sessions.request(method,undefined,params));
  const ram=(await request('memory.regions')).regions.find(r=>r.name==='CPU WRAM');
  const write=hex=>request('memory.write',{region:ram.id,offset:128,hex});
  const read=async()=>(await request('memory.read',{region:ram.id,offset:128,length:1})).hex;
  const append=(id)=>js(`window.recoveryCtx.journal.append('events',{id:${JSON.stringify(id)},schemaVersion:1,value:${JSON.stringify(id)}})`);
  if(phase==='prepare'){
    await request('session.pause');await write('42');await append('saved');await request('session.resume');
    const point=await js('window.recoveryCtx.recovery.capture()');assert.equal(point.point.journalSequence,1);assert.equal((await request('session.status')).paused,false);
    await request('session.pause');await write('99');await append('abandoned');
    assert.equal((await js('window.recoveryCtx.recovery.start({intervalMs:1000})')).monitoring,true);
    await js('window.oldRecoveryCtx=window.recoveryCtx;true');await plugins.reload('test.paired');
    await until(()=>js('window.recoveryCtx!==window.oldRecoveryCtx&&!window.recoveryCtx.signal.aborted'));
    assert.equal((await js('window.recoveryCtx.recovery.status()')).monitoring,false,'reload releases timer');
    await assert.rejects(js('window.oldRecoveryCtx.recovery.capture()'),/stale_plugin_scope/);
    console.log('RECOVERY_CRASH_READY'); // Parent kills this Electron process; no normal stop/disarm.
  }else if(phase==='recover'){
    assert.equal(sessions.identity.epoch,2,'startup restored before publishing the plugin session');assert.equal(await read(),'42');
    const page=await js("window.recoveryCtx.journal.read('events')");assert.deepEqual(page.records.map(r=>r.id),['saved']);assert.equal(page.nextSequence,3);assert.equal(page.recovery.journalSequence,1);
    assert.equal((await js('window.recoveryCtx.recovery.status()')).restored.targetSession,sessions.identity.session);
    assert.equal((await request('session.status')).paused,false,'running source continues after recovery');
    assert.equal((await append('continued')).sequence,3);await write('45');await js('window.recoveryCtx.recovery.capture()');
    assert.equal(await js("'restore' in window.recoveryCtx.recovery"),false,'plugin cannot request rewind');
    await stopNative();clearTimeout(deadline);console.log('RECOVERY_RESTART_PASS');app.quit();
  }else if(phase==='clean'){
    assert.equal(sessions.identity.epoch,1,'normal close disarmed paired recovery');assert.notEqual(await read(),'45');
    const page=await js("window.recoveryCtx.journal.read('events')");assert.deepEqual(page.records.map(r=>r.id),['saved','continued']);
    await stopNative();clearTimeout(deadline);console.log('RECOVERY_CLEAN_PASS');app.quit();
  }else throw new Error('unknown phase');
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});
