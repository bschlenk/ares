import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('disk spool retains 1800 ordered frames with bounded producer storage and cleans up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-spool-'));
  try {
    const binary = path.join(dir, 'fixture');
    execFileSync('c++', ['-std=c++17', '-pthread', path.join(import.meta.dirname, 'frame-spool-fixture.cpp'), '-o', binary]);
    assert.match(execFileSync(binary, {encoding:'utf8', timeout:60000}), /FRAME_SPOOL_PASS/);
  } finally {fs.rmSync(dir, {recursive:true, force:true});}
});
