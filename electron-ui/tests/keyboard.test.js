import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundKeyboardCodes, defaultInputSettings, keyboardPolicy} from '../dist/settings/input.js';

test('keyboard consumption follows effective bindings, including axes, alternatives and N64 overrides', () => {
  const settings = {...defaultInputSettings(), 'input.keyboard.south': 'KeyN,KeyM', 'input.keyboard.n64A': 'KeyT', 'input.keyboard.n64B': 'KeyY'};
  const bindings = boundKeyboardCodes(settings, 'Game Boy');
  for (const code of ['KeyN', 'KeyM', 'KeyA', 'ArrowUp']) assert.equal(keyboardPolicy(bindings, {code}).consume, true);
  for (const code of ['KeyZ', 'KeyT', 'KeyY', 'KeyB']) assert.equal(keyboardPolicy(bindings, {code}).consume, false);
  const n64 = boundKeyboardCodes(settings, 'Nintendo 64');
  assert.equal(n64.has('KeyN'), false); assert.equal(n64.has('KeyX'), false);
  assert.equal(n64.has('KeyT'), true); assert.equal(n64.has('KeyY'), true);
});

test('bound modifiers work alone without consuming browser defaults; shortcut chords never become controls', () => {
  const bindings = new Set(['MetaLeft', 'ControlRight', 'AltLeft', 'ShiftLeft', 'KeyN']);
  for (const [code, flag] of [['MetaLeft', 'metaKey'], ['ControlRight', 'ctrlKey'], ['AltLeft', 'altKey'], ['ShiftLeft', 'shiftKey']]) {
    assert.deepEqual(keyboardPolicy(bindings, {code, [flag]: true}), {game: true, consume: false, bound: true, shortcut: false});
  }
  for (const flag of ['metaKey', 'ctrlKey', 'altKey']) {
    assert.deepEqual(keyboardPolicy(bindings, {code: 'KeyN', [flag]: true}), {game: false, consume: false, bound: true, shortcut: true});
    assert.equal(keyboardPolicy(bindings, {code: 'KeyB', [flag]: true}).consume, false);
  }
  assert.equal(keyboardPolicy(bindings, {code: 'KeyN', shiftKey: true}).consume, true, 'Shift remains usable with other game buttons');
  assert.equal(keyboardPolicy(bindings, {code: 'KeyN', defaultPrevented: true}).game, false);
  assert.equal(keyboardPolicy(bindings, {code: 'KeyN', isComposing: true}).game, false);
});
