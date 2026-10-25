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
