import fs from 'node:fs/promises';
import path from 'node:path';
import {managementRoot} from '../sessions/context.js';
async function holder(file:string) {
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw new Error('invalid_holder');
 const v=JSON.parse(await fs.readFile(file,'utf8'));
 if(!Number.isSafeInteger(v.pid)||v.pid<1||typeof v.started_at!=='string'||typeof v.executable!=='string'||typeof v.service_directory!=='string')throw new Error('invalid_holder');
 let exists=true;try{process.kill(v.pid,0);}catch(e){exists=(e as NodeJS.ErrnoException).code!=='ESRCH';}
 return {pid:v.pid,instance:v.instance,kind:v.kind,started_at:v.started_at,executable:v.executable.slice(0,4096),service_directory:v.service_directory.slice(0,4096),process_exists:exists,service_directory_exists:await fs.stat(v.service_directory).then(s=>s.isDirectory(),()=>false)};
}
/** Diagnostics only. Kernel descriptors, never these records, establish ownership. */
export async function profileHolder(profile:string) {
 try {
  const instances=path.join(managementRoot(profile),'instances');
  const holders=(await Promise.all((await fs.readdir(instances)).map(id=>holder(path.join(instances,id,'lock-holder.json')).catch(()=>undefined))))
   .filter((v):v is NonNullable<typeof v>=>!!v&&v.process_exists&&v.kind==='personal')
   .sort((a,b)=>a.started_at.localeCompare(b.started_at));
  if(holders.length)return {...holders[0],holders};
 }catch{}
 try{return await holder(path.join(profile,'lock-holder.json'));}catch{return {metadata:'unavailable'};}
}
