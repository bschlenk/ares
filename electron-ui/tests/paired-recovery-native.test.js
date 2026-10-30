import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {makeFixture} from '../fixture.cjs';
import {NativeSessionClient} from '../dist/services/native-client.js';
import {PluginJournals} from '../dist/plugins/journal.js';
import {PairedRecovery} from '../dist/services/paired-recovery.js';
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.result;},host=process.env.ARES_HOST||path.resolve(import.meta.dirname,'../../build-electron-make/bin/ares-electron-host');
for(const system of ['Game Boy','Game Boy Color'])test(`${system}: crash replacement restores paired RAM and journal; pristine guard prevents rewind`,{timeout:25000},async()=>{
  const root=await fs.mkdtemp('/tmp/ares-paired-native-'),instances=[];const rom=path.join(root,'fixture.gb'),settings=path.join(root,'settings.bml');await fs.writeFile(rom,makeFixture());await fs.writeFile(settings,'');
  async function instance(){const identity={session:randomUUID(),epoch:1};const child=spawn(host,['--rom',rom,'--system',system,'--paused','--silent','--settings',settings,'--save-dir',path.join(root,identity.session),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});const closed=once(child,'close');child.stdout.resume();child.stderr.resume();const client=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{});const i={client,child,closed};instances.push(i);unwrap(await client.request('session.status'));return i;}
  try{
    const source=await instance(),journals=new PluginJournals(),access={pluginId:'test.paired',storageVersion:1,journalFile:path.join(root,'journal.json')},broker=new PairedRecovery(path.join(root,'pairs'),journals);
    const request=async(i,m,p)=>unwrap(await i.client.request(m,undefined,p));
    const ram=async i=>(await request(i,'memory.regions')).regions.find(r=>r.name==='CPU WRAM');
    const append=(id,value)=>journals.request(access.journalFile,'events','journal.append',{id,schemaVersion:1,value},()=>{});
    const region=await ram(source);await request(source,'memory.write',{region:region.id,offset:128,hex:'42'});await append('saved',{note:'at checkpoint'});
    await request(source,'input.set',{port:1,buttons:['A'],leaseFrames:60,leaseMs:1000});
    await assert.rejects(broker.capture(access,source.client,{...source.client.identity},()=>{}),/input_active/);
    await request(source,'input.release',{port:0});await request(source,'session.resume');
    const point=await broker.capture(access,source.client,{...source.client.identity},()=>{});assert.equal(point.journalSequence,1);assert.equal((await request(source,'session.status')).paused,false);
    await request(source,'memory.write',{region:region.id,offset:128,hex:'99'});await append('abandoned',{note:'after checkpoint'});
    source.client.close();source.child.kill('SIGKILL');await source.closed;
    const used=await instance();await request(used,'input.set',{port:1,buttons:['Start'],leaseFrames:1,leaseMs:100});await request(used,'input.release',{port:0});await assert.rejects(broker.restoreStartup([access],used.client,{...used.client.identity}),/recovery_not_pristine/);
    const human=await instance();human.child.stdin.write('key Enter 1\n');await request(human,'session.resume');await new Promise(r=>setTimeout(r,50));
    await assert.rejects(broker.capture(access,human.client,{...human.client.identity},()=>{}),/input_active/,'held human input defers capture after takeover was consumed');
    human.child.stdin.write('key Enter 0\n');await request(human,'session.pause');await assert.rejects(broker.restoreStartup([access],human.client,{...human.client.identity}),/recovery_not_pristine/);
    const progressed=await instance();await request(progressed,'session.resume');await new Promise(r=>setTimeout(r,60));await request(progressed,'session.pause');
    await assert.rejects(broker.restoreStartup([access],progressed.client,{...progressed.client.identity}),/recovery_not_pristine/,'even input-free elapsed gameplay cannot be rewound');
    const target=await instance();const restored=await broker.restoreStartup([access],target.client,{...target.client.identity});assert.equal(restored.restored,true);assert.equal(target.client.identity.epoch,2);assert.equal((await request(target,'session.status')).paused,true);
    assert.equal((await request(target,'memory.read',{region:(await ram(target)).id,offset:128,length:1})).hex,'42');
    const active=await journals.request(access.journalFile,'events','journal.read',{afterSequence:0,limit:64},()=>{});assert.deepEqual(active.records.map(r=>r.id),['saved']);assert.equal(active.nextSequence,3);
    assert.equal((await journals.request(access.journalFile,'events','journal.append',{id:'new-session',schemaVersion:1,value:0},()=>{})).sequence,3);
    await request(target,'session.resume');assert.equal((await request(target,'session.status')).paused,false);
    await broker.disarmGame(point.gameHash);const normal=await instance();assert.equal((await broker.restoreStartup([access],normal.client,{...normal.client.identity})).restored,false);
  }finally{for(const i of instances){i.client.close();if(i.child.exitCode===null&&i.child.signalCode===null){i.child.stdin.end('quit\n');const timer=setTimeout(()=>i.child.kill('SIGKILL'),3000);await i.closed;clearTimeout(timer);}}await fs.rm(root,{recursive:true,force:true});}
});
test('Nintendo 64 uses the same paired broker and restores native registers plus the journal cutoff',{timeout:60000},async()=>{
  const root=await fs.mkdtemp('/tmp/ares-paired-n64-'),instances=[],rom=path.join(root,'fixture.z64'),settings=path.join(root,'settings.bml');
  const image=Buffer.alloc(0x1000);image.writeUInt32BE(0x80371240);image.write('PAIRED FIXTURE',0x20);image[0x3e]=0x45;image.writeUInt32BE(0x1000ffff,0x40);await fs.writeFile(rom,image);await fs.writeFile(settings,'');
  async function instance(){const identity={session:randomUUID(),epoch:1},child=spawn(host,['--rom',rom,'--system','Nintendo 64','--paused','--silent','--settings',settings,'--save-dir',path.join(root,identity.session),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']}),closed=once(child,'close');child.stdout.resume();child.stderr.resume();const client=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),i={client,child,closed};instances.push(i);unwrap(await client.request('session.status'));return i;}
  try{
    const source=await instance(),journals=new PluginJournals(),access={pluginId:'test.paired',storageVersion:1,journalFile:path.join(root,'journal.json')},broker=new PairedRecovery(path.join(root,'pairs'),journals);
    unwrap(await source.client.request('n64.cpu.setRegisters',undefined,{gpr:[{index:8,value:'0x1122aabb'}],pc:'0xb0000040',hi:null,lo:null,llbit:null,status:null}));
    await journals.request(access.journalFile,'events','journal.append',{id:'saved',schemaVersion:1,value:1},()=>{});
    await broker.capture(access,source.client,{...source.client.identity},()=>{});
    await journals.request(access.journalFile,'events','journal.append',{id:'abandoned',schemaVersion:1,value:2},()=>{});
    source.client.close();source.child.kill('SIGKILL');await source.closed;
    const target=await instance();assert.equal((await broker.restoreStartup([access],target.client,{...target.client.identity})).restored,true);
    assert.equal(BigInt(unwrap(await target.client.request('n64.debug.registers')).gpr[8]),0x1122aabbn);assert.equal(target.client.identity.epoch,2);
    assert.deepEqual((await journals.request(access.journalFile,'events','journal.read',{afterSequence:0,limit:64},()=>{})).records.map(r=>r.id),['saved']);
  }finally{for(const i of instances){i.client.close();if(i.child.exitCode===null&&i.child.signalCode===null){i.child.stdin.end('quit\n');const timer=setTimeout(()=>i.child.kill('SIGKILL'),3000);await i.closed;clearTimeout(timer);}}await fs.rm(root,{recursive:true,force:true});}
});
