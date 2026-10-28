import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyDevSources, discoverDevSources} from '../scripts/dev-sources.js';

test('dev snapshots discover arbitrary source folders and assets while excluding output and dependencies', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-dev-sources-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (file, text = 'source') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), text);
  };
  for (const file of ['future-feature/nested/module.ts', 'future-feature/helper.js', 'assets/cover.png', 'scripts/build.js', 'package.json']) write(file);
  const snapshot = path.join(root, 'artifacts/runs/launch');
  for (const file of ['node_modules/dependency/index.js', 'dist/main.js', 'native/host.hpp', 'bundled-plugins/plugin.js', 'tests/test.js', '.hidden/secret', 'artifacts/runs/launch/recursive.ts']) write(file);
  fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
  const sources = discoverDevSources(root);
  assert.deepEqual([...sources.files].sort(), ['assets/cover.png', 'future-feature/helper.js', 'future-feature/nested/module.ts', 'package.json', 'scripts/build.js']);
  assert.equal(sources.directories.has('future-feature/nested'), true);
  copyDevSources(root, snapshot);
  for (const file of sources.files) assert.equal(fs.readFileSync(path.join(snapshot, file), 'utf8'), 'source');
  for (const directory of ['node_modules', 'dist', 'native', 'tests', 'bundled-plugins', 'artifacts', '.hidden', 'loop']) assert.equal(fs.existsSync(path.join(snapshot, directory)), false);
});
