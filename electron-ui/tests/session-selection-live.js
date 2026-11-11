import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import electron from 'electron';
import {StdioPeer} from './stdio-peer.cjs';
import {makeFixture} from '../fixture.cjs';
import {LocalServiceClient} from '../dist/services/local-endpoint.js';
import {discoverInstances} from '../dist/sessions/discovery.js';
const root=fs.mkdtempSync('/tmp/ares-selection-live-'),directory=path.join(root,'ipc'),personal=path.join(root,'personal'),rom=path.join(root,'fixture.gb');
fs.mkdirSync(personal);fs.writeFileSync(rom,makeFixture());
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ARES_')&&key!=='ARES_HOST')delete env[key];
Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'',ARES_PROFILE_DIR:personal,ARES_SERVICE_DIR:directory,ARES_SILENT:'1',ARES_BACKGROUND_TEST:'1',ARES_DEFAULT_PLUGINS:'0'});
const peer=new StdioPeer(electron,[path.resolve(import.meta.dirname,'../dist/mcp/server.js'),'--service-dir',directory],{env});
const pids=new Set();
async function processes(){const live=await discoverInstances(directory);for(const instance of live){const client=new LocalServiceClient(path.join(directory,instance.instance+'.json'),instance.instance);try{pids.add((await client.manage({operation:'app_status'})).pid);}finally{client.close();}}return live;}
async function cli(tool,target){const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../dist/cli.js'),'call',tool],{env:{...env,ARES_TARGET:target},stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);const [code]=await once(child,'close');assert.equal(code,0,error);return JSON.parse(output);}
try{
 await peer.initialize();assert.equal((await peer.tool('sessions_list')).instances.length,0);assert.equal(fs.existsSync(directory),false);
 const opened=await peer.tool('session_open',{name:'work'});assert(!opened.error,JSON.stringify(opened));await processes();
 const loaded=await peer.tool('load_rom',{target:opened.target,path:rom,system:'Game Boy'});assert(!loaded.error,JSON.stringify(loaded));assert.equal(loaded.loaded,true);
 const other=await peer.tool('session_open',{name:'other'});assert(!other.error,JSON.stringify(other));await processes();
 const [a,b]=await Promise.all([peer.tool('emu_status',{target:opened.target}),peer.tool('emu_status',{target:other.target})]);assert.notEqual(a.session,b.session);assert.equal(a.system,'Game Boy');
 const status=await cli('emu_status',opened.target);assert.equal(status.session,a.session);
 const denied=await peer.tool('emu_status');assert.match(denied.error,/access_required/);
 const instances=await processes();assert.equal(instances.filter(i=>i.kind==='personal').length,1);assert.equal(instances.filter(i=>i.kind==='named').length,2);
 assert.equal((await peer.tool('emu_status',{target:opened.target})).session,a.session);
 console.log('SESSION_SELECTION_LIVE_PASS: runtime open/select, two named targets, CLI exported handle, named-only default launch and personal denial');
} catch(error){console.error(error);process.exitCode=1;}
finally{
 await processes().catch(()=>{});await peer.close();for(const pid of pids)try{process.kill(pid,'SIGTERM');}catch{}
 for(let i=0;i<100;i++){let live=false;for(const pid of pids)try{process.kill(pid,0);live=true;}catch{}if(!live)break;await new Promise(r=>setTimeout(r,50));}
 for(const pid of pids)try{process.kill(pid,'SIGKILL');}catch{}
 fs.rmSync(root,{recursive:true,force:true});
}
