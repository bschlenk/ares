import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyDevSources} from '../scripts/dev-sources.js';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {makeFixture} from '../fixture.cjs';
const root=path.resolve(import.meta.dirname,'..'), temporary=fs.mkdtempSync('/tmp/ares-dev-runtime-');
const source=path.join(temporary,'source'), ipc=path.join(temporary,'ipc'), plugin=path.join(temporary,'plugin'), alias=path.join(temporary,'plugin-link');
copyDevSources(root,source);
fs.symlinkSync(path.resolve(root,'../.git'),path.join(source,'.git'),'dir');
for(const name of ['node_modules','bundled-plugins'])fs.symlinkSync(path.join(root,name),path.join(source,name),'dir');
fs.mkdirSync(plugin);fs.symlinkSync(plugin,alias,'dir');
fs.writeFileSync(path.join(plugin,'manifest.json'),JSON.stringify({id:'test.dev',name:'Dev fixture',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities:[],contributes:{panels:[{id:'view',title:'Dev fixture',placement:'modal'}],commands:[{id:'open',title:'Open fixture'}]}}));
const pluginSource=version=>`export function activate(ctx){ctx.log.info('version ${version}');ctx.ui.registerPanel('view',({element})=>{element.textContent='version ${version}'});ctx.ui.registerCommand('open',()=>ctx.ui.openPanel('view'));}`;
fs.writeFileSync(path.join(plugin,'plugin.js'),pluginSource(1));
const rom=path.join(temporary,'fixture.gb');fs.writeFileSync(rom,makeFixture());
const candidate=path.resolve(root,'../build_macos/workbench/bin/ares-electron-host');
const host=process.env.ARES_HOST||(fs.existsSync(candidate)?candidate:path.resolve(root,'../build-electron-make/bin/ares-electron-host'));
const child=spawn(process.execPath,[path.join(source,'scripts/start.js'),'--watch'],{cwd:root,env:{...process.env,ARES_HOST:host,ARES_RESOURCE_DIR:path.resolve(root,'../mia'),ARES_PROFILE_DIR:path.join(temporary,'profile'),ARES_SERVICE_DIR:ipc,ARES_PLUGIN_DIRS:alias,ARES_DEFAULT_PLUGINS:'0',ARES_DISABLE_PLUGINS:'',ARES_ROM:'',ARES_AUTOTEST:'',ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1'},stdio:['ignore','pipe','pipe']});
const closed=once(child,'close');let diagnostics='',client,selected;
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{diagnostics+=data;});
const deadline=setTimeout(()=>child.kill('SIGTERM'),60000);
const until=async(check,label)=>{for(let i=0;i<500;i++){try{const result=await check();if(result)return result;}catch{}if(child.exitCode!==null)throw new Error(diagnostics);await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+label+'\n'+diagnostics);};
async function current(){
 for(const file of fs.existsSync(ipc)?fs.readdirSync(ipc).filter(f=>/^[a-f0-9-]+\.json$/.test(f)):[]){
  const connection=path.join(ipc,file);
  if(selected!==connection){client?.close();const metadata=JSON.parse(fs.readFileSync(connection));client=new LocalServiceClient(connection,metadata.instance,1000);selected=connection;}
  try{return await client.manage({operation:'app_status'});}catch{client.close();client=undefined;selected=undefined;}
 }
}
async function pluginInfo(){
 for(let offset=0;;){const page=await client.manage({operation:'list',offset,limit:4});const found=page.plugins.find(p=>p.manifest?.id==='test.dev');if(found)return found;if(page.nextOffset===null)return;offset=page.nextOffset;}
}
try{
 const initial=await until(async()=>{const status=await current();return status?.ready&&status;},'initial app');
 const snapshot=diagnostics.match(/Development runtime: (.+)/)[1].trim();
 const loaded=await client.manage({operation:'load_rom',path:rom,system:'Game Boy'});assert.equal(loaded.system??'Game Boy','Game Boy');
 await until(async()=>(await client.request('session.status')).result?.system==='Game Boy','game loaded');
 const identity=(await client.request('session.status')).session;
 fs.appendFileSync(path.join(source,'renderer.ts'),"\ndocument.body.dataset.devFixture = 'renderer';\n");
 await until(()=>diagnostics.includes('Reloading UI'),'renderer reload');
 assert.equal((await current()).pid,initial.pid);assert.equal((await client.request('session.status')).session,identity);
 let info=await until(async()=>{const p=await pluginInfo();return p?.phase==='active'&&p;},'plugin ready');
 await client.manage({operation:'command',id:'test.dev',token:info.lease.token,name:'open'});
 const oldToken=info.lease.token;
 fs.writeFileSync(path.join(plugin,'plugin.js'),pluginSource(2));
 info=await until(async()=>{const p=await pluginInfo();return p?.phase==='active'&&p.lease.token!==oldToken&&p;},'symlinked plugin hot reload');
 await client.manage({operation:'screenshot',panel:'test.dev:view',path:path.join(temporary,'plugin.png')});
 assert.equal((await client.request('session.status')).session,identity);
 fs.appendFileSync(path.join(source,'library/service.ts'),'\nexport const devRuntimeFixture = 1;\n');
 const restarted=await until(async()=>{const status=await current();return status?.ready&&status.pid!==initial.pid&&status;},'host restart');
 await until(async()=>(await client.request('session.status')).result?.system==='Game Boy','ROM restored');
 fs.appendFileSync(path.join(source,'library/service.ts'),'\nexport const devBroken: number = "broken";\n');
 await until(()=>diagnostics.includes('Application build failed'),'failed build');
 assert.equal((await current()).pid,restarted.pid);
 const file=path.join(source,'library/service.ts');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('export const devBroken: number = "broken";','export const devBroken: number = 2;'));
 await until(async()=>{const status=await current();return status?.ready&&status.pid!==restarted.pid;},'recovered host restart');
 await until(async()=>(await client.request('session.status')).result?.system==='Game Boy','ROM restored after recovery');
 console.log('PASS automatic UI reload, symlinked plugin reload with modal retained, host restart/ROM restoration, failed-build preservation and recovery');
}catch(error){console.error(error);process.exitCode=1;}
finally{clearTimeout(deadline);client?.close();if(child.exitCode===null)child.kill('SIGTERM');await closed;fs.rmSync(temporary,{recursive:true,force:true});}
