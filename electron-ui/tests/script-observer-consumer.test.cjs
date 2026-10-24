const {test}=require('node:test');const assert=require('node:assert/strict');
test('plugin observers coalesce updates while an async panel callback is pending',async()=>{
 const saved={document:global.document,window:global.window,setInterval:global.setInterval,clearInterval:global.clearInterval};
 let tick,frame=1,reads=0,stops=0,cleared=false,release;
 global.document={createDocumentFragment:()=>({})};
 global.setInterval=fn=>{tick=fn;return 1};global.clearInterval=()=>{cleared=true};
 global.window={ares:{plugins:{request:async(token,method)=>({ok:true,result:method==='scripts.observe'?{observer_id:1}:method==='script.observerRead'?(reads++,{bytes:1,frame,hex:Buffer.from(JSON.stringify(frame)).toString('hex'),logs:[],error:''}):(stops++,{stopped:true})}),log:async()=>{}}}};
 let scope;
 try{
  const {PluginScope}=require('../dist/browser/plugins/scope.js');
  scope=new PluginScope({manifest:{id:'observer',contributes:{panels:[],commands:[]}},lease:{token:'token',identity:{session:'test',epoch:1},system:'Synthetic',game:null,profile:null}}, {}, {commands:{append(){}},changed(){},error(e){throw e}});scope.publish();
  const hold=new Promise(resolve=>release=resolve),delivered=[];
  const stop=await scope.context.scripts.observe({source:'export default()=>1',args:{},timeoutMs:1000,maxFrames:0},async value=>{delivered.push(value);await hold});
  const first=tick();for(let i=0;!delivered.length&&i<20;i++)await Promise.resolve();assert.deepEqual(delivered,[1]);
  frame=20;await tick();frame=40;await tick();assert.equal(reads,1);
  release();await first;frame=99;await tick();assert.deepEqual(delivered,[1,99]);
  await stop();assert.equal(stops,1);assert.equal(cleared,true);
 }finally{release?.();await scope?.dispose();Object.assign(global,saved)}
});
