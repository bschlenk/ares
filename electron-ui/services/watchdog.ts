import {spawn,type ChildProcess} from 'node:child_process';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ConnectionInfo} from './local-endpoint.js';

export const WATCHDOG_STALE_MS=2000;
export const healthPath=(info:ConnectionInfo)=>info.endpoint+'.health.json';
/** A private, bounded observation written by an independent process. */
export async function readWatchdog(info:ConnectionInfo):Promise<any|undefined>{
 let handle;
 try{
  handle=await fs.open(healthPath(info),constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await handle.stat();if(!stat.isFile()||stat.size>65536||stat.uid!==process.getuid?.()||(stat.mode&0o077))return;
  const value=JSON.parse(await handle.readFile('utf8'));
  if(value?.protocol!==1||value.connection_instance!==info.instance||!Number.isSafeInteger(value.sampled_ms)||!Number.isSafeInteger(value.sampled_tick_ms)||!Number.isSafeInteger(value.heartbeat_tick_ms)||!Number.isSafeInteger(value.heartbeat_ms)||!value.health||typeof value.health!=='object'||!['listening','disconnected'].includes(value.parent))return;
  const now=Number(process.hrtime.bigint()/1000000n),observerAge=Math.max(0,now-value.sampled_tick_ms),mainAge=Math.max(0,now-value.heartbeat_tick_ms);
  const observer=observerAge>WATCHDOG_STALE_MS?'stale':'responsive';
  const main=value.parent==='disconnected'?'disconnected':observer==='stale'?'unknown':mainAge>WATCHDOG_STALE_MS?'unresponsive':'responsive';
  return {...value.health,observation:'cached',watchdog:{observation:'independent_process',observer,main,observed_at:new Date(value.sampled_ms).toISOString(),heartbeat_at:new Date(value.heartbeat_ms).toISOString(),heartbeat_age_ms:mainAge,observer_age_ms:observerAge,app_pid:value.app_pid,watchdog_pid:value.watchdog_pid,io_errors:Number.isSafeInteger(value.io_errors)?value.io_errors:0}};
 }catch{return undefined;}finally{await handle?.close();}
}
export class MainWatchdog {
 private child?:ChildProcess;private timer?:ReturnType<typeof setInterval>;private sending=false;private file?:string;
 constructor(private snapshot:()=>unknown,private failure:(error:unknown)=>void){}
 async start(info:ConnectionInfo){
  await this.close();this.file=healthPath(info);
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'',NODE_PATH:''};
  const child=spawn(process.execPath,[fileURLToPath(new URL('./watchdog-worker.js',import.meta.url))],{env,stdio:['ignore','ignore','ignore','ipc']});this.child=child;
  child.on('error',error=>{if(this.child===child)this.failure(error);});
  child.on('exit',(code,signal)=>{if(this.child===child){clearInterval(this.timer);this.failure(new Error(`watchdog_exit:${code??signal}`));}});
  const beat=()=>{
   if(this.child!==child||!child.connected||this.sending)return;
   try{
    let health:any;try{health=this.snapshot();}catch(error){this.failure(error);health={snapshot_error:'health_snapshot_failed'};}
    const message={type:'heartbeat',instance:info.instance,file:healthPath(info),app_pid:process.pid,heartbeat_ms:Date.now(),heartbeat_tick_ms:Number(process.hrtime.bigint()/1000000n),health};
    let oversized=false;try{oversized=Buffer.byteLength(JSON.stringify(message))>49152;}catch{oversized=true;}
    if(oversized){this.failure(new Error('watchdog_snapshot_limit'));message.health={instance:typeof health?.instance==='string'?health.instance.slice(0,64):info.instance,observed_at:new Date().toISOString(),logs_directory:typeof health?.logs_directory==='string'?health.logs_directory.slice(0,4096):undefined,native:{observation:'unavailable'},snapshot_truncated:true};}
    this.sending=true;child.send(message,()=>{this.sending=false;});
   }catch(error){this.failure(error);}
  };
  beat();this.timer=setInterval(beat,250);this.timer.unref();
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{reject(new Error('watchdog_start_timeout'));},3000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('watchdog_start_failed'));});});
 }
 async close(){
  clearInterval(this.timer);this.timer=undefined;const child=this.child;this.child=undefined;this.sending=false;if(!child)return;
  await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve();}else if(child.connected)child.send({type:'stop'});});
  if(this.file){await fs.rm(this.file,{force:true});await fs.rm(this.file+'.'+child.pid+'.tmp',{force:true});this.file=undefined;}
 }
}
