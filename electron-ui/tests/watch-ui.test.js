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
    for (const sub of ['plugins', 'services', 'settings', 'workspace', 'dist/browser']) fs.mkdirSync(path.join(directory, sub), { recursive: true })
    write(directory, 'tsconfig.browser.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', types: [], skipLibCheck: true }, include: ['renderer.ts'] }))
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
  } finally {
    stop()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
