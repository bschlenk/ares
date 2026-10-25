const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PluginExports}=require('../dist/services/plugin-exports.js'),{ServiceError}=require('../dist/services/contracts.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(t){const dir=fs.mkdtempSync('/tmp/ares-plugin-export-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let identity={session:'native',epoch:1},allowed=new Set(['files.export','clipboard.write','memory.read']),destination=path.join(dir,'result.jsonl'),picker,owner,stops=0;const copied=[];
 const exports=new PluginExports({authorize(token,cap){if(token!=='lease'||!allowed.has(cap))throw new ServiceError('plugin_capability_denied');return {pluginId:'test.export',identity};},choose:async()=>picker?picker():destination,clipboard:text=>copied.push(text),start:async value=>{owner=value;return 1;},stop:async()=>{++stops;}});
 return {exports,dir,copied,get owner(){return owner},get destination(){return destination},get stops(){return stops},set destination(v){destination=v},set picker(v){picker=v},reset(){identity={session:'native',epoch:identity.epoch+1}},deny(cap){allowed.delete(cap)}};
}
function sample(owner,sequence){return {event:'observer_sample',owner,observer_id:1,session:'native',epoch:1,sequence,frame_reference:{native_session:'native',epoch:1,vi:sequence,boundary:'vi',origin:0x2000,origin_commit:2,video_sequence:null,presentation:null,provenance:'unmatched'},value:{n:sequence},error:''};}
async function done(exports,id){for(let n=0;n<300;n++){const job=exports.list(id)[0];if(['committed','cancelled','failed'].includes(job.state))return job;await sleep(5);}throw Error('export timeout');}
test('clipboard and save require capability/gesture, bound text, and reject stale picker leases',async t=>{
 const f=fixture(t);assert.throws(()=>f.exports.clipboard('lease','data',false),/user_gesture_required/);assert.equal(f.copied.length,0);assert.deepEqual(f.exports.clipboard('lease','data',true),{copied:true,bytes:4});f.deny('clipboard.write');assert.throws(()=>f.exports.clipboard('lease','data',true),/plugin_capability_denied/);
 await assert.rejects(f.exports.save('lease',{suggestedName:'data.json',text:'x'},false),/user_gesture_required/);await assert.rejects(f.exports.save('lease',{suggestedName:'../data',text:'x'},true),/invalid_export_name/);
 let release;f.picker=()=>new Promise(r=>release=r);const saving=f.exports.save('lease',{suggestedName:'data.json',text:'x'},true);assert.equal(f.exports.waits()[0].reason,'save_dialog');f.reset();release(f.destination);await assert.rejects(saving,/stale_export_ticket/);assert.equal(fs.existsSync(f.destination),false);
});
test('save cancellation and overwrite choices preserve destinations and integrity metadata',async t=>{
 const f=fixture(t);f.picker=async()=>undefined;assert.equal((await f.exports.save('lease',{suggestedName:'data.json',text:'x'},true)).state,'cancelled');f.picker=undefined;
 fs.writeFileSync(f.destination,'keep');await assert.rejects(f.exports.save('lease',{suggestedName:'data.json',text:'replace'},true),/file_exists/);assert.equal(fs.readFileSync(f.destination,'utf8'),'keep');
 const saved=await f.exports.save('lease',{suggestedName:'data.json',text:'replace',overwrite:true},true);assert.equal(saved.state,'committed');assert.equal(saved.artifact.sha256,createHash('sha256').update('replace').digest('hex'));assert.equal(fs.statSync(f.destination).mode&0o077,0);
});
test('bounded sequence streams frozen frame identities before renderer coalescing',async t=>{
 const f=fixture(t),job=await f.exports.record('lease',{suggestedName:'frames.jsonl',source:'export default()=>1',maxFrames:3},true);
 for(let n=1;n<=3;n++)f.exports.observe(sample(f.owner,n));const status=await done(f.exports,job.jobId);assert.equal(status.state,'committed',JSON.stringify(status));assert.equal(status.frames,3);assert.equal(f.stops,1);
 const lines=fs.readFileSync(f.destination,'utf8').trim().split('\n').map(JSON.parse);assert.equal(lines[0].format,'ares-frame-sequence-v1');assert.deepEqual(lines.filter(v=>v.kind==='frame').map(v=>v.frame.vi),[1,2,3]);assert.equal(lines.at(-1).complete,true);assert.equal(status.artifact.bytes,fs.statSync(f.destination).size);
});
test('native loss, queue overflow, reset, cancellation and byte limits do not publish incomplete exports',async t=>{
 for(const mode of ['loss','queue','reset','cancel','bytes']){await t.test(mode,async t=>{
  const f=fixture(t),job=await f.exports.record('lease',{suggestedName:'frames.jsonl',source:'export default()=>1',maxFrames:100,maxBytes:mode==='bytes'?1024:8388608},true);
  if(mode==='loss'){f.exports.observe(sample(f.owner,1));f.exports.observe(sample(f.owner,3));}
  if(mode==='queue')for(let n=1;n<=40;n++)f.exports.observe(sample(f.owner,n));
  if(mode==='reset')f.reset();
  if(mode==='cancel')await f.exports.finish('lease',job.jobId,true);
  if(mode==='bytes'){const s=sample(f.owner,1);s.value={text:'x'.repeat(2000)};f.exports.observe(s);}
  const status=await done(f.exports,job.jobId);assert(['failed','cancelled'].includes(status.state),JSON.stringify(status));assert.equal(fs.existsSync(f.destination),false);assert.equal(f.stops,1);assert.deepEqual(fs.readdirSync(f.dir),[]);
 });}
});
test('an existing selected destination changed during recording is preserved',async t=>{
 const f=fixture(t);fs.writeFileSync(f.destination,'original');const job=await f.exports.record('lease',{suggestedName:'frames.jsonl',source:'export default()=>1',overwrite:true},true);
 fs.writeFileSync(f.destination,'changed by another writer');f.exports.observe(sample(f.owner,1));const status=await done(f.exports,job.jobId);assert.equal(status.state,'failed');assert.equal(status.reason,'export_destination_changed');assert.equal(fs.readFileSync(f.destination,'utf8'),'changed by another writer');
});
