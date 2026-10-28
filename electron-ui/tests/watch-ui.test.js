import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {watchUI} from '../scripts/watch-ui.js';

test('UI watcher publishes successful builds, preserves failed output, and recovers', { timeout: 20000 }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-watch-ui-'))
  const root = path.join(temporary, 'source'), snapshot = path.join(temporary, 'launch')
  const write = (directory, file, text) => fs.writeFileSync(path.join(directory, file), text)
  for (const directory of [root, snapshot]) {
    fs.mkdirSync(directory)
    fs.mkdirSync(path.join(directory, 'dist/browser'), { recursive: true })
    write(directory, 'tsconfig.browser.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', rootDir: '.', types: [], skipLibCheck: true }, include: ['renderer.ts'] }))
    write(directory, 'renderer.ts', 'export const version = 0;')
    write(directory, 'style.css', 'body { color: red; }')
  }
  write(snapshot, 'dist/browser/renderer.js', 'original')
  let reloads = 0
  const stop = watchUI(root, snapshot, () => reloads++)
  const until = async check => {
    for (let i = 0; i < 300; i++) {
      if (check()) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Watcher did not publish the expected change')
  }
  try {
    write(root, 'renderer.ts', 'export const version = 1;')
    await until(() => reloads === 1)
    assert.match(fs.readFileSync(path.join(snapshot, 'dist/browser/renderer.js'), 'utf8'), /version = 1/)
    write(root, 'renderer.ts', 'export const version: number = "invalid";')
    write(root, 'style.css', 'body { color: blue; }')
    await new Promise(resolve => setTimeout(resolve, 1500))
    assert.equal(reloads, 1)
    assert.equal(fs.readFileSync(path.join(snapshot, 'style.css'), 'utf8'), 'body { color: red; }')
    write(root, 'renderer.ts', 'export const version = 2;')
    await until(() => reloads === 2)
    assert.equal(fs.readFileSync(path.join(snapshot, 'style.css'), 'utf8'), 'body { color: blue; }')
    write(root, 'style.css', 'body { color: green; }')
    await until(() => reloads === 3)
    assert.equal(fs.readFileSync(path.join(snapshot, 'style.css'), 'utf8'), 'body { color: green; }')
    fs.mkdirSync(path.join(root, 'new-feature/nested'), { recursive: true })
    write(root, 'new-feature/nested/contracts.ts', 'export const featureVersion = 1;')
    write(root, 'renderer.ts', "export { featureVersion } from './new-feature/nested/contracts.js';")
    await until(() => reloads >= 4 && fs.existsSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js')))
    assert.match(fs.readFileSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js'), 'utf8'), /featureVersion = 1/)
    write(root, 'new-feature/nested/contracts.ts', 'export const featureVersion = 2;')
    await until(() => reloads >= 5 && fs.readFileSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js'), 'utf8').includes('featureVersion = 2'))
    assert.match(fs.readFileSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js'), 'utf8'), /featureVersion = 2/)
    write(root, 'renderer.ts', 'export const version = 3;')
    fs.rmSync(path.join(root, 'new-feature'), { recursive: true })
    await until(() => reloads >= 6 && !fs.existsSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js')))
    assert.equal(fs.existsSync(path.join(snapshot, 'dist/browser/new-feature/nested/contracts.js')), false)
  } finally {
    stop()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('host dependency and preload edits stage successful builds and restart; failures preserve the app', {timeout:30000}, async () => {
  const {compiler} = await import('../scripts/dev-build.js');
  const {copyDevSources} = await import('../scripts/dev-sources.js');
  const {execFileSync} = await import('node:child_process');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-watch-host-'));
  const root = path.join(temporary,'source'), snapshot = path.join(temporary,'launch');
  const write = (file,text) => {fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);};
  const options = {target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',rootDir:'.',outDir:'dist',types:[],skipLibCheck:true};
  write('package.json','{"type":"module"}');
  write('tsconfig.json',JSON.stringify({compilerOptions:options,include:['host.ts']}));
  write('tsconfig.preload.json',JSON.stringify({compilerOptions:options,include:['preload.ts']}));
  write('tsconfig.browser.json',JSON.stringify({compilerOptions:{...options,module:'ES2022',moduleResolution:'Bundler',outDir:'dist/browser'},include:['renderer.ts']}));
  write('host.ts',"export {version} from './new-library/deep/service.js';");
  write('new-library/deep/service.ts','export const version = 1;');
  write('preload.ts','export const preloadVersion = 1;');
  write('renderer.ts','export const uiVersion = 1;');
  write('style.css','body {color:red}');
  write('scripts/build.js',`import {execFileSync} from 'node:child_process';for(const config of ['tsconfig.json','tsconfig.preload.json','tsconfig.browser.json'])execFileSync(process.execPath,[${JSON.stringify(compiler)},'-p',config,'--noEmitOnError'],{stdio:'inherit'});`);
  copyDevSources(root,snapshot);
  execFileSync(process.execPath,['scripts/build.js'],{cwd:snapshot,stdio:'pipe'});
  let reloads = 0, restarts = 0;
  const stop = watchUI(root,snapshot,()=>reloads++,{restart:async publish=>{publish();restarts++;}});
  const until = async check => {for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Host watcher timed out');};
  try {
    write('new-library/deep/service.ts','export const version = 2;');
    await until(()=>restarts===1);
    assert.match(fs.readFileSync(path.join(snapshot,'dist/new-library/deep/service.js'),'utf8'),/version = 2/);
    write('new-library/deep/service.ts','export const version: number = "bad";');
    await new Promise(r=>setTimeout(r,1000));
    assert.equal(restarts,1);
    assert.match(fs.readFileSync(path.join(snapshot,'dist/new-library/deep/service.js'),'utf8'),/version = 2/);
    write('style.css','body {color:blue}');
    await new Promise(r=>setTimeout(r,700));
    assert.equal(restarts,1);assert.equal(fs.readFileSync(path.join(snapshot,'style.css'),'utf8'),'body {color:red}');
    write('new-library/deep/service.ts','export const version = 3;');
    await until(()=>restarts===2);
    assert.equal(fs.readFileSync(path.join(snapshot,'style.css'),'utf8'),'body {color:blue}');
    write('preload.ts','export const preloadVersion = 2;');
    await until(()=>restarts===3);
    assert.match(fs.readFileSync(path.join(snapshot,'dist/preload.js'),'utf8'),/preloadVersion = 2/);
    write('renderer.ts','export const uiVersion = 2;');
    await until(()=>reloads===1);assert.equal(restarts,3);
  } finally {stop();fs.rmSync(temporary,{recursive:true,force:true});}
});
