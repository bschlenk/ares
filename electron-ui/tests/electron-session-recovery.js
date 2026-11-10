import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeFixture} from '../fixture.cjs';
import {CheckpointLibrary} from '../dist/services/checkpoint-library.js';
import {SessionRepository} from '../dist/sessions/repository.js';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {ToolRegistry} from '../dist/tools/registry.js';
import {registerTools} from '../dist/mcp/register-tools.js';
const temporary=fs.mkdtempSync('/tmp/ares-session-recovery-ui-'),personal=path.join(temporary,'personal'),rom=path.join(temporary,'fixture.gb');
fs.mkdirSync(personal);fs.writeFileSync(rom,makeFixture());
Object.assign(process.env,{ARES_PROFILE_DIR:personal,ARES_SERVICE_DIR:path.join(temporary,'ipc'),ARES_ROM:rom,ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1'});
const noServices=process.argv.includes('--no-services-test');
process.argv.push('--session-name','work',noServices?'--no-services':'--services');
const {serviceHost,appContext,sessions}=await import('../dist/main.js');
const deadline=setTimeout(()=>{console.error('session recovery deadline');app.exit(1)},60000);
const until=async check=>{for(let i=0;i<800;i++){try{const result=await check();if(result)return result;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('session recovery UI timeout');};
app.on('will-quit',()=>{clearTimeout(deadline);fs.rmSync(temporary,{recursive:true,force:true});});
app.whenReady().then(async()=>{
 let client;
 try{
  const window=await until(()=>BrowserWindow.getAllWindows()[0]),js=code=>window.webContents.executeJavaScript(code);
  await until(()=>(noServices || serviceHost.info) && js("window.ares.checkpoints({operation:'status'}).then(s=>s.available)"));
  if(noServices){
    assert.equal(serviceHost.info,undefined);
    for(const mode of ['fresh','inherit-personal','restore'])await assert.rejects(new SessionRepository(personal).replace('work',mode),/session_running/);
    assert.equal((await new SessionRepository(personal).archives('work')).length,0);
    console.log('SESSION_RECOVERY_NO_SERVICES_PASS: real named native window refuses reset/restore without endpoints');app.quit();return;
  }
  client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);const tools=new ToolRegistry();registerTools(tools,client);
  const tool=async(name,args={})=>{const r=await tools.call(name,args);const value=JSON.parse(r.content[0].text);if(r.isError)throw new Error(JSON.stringify(value));return value;};
  const local=await tool('managed_state_save');assert.equal(local.origin,'session');
  const localRaw=local.id.split(':')[1],ownLibrary=new CheckpointLibrary(path.join(appContext.dataRoot,'states'),async()=>{}),data=await ownLibrary.read(local.game,localRaw),directory=await ownLibrary.revealPath(local.game,localRaw);
  const image=fs.readFileSync(path.join(directory,`${localRaw}.png`));
  const personalLibrary=new CheckpointLibrary(path.join(personal,'states'),async()=>{throw new Error('personal must not be deleted')});
  const inherited=await personalLibrary.publish(local.game,{state:data.state,screenshot:image,capturedAt:new Date(local.capturedAt),compatibility:data.metadata.compatibility},false);
  assert.equal(localRaw,inherited.id,'real native capture timestamp collides across libraries');
  const {entries:listed}=await tool('managed_states');assert.equal(listed.length,2);const ref=listed.find(e=>e.origin==='personal').reference;
  await assert.rejects(tool('managed_state_delete',{reference:ref}),/read_only/);await assert.rejects(tool('managed_state_rename',{reference:ref,name:'bad'}),/read_only/);
  await tool('managed_state_load',{reference:ref});assert.equal((await sessions.request('session.status')).ok,true);
  await js("document.querySelector('#video-load-state').click()");await until(()=>js("document.querySelectorAll('.state-card').length===2"));
  assert.equal(await js("[...document.querySelectorAll('.state-card')].some(c=>c.textContent.includes('Personal')&&c.querySelector('input').disabled)"),true);
  assert.equal(await js("[...document.querySelectorAll('.state-card')].some(c=>c.textContent.includes('Session')&&!c.querySelector('input').disabled)"),true);
  const evidence=path.resolve(import.meta.dirname,'../artifacts/session-recovery');fs.mkdirSync(evidence,{recursive:true});
  fs.writeFileSync(path.join(evidence,'origins.png'),(await window.webContents.capturePage()).toPNG());
  await js("document.querySelector('#state-close').click()");window.webContents.send('app-action','settings');
  await until(()=>js("document.querySelector('#settings-dialog').open"));await js("document.querySelector('[data-tab=sessions]').click()");await until(()=>js("document.querySelector('#settings-sessions').textContent.includes('Restore previous data')"));
  fs.writeFileSync(path.join(evidence,'sessions.png'),(await window.webContents.capturePage()).toPNG());
  await assert.rejects(js("window.ares.sessionData({operation:'reset',name:'work',mode:'fresh'})"),/session_running/);
  await js("document.querySelector('#close-settings').click()");
  // A closed second session exercises UI reset + restore and local data recovery.
  const repository=new SessionRepository(personal);let old=await repository.open('closed');fs.writeFileSync(path.join(old.context.dataRoot,'marker'),'preserved');await old.lock.release();
  await js("window.ares.sessionData({operation:'reset',name:'closed',mode:'fresh'})");
  const archives=await js("window.ares.sessionData({operation:'archives',name:'closed'})");assert.equal(archives.length,1);
  await js(`window.ares.sessionData(${JSON.stringify({operation:'restore',name:'closed',archiveId:archives[0].id})})`);
  old=await repository.open('closed');assert.equal(fs.readFileSync(path.join(old.context.dataRoot,'marker'),'utf8'),'preserved');await old.lock.release();
  assert.equal((await repository.archives('closed')).length,2);assert.equal((await personalLibrary.list(local.game)).length,1);
  console.log('SESSION_RECOVERY_UI_PASS: native inherited load, CLI/MCP registry, collision, immutable personal, origins, Sessions reset/restore and running refusal');
  client.close();app.quit();
 }catch(error){console.error(error);client?.close();app.exit(1);}
});
