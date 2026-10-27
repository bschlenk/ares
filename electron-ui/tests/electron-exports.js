import {app,BrowserWindow,dialog,clipboard} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync('/tmp/ares-export-ui-'),profile=path.join(dir,'profile'),source=path.join(dir,'plugin');fs.mkdirSync(profile);fs.mkdirSync(source);
fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({id:'test.exports',name:'Export acceptance',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities:['files.export','clipboard.write','memory.read'],contributes:{panels:[{id:'exports',title:'Exports'}]}}));
fs.writeFileSync(path.join(source,'plugin.js'),`export function activate(ctx){
 window.exportResults=window.exportResults||[];window.exportErrors=window.exportErrors||[];
 ctx.ui.registerPanel('exports',({element})=>{
  for(const action of ['copy','save','record']){const button=document.createElement('button');button.dataset.exportAction=action;button.textContent=action;button.onclick=async()=>{try{
   const result=action==='copy'?await ctx.clipboard.writeText('frame-json'):action==='save'?await ctx.exports.saveText({suggestedName:'frame.json',text:'{"frame":1}'}):await ctx.exports.recordFrames({suggestedName:'frames.jsonl',source:'export default({emu})=>({vi:emu.frame})',maxFrames:12,maxSeconds:5});window.exportResults.push({action,result});
  }catch(error){window.exportErrors.push(String(error));}};element.append(button);}
 });
}`);
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,root:{id:'root',axis:'x',ratio:0.6,children:[{id:'video',panel:'video'},{id:'exports',panel:'plugin:test.exports:exports'}]},floating:[]}));
app.setPath('userData',profile);Object.assign(process.env,{ARES_PROFILE_DIR:profile,ARES_PLUGIN_DIRS:source,ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0',ARES_ENABLE_SERVICES:'1',ARES_SERVICE_DIR:path.join(dir,'ipc')});delete process.env.ARES_ROM;delete process.env.ARES_AUTOTEST;delete process.env.ARES_DISABLE_PLUGINS;
const {sessions,serviceHost}=await import('../dist/main.js');
const until=async check=>{for(let n=0;n<300;n++){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('export check timed out');};
const timer=setTimeout(()=>{console.error('EXPORT_TIMEOUT');app.exit(1);},30000);app.on('will-quit',()=>{clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true});});
let destination=path.join(dir,'frame.json'),cancel=false,hold=false,release,choices=0,copied=[];
// Keep tests away from the user's real clipboard and native picker state.
clipboard.writeText=text=>copied.push(text);
dialog.showSaveDialog=async()=>{++choices;if(hold)return new Promise(r=>release=r);return cancel?{canceled:true}:{canceled:false,filePath:destination};};
app.whenReady().then(async()=>{try{
 const win=await until(()=>BrowserWindow.getAllWindows()[0]),js=code=>win.webContents.executeJavaScript(code);
 await until(()=>js('!!document.querySelector("[data-export-action=copy]")'));
 await js('document.querySelector("[data-export-action=copy]").click()');await until(()=>js('window.exportErrors.length'));assert.match(await js('window.exportErrors[0]'),/user_gesture_required/);assert.equal(copied.length,0);
 const click=async action=>{const p=await js(`(()=>{const r=document.querySelector('[data-export-action=${action}]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.focus();win.webContents.sendInputEvent({type:'mouseDown',button:'left',...p,clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',button:'left',...p,clickCount:1});};
 await click('copy');await until(()=>copied.length);assert.deepEqual(copied,['frame-json']);
 await click('save');await until(()=>fs.existsSync(destination));assert.equal(fs.readFileSync(destination,'utf8'),'{"frame":1}');
 cancel=true;const before=await js('window.exportResults.length');await click('save');await until(()=>js(`window.exportResults.length>${before}`));assert.equal(await js('window.exportResults.at(-1).result.state'),'cancelled');cancel=false;
 const {LocalServiceClient}=await import('../dist/services/local-endpoint.js');const client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);
 destination=path.join(dir,'frames.jsonl');await click('record');const status=await until(async()=>{const result=await client.manage({operation:'plugin_exports'});const failure=result.jobs.find(job=>job.kind==='frames'&&job.state==='failed');if(failure)throw Error('frame export failed: '+JSON.stringify(failure));return result.jobs.find(job=>job.kind==='frames'&&job.state==='committed');});assert.equal(status.frames,12);
 const records=fs.readFileSync(destination,'utf8').trim().split('\n').map(JSON.parse),frames=records.filter(record=>record.kind==='frame');assert.equal(frames.length,12);for(let n=1;n<frames.length;n++)assert.equal(frames[n].frame.vi,frames[n-1].frame.vi+1);assert.equal(records.at(-1).complete,true);
 // Reset while the picker is open revokes the grant before any write.
 destination=path.join(dir,'stale.json');hold=true;const previousChoices=choices;await click('save');await until(()=>choices>previousChoices);const health=await client.manage({operation:'app_health'});assert(health.user_interaction_waits.some(wait=>wait.reason==='save_dialog'));
 const reset=await sessions.request('session.reset');assert(reset.ok);release({canceled:false,filePath:destination});await until(()=>js('window.exportErrors.some(error=>/stale_|scope/.test(error))'));assert.equal(fs.existsSync(destination),false);
 client.close();console.log('PLUGIN_EXPORT_UI_PASS');app.quit();
}catch(error){console.error(error);app.exit(1);}});
