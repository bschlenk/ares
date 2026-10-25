import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Freeze provenance when this process loads. A rebuild can replace files while an
// old MCP adapter is alive; rereading would falsely advertise the new schema.
const provenance=(()=>{
  try{return Object.freeze(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../build-info.json',import.meta.url)),'utf8')));}
  catch{return Object.freeze({build_id:'unavailable',reason:'rebuild_required'});}
})();
export function buildInfo(){return provenance;}
