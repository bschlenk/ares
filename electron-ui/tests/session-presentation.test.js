import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatWindowTitle} from '../dist/sessions/presentation.js';
test('one title format keeps persistent identity in empty and loaded windows',()=>{
  assert.equal(formatWindowTitle(),'ares');
  assert.equal(formatWindowTitle('work'),'work — ares');
  assert.equal(formatWindowTitle('work','fixture'),'work — fixture — ares');
  assert.equal(formatWindowTitle(undefined,'fixture'),'fixture — ares');
});
