import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDemonstrationControls} from '../dist/browser/ui/demonstration-controls.js';

test('background toolbar waits for native readiness and stops polling after disconnect',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const button=()=>({onclick:null}),record=button(),cancel=button(),description={};
  const controls={querySelector:id=>id==='#video-record'?record:id==='#video-record-cancel'?cancel:description};
  let publish;const calls=[];
  const bridge={onSessionState:callback=>{publish=callback;},session:async(method,identity)=>{calls.push({method,identity});return {ok:true};}};
  const dispose=installDemonstrationControls(bridge,controls,()=>{},()=>assert.fail('background readiness must not show an error'));
  const tick=async()=>{t.mock.timers.tick(250);await Promise.resolve();await Promise.resolve();};
  await tick();assert.equal(calls.length,0,'module loading is not native readiness');
  publish({ok:true,session:'first',epoch:1,result:{}});await tick();assert.deepEqual(calls,[{method:'n64.demo.status',identity:{session:'first',epoch:1}}]);
  publish({ok:false,error:'native_host_disconnected'});await tick();await tick();assert.equal(calls.length,1,'do not keep calling a disconnected host');
  publish({ok:true,session:'next',epoch:2,result:{}});await tick();assert.equal(calls.length,2);assert.equal(calls[1].identity.session,'next');
  dispose();publish({ok:true,session:'next',epoch:2,result:{}});await tick();assert.equal(calls.length,2);
});
