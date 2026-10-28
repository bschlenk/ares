import fs from 'node:fs/promises';
import path from 'node:path';
export async function profileHolder(profile:string) {
 const file=path.join(profile,'lock-holder.json');
 try {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)return {metadata:'invalid'};
  const v=JSON.parse(await fs.readFile(file,'utf8'));
  if(!Number.isSafeInteger(v.pid)||v.pid<1||typeof v.started_at!=='string'||typeof v.executable!=='string'||typeof v.service_directory!=='string')return {metadata:'invalid'};
  let exists=true;try{process.kill(v.pid,0);}catch(e){exists=(e as NodeJS.ErrnoException).code!=='ESRCH';}
  return {pid:v.pid,started_at:v.started_at,executable:v.executable.slice(0,4096),service_directory:v.service_directory.slice(0,4096),process_exists:exists,service_directory_exists:await fs.stat(v.service_directory).then(s=>s.isDirectory(),()=>false)};
 }catch{return {metadata:'unavailable'};}
}
