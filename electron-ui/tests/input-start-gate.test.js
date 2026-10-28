import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('physical start waits for neutral, ignores drift/other ports/unmapped buttons and retains a short press until latch',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ares-input-start-'));
 try{const binary=path.join(dir,'fixture');execFileSync('c++',['-std=c++17',path.join(import.meta.dirname,'input-start-gate-fixture.cpp'),'-o',binary]);execFileSync(binary);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
