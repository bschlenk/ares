'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('native script microtasks survive time-slice expiry while promise storms stay bounded across yields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-script-jobs-'));
  try {
    const binary = path.join(directory, 'fixture');
    execFileSync('c++', ['-std=c++17', path.join(__dirname, 'script-job-queue-fixture.cpp'), '-o', binary]);
    assert.match(execFileSync(binary, { encoding: 'utf8' }), /SCRIPT_JOB_QUEUE_PASS/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
