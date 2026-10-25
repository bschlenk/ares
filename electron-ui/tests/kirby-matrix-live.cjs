// Explicit private-media integration gate; missing inputs fail rather than skip.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {NativeSessionClient}=require('../dist/services/native-client.js'),{SessionRouter}=require('../dist/services/session-router.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(interpreter){
 const source=process.env.ARES_PLUGIN_TEST_ROM,stateSource=process.env.ARES_PLUGIN_TEST_STATE;assert(source&&stateSource,'Set ARES_PLUGIN_TEST_ROM and ARES_PLUGIN_TEST_STATE');
 const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),before=[hash(source),hash(stateSource)];assert.equal(before[0],'2f579751d7ad2824dfd8a6141570306bfaeda1cff40139ba231c30b8591d681c');
 const dir=fs.mkdtempSync('/tmp/ares-kirby-matrix-'),rom=path.join(dir,'game.z64'),state=path.join(dir,'game.bs'),settings=path.join(dir,'settings.bml');fs.copyFileSync(source,rom);fs.copyFileSync(stateSource,state);fs.writeFileSync(settings,interpreter?'Developer\n  ForceInterpreter: true\n':'');
 const identity={session:randomUUID(),epoch:1},child=spawn(process.env.ARES_HOST||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-host'),['--rom',rom,'--system','Nintendo 64','--settings',settings,'--silent','--paused','--save-dir',path.join(dir,'saves'),'--control-session',identity.session],{stdio:['pipe','pipe','pipe','pipe']});child.stdout.resume();let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-32768));const closed=once(child,'close');
 const native=new NativeSessionClient(child.stdin,child.stdio[3],identity,()=>{}),router=new SessionRouter();router.attach(native);let requests=0;
 const request=async(method,p)=>{++requests;const reply=await router.request(method,undefined,p,'matrix-acceptance');assert(reply.ok,JSON.stringify(reply)+' '+stderr);return reply.result;};
 const pageAll=async()=>{let page=await request('n64.capture.rsp',{generation:null,offset:0,limit:64}),entries=[...page.entries];while(page.next_offset!==null){page=await request('n64.capture.rsp',{generation:page.generation,offset:page.next_offset,limit:64});entries.push(...page.entries);}return {...page,entries};};
 try{
  await request('session.status');if(!interpreter)await request('state.load',{path:state,resume:false,keepOverrides:false});await request('n64.capture.control',{rsp:true,rdp:false});
  const progress=[],generations=new Map(),stacks=new Map(),started=performance.now();
  let vi=0;
  for(let n=0;n<(interpreter?600:8);n++){
   const op=await request('execution.runFrames',{count:1,timeoutMs:10000});let done=false;
   for(let poll=0;poll<2000;poll++){const status=await request('execution.status',{operationId:op.operation_id});if(status.state==='done'){done=true;vi=status.frame;break;}await sleep(5);}assert(done,'bounded VI operation did not finish');
   let stack=await request('n64.capture.matrices',{generation:null,offset:0,limit:8}),states=[...stack.entries];while(stack.next_offset!==null){stack=await request('n64.capture.matrices',{generation:stack.generation,offset:stack.next_offset,limit:8});states.push(...stack.entries);}if(states.length)stacks.set(stack.generation,{...stack,entries:states});
   const page=await pageAll();progress.push({vi:n,generation:page.generation,configured:page.configured,retained:page.retained,committed:page.committed});if(page.entries.length)generations.set(page.generation,page);
   if(vi>=8&&stacks.size>=2&&generations.size>=2&&[...generations.values()].reduce((n,p)=>n+p.entries.filter(e=>e.consumed_matrix?.raw).length,0)>=16)break;
  }
  assert(vi>=8,'both RSP modes must reach eight VIs');
  assert(generations.size>=2,'Actual graphics microcode loads after SP dispatch must be detected: '+JSON.stringify({interpreter,progress,task:await request('n64.rsp.lastTask')}));
  assert(stacks.size>=2,'verified matrix states must be captured in both executors');for(const stack of stacks.values()){const ids=new Set(stack.entries.map(s=>s.id));for(const state of stack.entries){assert.equal(state.profile,'f3dex2_fifo_2_04h');assert.equal(state.provenance,'actual_rsp_state');assert.equal(state.modelview.raw.length,128);}for(const row of generations.get(stack.generation)?.entries||[]){for(const id of [row.matrix_before_id,row.matrix_after_id,...(row.draw_vertices||[]).map(v=>v.transform_state_id)])if(id!=null)assert(ids.has(id),'state reference must resolve within generation');}}
  const matrices=[...generations.values()].flatMap(p=>p.entries.filter(e=>e.consumed_matrix?.raw));assert(matrices.length>=16,'real game matrices must be consumed and frozen');
  for(const row of matrices){assert.equal(row.consumed_matrix.provenance,'consumed_dma_operand_only');assert.equal(row.consumed_matrix.rsp_matrix_stack,null);assert.equal(row.consumed_matrix.dma_count,1);assert.equal(row.consumed_matrix.ambiguous,false);assert.equal(row.consumed_matrix.raw.length,128);assert(row.task_id>0);assert(row.cycle<100000,'reused JIT blocks must not restore compile-time elapsed clocks');}
  const latest=[...generations.values()].at(-1),index=latest.entries.findIndex(e=>e.consumed_matrix?.raw);assert(index>=0);const frozen=latest.entries[index];
  const task=await request('n64.rsp.lastTask',{taskId:frozen.task_id});assert.equal(task.task.classification,'declared_graphics_candidate');assert.equal(task.executor,interpreter?'interpreter':'recompiler');assert(task.task.imem_revisions.length>0);
  const address=frozen.consumed_matrix.dram_address,original=await request('n64.memory.read',{address,view:'rdram',length:64});
  try{
   const replacement=(original.hex.slice(0,2)==='a5'?'5a':'a5').repeat(64);await request('n64.memory.write',{address,view:'rdram',hex:replacement});assert.equal((await request('n64.memory.read',{address,view:'rdram',length:64})).hex,replacement);
   const reread=await request('n64.capture.rsp',{generation:latest.generation,offset:index,limit:1});assert.deepEqual(reread.entries[0],frozen,'later RDRAM rewrites must not change retained consumed data');
  }finally{await request('n64.memory.write',{address,view:'rdram',hex:original.hex});}
  const summary={result:'KIRBY_MATRIX_CONSUMPTION_PASS',epoch:latest.epoch,end_vi:vi,generations:[...generations.keys()],matrices:matrices.length,task_id:frozen.task_id,rsp_executor:task.executor,start:interpreter?'power_on':'provided_state',cpu_executor:task.cpu_executor,wall_ms:performance.now()-started,transport_requests:requests,truncated_generations:[...generations.values()].filter(p=>p.truncated).length,matrix_states:[...stacks.values()].reduce((n,p)=>n+p.entries.length,0),scope:'verified_f3dex2_2_04h_actual_rsp_state',original_media_unchanged:true};
  await request('session.reset');const reset=await request('n64.capture.rsp',{generation:null,offset:0,limit:64});assert.equal(reset.retained,0);assert.equal((await request('n64.capture.matrices',{generation:null,offset:0,limit:4})).retained,0);assert.deepEqual([hash(source),hash(stateSource)],before);
  console.log(JSON.stringify(summary));return summary;
 }finally{router.detach();child.stdin.end('quit\n');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{const runs=[];for(const interpreter of [false,true])runs.push(await run(interpreter));const out=path.resolve(__dirname,'../artifacts/kirby-matrix-acceptance.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({result:'KIRBY_MATRIX_BOTH_EXECUTORS_PASS',runs},null,2)+'\n');console.log('KIRBY_MATRIX_BOTH_EXECUTORS_PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
