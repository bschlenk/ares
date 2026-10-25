import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export function buildInfo(){
  try{return JSON.parse(fs.readFileSync(fileURLToPath(new URL('../build-info.json',import.meta.url)),'utf8'));}
  catch{return {build_id:'unavailable',reason:'rebuild_required'};}
}
