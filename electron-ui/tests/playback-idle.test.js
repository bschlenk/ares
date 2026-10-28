import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installPlaybackIdle} from '../ui/playback-idle.ts';
test('toolbar and cursor both wait five seconds; movement and disposal clear both',t=>{
  const previous=globalThis.document;
  globalThis.document=new EventTarget();globalThis.document.hidden=false;
  t.after(()=>{globalThis.document=previous;});
  t.mock.timers.enable({apis:['setTimeout']});
  const viewport=new EventTarget();viewport.dataset={};
  const dispose=installPlaybackIdle(viewport);
  const move=()=>{const event=new Event('pointermove');Object.defineProperty(event,'pointerType',{value:'mouse'});viewport.dispatchEvent(event);};
  move();t.mock.timers.tick(4999);assert.deepEqual(viewport.dataset,{});
  t.mock.timers.tick(1);assert.equal(viewport.dataset.mouseIdle,'true');assert.equal(viewport.dataset.toolbarIdle,'true');
  move();assert.deepEqual(viewport.dataset,{});
  dispose();t.mock.timers.tick(5000);assert.deepEqual(viewport.dataset,{});
});

test('pointer leaving the video cancels both idle timers',t=>{
  const previous=globalThis.document;globalThis.document=new EventTarget();globalThis.document.hidden=false;t.after(()=>{globalThis.document=previous;});
  t.mock.timers.enable({apis:['setTimeout']});const viewport=new EventTarget();viewport.dataset={};const dispose=installPlaybackIdle(viewport);
  const enter=new Event('pointerenter');Object.defineProperty(enter,'pointerType',{value:'mouse'});viewport.dispatchEvent(enter);
  viewport.dispatchEvent(new Event('pointerleave'));t.mock.timers.tick(5000);assert.deepEqual(viewport.dataset,{});dispose();
});
