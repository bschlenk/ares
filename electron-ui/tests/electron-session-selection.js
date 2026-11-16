import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeFixture} from '../fixture.cjs';
import {Targets} from '../dist/sessions/targets.js';
import {ToolRegistry} from '../dist/tools/registry.js';
import {registerTools} from '../dist/mcp/register-tools.js';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
const root=fs.mkdtempSync('/tmp/ares-selection-ui-'),personal=path.join(root,'personal'),directory=path.join(root,'ipc'),rom=path.join(root,'fixture.gb');
fs.mkdirSync(personal);fs.writeFileSync(rom,makeFixture());
if(process.argv.includes('--disabled-named-test'))fs.writeFileSync(path.join(personal,'preferences.json'),JSON.stringify({version:1,revision:1,values:{'agent.enabled':false}}));
Object.assign(process.env,{ARES_PROFILE_DIR:personal,ARES_SERVICE_DIR:directory,ARES_DEFAULT_PLUGINS:'0',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1'});
const named=!process.argv.includes('--personal-test');
process.argv.push(...(process.argv.includes('--disabled-named-test')?[]:['--services']),...(named?['--session-name','work']:[]));
const {serviceHost,sessions}=await import('../dist/main.js');
const timer=setTimeout(()=>{console.error('selection deadline');app.exit(1)},45000);
app.on('will-quit',()=>{clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true});});
const until=async check=>{for(let i=0;i<800;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('selection startup timeout');};
app.whenReady().then(async()=>{
 let close;
 try{
  await until(()=>serviceHost.info&&BrowserWindow.getAllWindows()[0]&&sessions.identity);
  const targets=new Targets(directory,personal),tools=new ToolRegistry();close=registerTools(tools,new LocalServiceClient('',''),targets);
  const tool=async(name,args={})=>{const r=await tools.call(name,args);const value=JSON.parse(r.content[0].text);if(r.isError)throw Error(JSON.stringify(value));return value;};
  let list=await tool('sessions_list');assert.equal(list.instances.length,1);assert.equal(list.instances[0].loaded,false);assert(sessions.identity);
  const {target}=await tool('session_select',{instance_id:serviceHost.instance});
  if(named){
    assert.equal(list.sessions[0].name,'work');
    await tool('load_rom',{target,path:rom,system:'Game Boy'});
    const status=await tool('emu_status',{target});assert.equal(status.system,'Game Boy');assert(status.session);
    list=await tool('sessions_list');assert.equal(list.instances[0].loaded,true);assert.equal(list.instances[0].paused,true);assert.equal(list.instances[0].system,'Game Boy');
    await tool('close_rom',{target});
  }else{
    const denied=await tools.call('emu_status',{target});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/access_required/);
    assert(sessions.identity);assert.equal((await tool('access_status',{target})).state,'unapproved');
  }
  console.log(named?'SESSION_SELECTION_NAMED_PASS':'SESSION_SELECTION_PERSONAL_PASS');close();app.quit();
 }catch(error){console.error(error);close?.();app.exit(1);}
});
