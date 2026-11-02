import {test} from 'node:test';import assert from 'node:assert/strict';
import {RendererRecovery} from '../dist/services/renderer-recovery.js';
test('renderer recovery reloads once, coalesces requests and preserves the native session',async()=>{
 const identity={session:'game',epoch:7};let reloads=0;const r=new RendererRecovery(()=>identity,()=>{reloads++});r.ready();assert.equal((await r.recover()).reason,'already_healthy');assert.equal(reloads,0);
 r.crashed('deliberate renderer crash');const a=r.recover(),b=r.recover();assert.equal(a,b);assert.equal(reloads,1);r.ready();assert.equal((await a).recovered,true);assert.equal(r.status().last_failure.reason,'deliberate renderer crash');
});
test('renderer recovery reports native changes and bounded timeout without replay or state loading',async()=>{
 let identity={session:'old',epoch:1},reloads=0;const r=new RendererRecovery(()=>identity,()=>{reloads++},5);r.crashed('crash');const pending=r.recover();identity={session:'new',epoch:1};r.ready();assert.equal((await pending).reason,'native_session_changed');
 r.crashed('another crash');assert.equal((await r.recover()).reason,'timeout');assert.equal(reloads,2);assert.equal(r.status().state,'failed');const retry=r.recover();r.ready();assert.equal((await retry).recovered,true);assert.equal(reloads,3);
 const absent=new RendererRecovery(()=>undefined,()=>assert.fail('must not reload an empty app'));absent.crashed('crash');assert.equal((await absent.recover()).reason,'native_session_unavailable');
});
