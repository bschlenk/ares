import manifest from '../package.json' with {type: 'json'};
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const files=[];
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,e.name);if(['node_modules','dist','artifacts','.git'].includes(e.name))continue;if(e.isDirectory())walk(p);else if(/\.(ts|cts|cpp|hpp|js|cjs|json|css|html|png|icns)$/.test(p))files.push(p);}}
walk('');const hash=createHash('sha256');for(const p of files.sort()){hash.update(p);hash.update(fs.readFileSync(path.join(root,p)));}
const source_sha256=hash.digest('hex');const schema=createHash('sha256');for(const p of files.filter(p=>p.startsWith('services/')&&/contracts\.ts$/.test(p)).sort()){schema.update(p);schema.update(fs.readFileSync(path.join(root,p)));}const schema_id=schema.digest('hex');const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(root,'dist/build-info.json'),JSON.stringify({schema_id,build_id:source_sha256.slice(0,16),source_sha256,commit,built_at:new Date().toISOString(),version:manifest.version,node:process.version},null,2)+'\n');
