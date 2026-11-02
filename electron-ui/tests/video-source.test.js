import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoSource} from '../dist/browser/video/source.js';
import {videoSize} from '../dist/browser/video/layout.js';
import {beginVideoCapture,endVideoCapture,captureHeld} from '../dist/browser/video/capture.js';

test('one latest native packet, explicit invalidation, stale epochs cannot cross sessions',()=>{
  const source=new VideoSource();let changes=0;const off=source.subscribe(()=>changes++);
  const packet=(session,epoch,sequence)=>({sequence,frameReference:{native_session:session,epoch}});
  source.session({session:'one',epoch:1});const a=packet('one',1,1);source.submit(a);assert.equal(source.latest,a);
  const b=packet('one',1,2);source.submit(b);assert.equal(source.latest,b);
  source.session({session:'one',epoch:2});assert.equal(source.latest,null);source.submit(a);assert.equal(source.latest,null);
  const c=packet('one',2,3);source.submit(c);assert.equal(source.latest,c);
  source.session({session:'two',epoch:1});source.submit(c);assert.equal(source.latest,null);
  source.submit(packet('two',1,1));assert(source.latest);source.setPaused(true);source.checkStale(performance.now()+5000);assert(source.latest);source.setPaused(false);source.checkStale(performance.now()+5000);assert.equal(source.latest,null);assert.equal(source.reason,'frame_stalled');source.reset('native_disconnected');assert.equal(source.latest,null);assert.equal(source.reason,'native_disconnected');source.session({session:'two',epoch:1});assert.equal(source.reason,'native_disconnected','late status cannot make a disconnected feed look like ordinary activation waiting');
  source.submit({sequence:4});assert.equal(source.latest,null);assert.equal(source.reason,'frame_identity_unavailable');off();assert(changes>0);
});
test('contain, cover, native aspect and device-pixel integer scaling',()=>{
  const contain=videoSize(400,300,144,160/144,1,{});assert.equal(contain.height,300);assert(Math.abs(contain.width-300*160/144)<1e-9);
  assert.deepEqual(videoSize(400,300,144,160/144,1,{fit:'cover'}),{width:400,height:360});
  assert.deepEqual(videoSize(400,300,144,160/144,1,{integerScale:true}),{width:320,height:288});
  assert.deepEqual(videoSize(400,300,144,160/144,2,{integerScale:true}),{width:320,height:288});
  assert.equal(videoSize(0,300,144,160/144,1,{}),null);
});
test('capture leases coalesce, bound admission and release presentation without changing a core',()=>{
  const ids=Array.from({length:4},()=>beginVideoCapture());assert(captureHeld());assert.throws(()=>beginVideoCapture(),/busy/);
  for(const id of ids)endVideoCapture(id);assert.equal(captureHeld(),false);
});

test('capture leases expire even if a client or renderer request disappears',async()=>{
  beginVideoCapture();assert(captureHeld());await new Promise(r=>setTimeout(r,2050));assert.equal(captureHeld(),false);
});
