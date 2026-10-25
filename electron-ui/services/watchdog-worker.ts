// No Electron/main imports: health observations keep advancing during a main stall.
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
let lastJournal='',ioErrors=0;
async function journal(status:string){
 if(status===lastJournal)return;lastJournal=status;
 const directory=state.health.logs_directory;if(typeof directory!=='string'||!path.isAbsolute(directory))return;
 const file=path.join(directory,'watchdog.jsonl');let handle;
 try{
  const st=await fs.lstat(file).catch(()=>undefined);if(st&&(!st.isFile()||(st.mode&0o077)))throw Error('invalid_watchdog_log');
  if(st&&st.size>=65536){await fs.rm(file+'.1',{force:true});await fs.rename(file,file+'.1');}
  handle=await fs.open(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);const current=await handle.stat();if(!current.isFile()||(current.mode&0o077))throw Error('invalid_watchdog_log');
  await handle.writeFile(JSON.stringify({timestamp:new Date().toISOString(),source:'watchdog',severity:status==='unresponsive'?'error':'info',event:status,instance:state.instance,app_pid:state.app_pid})+'\n');
 }catch{++ioErrors;}finally{await handle?.close();}
}
let state:any,parent:'listening'|'disconnected'='listening',writing=false,stopping=false;
async function publish(){
 if(!state||writing||stopping)return;writing=true;
 const temporary=state.file+'.'+process.pid+'.tmp';
 try{
  await journal(parent==='disconnected'?'disconnected':Number(process.hrtime.bigint()/1000000n)-state.heartbeat_tick_ms>2000?'unresponsive':'responsive');
  const value={io_errors:ioErrors,protocol:1,connection_instance:state.instance,app_pid:state.app_pid,watchdog_pid:process.pid,sampled_ms:Date.now(),sampled_tick_ms:Number(process.hrtime.bigint()/1000000n),heartbeat_ms:state.heartbeat_ms,heartbeat_tick_ms:state.heartbeat_tick_ms,parent,health:state.health};
  const json=JSON.stringify(value);if(Buffer.byteLength(json)>65536)return;
  await fs.writeFile(temporary,json,{mode:0o600,flag:'wx'});await fs.rename(temporary,state.file);
 }catch{}finally{await fs.rm(temporary,{force:true}).catch(()=>{});writing=false;}
}
process.on('message',async(message:any)=>{
 if(message?.type==='stop'){stopping=true;clearInterval(timer);setTimeout(()=>process.exit(0),1000);while(writing)await new Promise(r=>setTimeout(r,5));if(state)await fs.rm(state.file,{force:true}).catch(()=>{});process.exit(0);}
 if(message?.type!=='heartbeat'||typeof message.instance!=='string'||!/^[a-f0-9-]{36}$/.test(message.instance)||typeof message.file!=='string'||!path.isAbsolute(message.file)||path.basename(message.file)!==message.instance+'.sock.health.json'||!Number.isSafeInteger(message.heartbeat_tick_ms)||!Number.isSafeInteger(message.heartbeat_ms)||!Number.isSafeInteger(message.app_pid)||message.app_pid!==process.ppid||!message.health||Buffer.byteLength(JSON.stringify(message))>49152)return;
 if(state&&(state.instance!==message.instance||state.file!==message.file))return;
 const first=!state;state=message;await publish();if(first&&process.connected)process.send?.({ready:true});
});
process.on('disconnect',async()=>{parent='disconnected';clearInterval(timer);setTimeout(()=>process.exit(0),1000);while(writing)await new Promise(r=>setTimeout(r,5));await publish();process.exit(0);});
const timer=setInterval(()=>{void publish();},250);
// Parent must initialize promptly; an abandoned worker is never left resident.
setTimeout(()=>{if(!state)process.exit(1);},3000).unref();
