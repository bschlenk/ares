import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('native recording keeps 1800 exact frames, preserves a byte-limit prefix and handles dimensions/load/reset',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ares-recording-spool-'));
 try{const binary=path.join(dir,'fixture');execFileSync('c++',['-std=c++17','-pthread',path.join(import.meta.dirname,'recording-spool-fixture.cpp'),'-o',binary]);const output=execFileSync(binary,{encoding:'utf8',timeout:60000});assert.match(output,/frames=1800 bytes=409536000/);console.log(output.trim());}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
