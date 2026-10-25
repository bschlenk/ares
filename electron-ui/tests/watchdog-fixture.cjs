const {LocalServiceHost}=require('../dist/services/local-endpoint.js');
const {MainWatchdog}=require('../dist/services/watchdog.js');
let watchdog,host;
(async()=>{
 const snapshot=()=>({instance:'watchdog-fixture',observed_at:new Date().toISOString(),native:{connected:false,observation:'cached'},logs_directory:process.argv[2],user_interaction_waits:[],...(process.argv[3]==='oversize'?{padding:'x'.repeat(100000)}:{})});
 host=new LocalServiceHost({request:async()=>({protocol:1,id:'test',session:'watchdog-session',epoch:1,ok:true,result:{system:'Fixture',paused:true,synthetic:true,capabilities:[]}})},async p=>p.operation==='app_status'?{ready:true}:snapshot());
 await host.listen(process.argv[2]);watchdog=new MainWatchdog(snapshot,e=>console.error(e.message));await watchdog.start(host.info);process.send({ready:true,info:host.info,file:host.metadataFile});
 process.on('message',async m=>{
  if(m.action==='stall')process.send({stalling:true},()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,m.ms));
  if(m.action==='stop'){await watchdog.close();await host.close();process.exit(0);}
 });
})().catch(e=>{console.error(e);process.exit(1);});
