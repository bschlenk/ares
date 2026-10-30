import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PluginJournals} from '../dist/plugins/journal.js';
import {JOURNAL_LIMITS} from '../dist/plugins/journal-contracts.js';
const record=(id,value={text:'remember this'})=>({id,schemaVersion:1,value});
const guard=()=>{};
test('journal persists ordered events/notes, paginates and makes retries idempotent',async()=>{
  const root=await fs.mkdtemp('/tmp/ares-journal-'),file=path.join(root,'plugin-v1.journal.json');
  try{
    const store=new PluginJournals(),append=(stream,r)=>store.request(file,stream,'journal.append',r,guard);
    const a=await append('events',record('a',{b:2,a:1}));assert.equal(a.sequence,1);assert.equal(a.duplicate,false);
    await append('notes',record('note-1'));await append('events',record('b'));
    const duplicate=await append('events',record('a',{a:1,b:2}));assert.equal(duplicate.sequence,1);assert.equal(duplicate.duplicate,true);
    await assert.rejects(append('events',record('a',{a:9})),/journal_id_conflict/);
    const orphan=file+'.'+randomUUID();await fs.writeFile(orphan,'unpublished crash residue');
    const restarted=new PluginJournals();const first=await restarted.request(file,'events','journal.read',{afterSequence:0,limit:1},guard);
    await assert.rejects(fs.stat(orphan),{code:'ENOENT'});
    assert.equal(first.records[0].id,'a');assert.equal(first.hasMore,true);assert.equal(first.nextSequence,4);
    const next=await restarted.request(file,'events','journal.read',{afterSequence:first.cursor,limit:64},guard);assert.deepEqual(next.records.map(r=>r.id),['b']);assert.equal(next.hasMore,false);
    assert.equal((await restarted.request(path.join(root,'plugin-v2.journal.json'),'events','journal.read',{afterSequence:0,limit:64},guard)).records.length,0);
    assert.equal((await fs.stat(file)).mode&0o777,0o600);
    assert.deepEqual((await fs.readdir(root)).sort(),['plugin-v1.journal.json']);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('journal serializes concurrent appends, bounds admission and rejects revoked publication',async()=>{
  const root=await fs.mkdtemp('/tmp/ares-journal-'),file=path.join(root,'data.json');
  try{
    const store=new PluginJournals(),jobs=Array.from({length:16},(_,i)=>store.request(file,'events','journal.append',record(String(i)),guard));
    await assert.rejects(store.request(file,'events','journal.append',record('overload'),guard),/journal_overload/);
    assert.deepEqual((await Promise.all(jobs)).map(r=>r.sequence),Array.from({length:16},(_,i)=>i+1));
    const before=await fs.readFile(file,'utf8');let calls=0;
    await assert.rejects(store.request(file,'events','journal.append',record('revoked'),()=>{if(++calls===3)throw new Error('stale_plugin_scope');}),/stale_plugin_scope/);
    assert.equal(await fs.readFile(file,'utf8'),before);assert.deepEqual(await fs.readdir(root),['data.json']);
    assert.equal((await store.request(file,'events','journal.append',record('next'),guard)).sequence,17);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('journal preserves committed data on rename faults, corruption, symlinks and quota failures',async()=>{
  const root=await fs.mkdtemp('/tmp/ares-journal-'),file=path.join(root,'data.json');
  try{
    const store=new PluginJournals();await store.request(file,'events','journal.append',record('first'),guard);const before=await fs.readFile(file,'utf8');
    const rename=fs.rename;fs.rename=async()=>{throw new Error('injected rename failure');};
    try{await assert.rejects(store.request(file,'events','journal.append',record('fault'),guard),/injected rename failure/);}finally{fs.rename=rename;}
    assert.equal(await fs.readFile(file,'utf8'),before);assert.deepEqual(await fs.readdir(root),['data.json']);
    const corrupt=path.join(root,'corrupt.json');await fs.writeFile(corrupt,'{"format":2}');await assert.rejects(store.request(corrupt,'events','journal.append',record('a'),guard),/journal_invalid_file/);assert.equal(await fs.readFile(corrupt,'utf8'),'{"format":2}');
    const link=path.join(root,'link.json');await fs.symlink(file,link);await assert.rejects(store.request(link,'events','journal.append',record('a'),guard));assert.equal(await fs.readFile(file,'utf8'),before);
    const records=[];let bytes=0;while(bytes<JOURNAL_LIMITS.bytes-10000){records.push({sequence:records.length+1,stream:'events',id:String(records.length),schemaVersion:1,value:'x'.repeat(4000)});bytes=Buffer.byteLength(JSON.stringify({format:1,nextSequence:records.length+1,records}));}
    const full=JSON.stringify({format:1,nextSequence:records.length+1,records});assert(Buffer.byteLength(full)<JOURNAL_LIMITS.bytes);await fs.writeFile(file,full);
    await assert.rejects(store.request(file,'events','journal.append',record('too-big','x'.repeat(16000)),guard),/journal_quota_exceeded/);assert.equal(await fs.readFile(file,'utf8'),full);
    const invalid=[undefined,NaN,1n,new Date(),{bad:undefined},'x'.repeat(17000)];const cycle={};cycle.self=cycle;invalid.push(cycle);
    for(const value of invalid)await assert.rejects(store.request(path.join(root,'empty.json'),'events','journal.append',{id:'invalid',schemaVersion:1,value},guard),/journal_invalid_json|journal_record_too_large/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('plugin journal capability, namespace and activation scopes are enforced at the host',async()=>{
  const {PluginRegistry}=await import('../dist/plugins/registry.js');
  const root=await fs.mkdtemp('/tmp/ares-journal-registry-'),data=path.join(root,'data'),sources=[];
  try{
    for(const [id,capabilities] of [['one',['storage.journal']],['two',['storage.journal']],['denied',[]]]){
      const source=path.join(root,id);sources.push(source);await fs.mkdir(source);await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({id:'test.'+id,name:id,version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities,contributes:{}}));await fs.writeFile(path.join(source,'plugin.js'),'export function activate(){}');
    }
    const identity={session:'journal',epoch:1},registry=new PluginRegistry(path.join(root,'bundled'),data,{request:async()=>({protocol:1,id:'r',...identity,ok:true,result:{released:true}})},()=>identity);
    await registry.initialize(sources);registry.attach();registry.observe({protocol:1,id:'s',...identity,ok:true,result:{paused:false,system:'Game Boy',synthetic:false,capabilities:[]}});
    const tokens={};for(const id of ['one','two','denied']){await registry.enable('test.'+id,true);tokens[id]=registry.catalog().plugins.find(p=>p.manifest?.id==='test.'+id).lease.token;}
    await assert.rejects(registry.storage(tokens.one,'journal.append','events',record('early')),/plugin_not_ready/);
    registry.finish(tokens.one);registry.finish(tokens.two);registry.finish(tokens.denied);
    await assert.rejects(registry.storage(tokens.denied,'journal.read','events',{afterSequence:0,limit:1}),/plugin_capability_denied/);
    await registry.storage(tokens.one,'journal.append','events',record('first'));
    assert.equal((await registry.storage(tokens.two,'journal.read','events',{afterSequence:0,limit:64})).records.length,0);
    await assert.rejects(registry.storage(tokens.one,'journal.append','../events',record('bad')),/Invalid storage key/);
    await registry.enable('test.one',false);await assert.rejects(registry.storage(tokens.one,'journal.append','events',record('late')),/stale_plugin_scope/);
    registry.disconnect();
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
