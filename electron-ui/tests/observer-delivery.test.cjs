const {test}=require('node:test');const assert=require('node:assert/strict');
const {ObserverDeliveries}=require('../dist/services/observer-delivery.js');
const {framesMatch}=require('../dist/browser/plugins/overlays.js');
function sample(sequence,patch={}){return {event:'observer_sample',session:'native',epoch:1,owner:'plugin-one',observer_id:1,sequence,frame_reference:{native_session:'native',epoch:1,vi:sequence,origin_commit:2,origin:4096,presentation:null,video_sequence:null,boundary:'vi',provenance:'unmatched'},value:{sequence},error:'',...patch};}
test('observer deliveries bound slow consumers and isolate acknowledgements and disposal',()=>{
 const live=new Set(['plugin-one','plugin-two']),sent=[];const broker=new ObserverDeliveries(owner=>live.has(owner),event=>sent.push(event));
 broker.publish(sample(1));for(let n=2;n<=100;n++)broker.publish(sample(n));assert.equal(sent.length,1);
 broker.ack('plugin-two',1,sent[0].delivery);assert.equal(sent.length,1);
 broker.ack('plugin-one',1,sent[0].delivery);assert.equal(sent.length,2);assert.equal(sent[1].sequence,100);assert.equal(sent[1].skipped,98);
 broker.publish(sample(2,{owner:'plugin-two',observer_id:2}));assert.equal(sent.length,3);
 broker.stop('plugin-one',1);broker.ack('plugin-one',1,sent[1].delivery);assert.equal(sent.length,3);
 live.delete('plugin-two');broker.publish(sample(3,{owner:'plugin-two',observer_id:2}));assert.equal(sent.length,3);
});
test('frame matching requires native lineage, VI and origin-write identity',()=>{
 const a=sample(5).frame_reference;assert(framesMatch(a,{...a,video_sequence:500}));
 for(const patch of [{epoch:2},{native_session:'replacement'},{vi:6},{vi:null},{origin_commit:3}])assert.equal(framesMatch(a,{...a,...patch}),false);
});
test('60 VI samples bound independent 30 Hz and slow consumers with exact loss accounting',()=>{
 const sent=[],broker=new ObserverDeliveries(()=>true,e=>sent.push(e));
 const last=new Map(),delivered=new Map(),skipped=new Map();
 const ack=owner=>{const event=last.get(owner);if(event){last.delete(owner);broker.ack(owner,event.observer_id,event.delivery);}};
 // Use deterministic VI ticks: acknowledgements represent completion of each
 // renderer callback, including a consumer that takes ten VIs per callback.
 for(let vi=1;vi<=120;vi++){
  for(const [owner,id] of [['thirty-hz',1],['slow',2]])broker.publish(sample(vi,{owner,observer_id:id}));
  while(sent.length){const e=sent.shift();last.set(e.owner,e);delivered.set(e.owner,(delivered.get(e.owner)||0)+1);skipped.set(e.owner,(skipped.get(e.owner)||0)+(e.skipped||0));assert.equal(e.value.sequence,e.frame_reference.vi);}
  for(const [owner,period] of [['thirty-hz',2],['slow',10]])if(vi%period===0)ack(owner);
  while(sent.length){const e=sent.shift();last.set(e.owner,e);delivered.set(e.owner,(delivered.get(e.owner)||0)+1);skipped.set(e.owner,(skipped.get(e.owner)||0)+(e.skipped||0));}
 }
 for(const owner of ['thirty-hz','slow']){assert.equal(last.get(owner).sequence,120);assert.equal(delivered.get(owner)+skipped.get(owner),120);}
 assert(delivered.get('thirty-hz')>delivered.get('slow'));assert(delivered.get('thirty-hz')<=61);assert(delivered.get('slow')<=13);
 broker.stop('thirty-hz',1);broker.stop('slow',2);for(const owner of ['thirty-hz','slow'])ack(owner);assert.equal(sent.length,0);
});
