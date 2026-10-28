import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FocusPause} from '../dist/services/focus-pause.js';
function setup() {
  let paused=false, operation=null, fail=false;
  const calls=[], events=[];
  const reply=()=>({protocol:1,id:'test',session:'session',epoch:0,ok:true,result:{paused,operation_id:operation,system:'Game Boy',synthetic:false,capabilities:[]}});
  const client={async request(method){calls.push(method);if(fail&&method!=='session.status')return {...reply(),ok:false,error:'busy'};if(method==='session.pause')paused=true;if(method==='session.resume')paused=false;return reply();}};
  const policy=new FocusPause(reply=>events.push(reply));policy.attach(client);
  const explicit=(method,owner='ui')=>policy.explicit(owner,()=>client.request(method),r=>r.ok);
  return {policy,client,calls,events,reply,explicit,setOperation:value=>operation=value,setFailure:value=>fail=value};
}
test('focus pause is separate from manual state and only resumes its own pause',async()=>{
  const s=setup();await s.policy.configure(true,false);
  assert.equal(s.reply().result.paused,true);
  assert.deepEqual(s.events.at(-1).result,{...s.reply().result,manual_paused:false,focus_paused:true});
  await s.policy.configure(true,true);assert.equal(s.reply().result.paused,false);
  await s.explicit('session.pause');await s.policy.configure(true,false);await s.policy.configure(true,true);
  assert.equal(s.reply().result.paused,true);
  assert.equal(s.policy.decorate(s.reply()).result.manual_paused,true);
});
test('manual pause while focus-paused remains paused on focus return; manual resume respects focus policy',async()=>{
  const s=setup();await s.policy.configure(true,false);await s.explicit('session.pause');await s.policy.configure(true,true);
  assert.equal(s.reply().result.paused,true);
  await s.policy.configure(true,false);await s.explicit('session.resume');
  assert.equal(s.policy.decorate(s.reply()).result.focus_paused,true);
  await s.policy.configure(true,true);assert.equal(s.reply().result.paused,false);
});
test('MCP explicit pause/resume overrides focus until UI explicitly takes control again',async()=>{
  const s=setup();await s.policy.configure(true,false);await s.explicit('session.resume','mcp-client');
  for(const focused of [true,false,true])await s.policy.configure(true,focused);
  assert.equal(s.reply().result.paused,false);
  await s.explicit('session.pause','mcp-client');await s.policy.configure(true,false);await s.policy.configure(true,true);
  assert.equal(s.reply().result.paused,true);
  await s.explicit('session.resume');await s.policy.configure(true,false);
  assert.equal(s.policy.decorate(s.reply()).result.focus_paused,true);
});
test('bounded execution is not interrupted or resumed by focus events',async()=>{
  const s=setup();s.setOperation(3);await s.policy.configure(true,false);
  assert.equal(s.calls.includes('session.pause'),false);
  await s.policy.takeControl();s.setOperation(null);
  await s.policy.configure(true,true);await s.policy.configure(true,false);
  assert.equal(s.reply().result.paused,false);
});
test('disabling auto-pause resumes its own pause; failures and replacement never resume a manual pause',async()=>{
  const s=setup();await s.policy.configure(true,false);await s.policy.configure(false,false);
  assert.equal(s.reply().result.paused,false);
  s.setFailure(true);await s.policy.configure(true,false);
  assert.equal(s.policy.decorate(s.reply()).result.focus_paused,false);
  s.setFailure(false);await s.policy.configure(true,false);await s.client.request('session.pause');
  s.policy.attach(s.client);await s.policy.configure(true,true);
  assert.equal(s.reply().result.paused,true);
});
test('rapid blur/focus requests settle on the latest state',async()=>{
  const s=setup();await Promise.all([s.policy.configure(true,false),s.policy.configure(true,true),s.policy.configure(true,false),s.policy.configure(true,true)]);
  assert.equal(s.reply().result.paused,false);
});
