import {app, BrowserWindow, ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const temporary = fs.mkdtempSync('/tmp/ares-keyboard-ui-');
app.setPath('userData', temporary);
Object.assign(process.env, {ARES_PROFILE_DIR: temporary, ARES_ROM: '', ARES_AUTOTEST: '', ARES_SILENT: '1', ARES_BACKGROUND_TEST: '1', ARES_DISABLE_PLUGINS: '1'});
process.argv.push('--no-services');
const commands = [];
ipcMain.on('command', (_event, command) => commands.push(command));
await import('../dist/main.js');
const until = async check => { for (let i = 0; i < 300; ++i) { try { const result = await check(); if (result) return result; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Keyboard UI timed out'); };
const deadline = setTimeout(() => app.exit(1), 20000);
app.on('will-quit', () => { clearTimeout(deadline); fs.rmSync(temporary, {recursive: true, force: true}); });
app.whenReady().then(async () => {
  try {
    const window = await until(() => BrowserWindow.getAllWindows()[0]);
    const js = code => window.webContents.executeJavaScript(code);
    await until(() => js("typeof window.stats === 'function'"));
    await js("window.ares.preferences.set('input.keyboard.south','KeyN')");
    await js("window.ares.preferences.set('input.keyboard.east','MetaLeft')");
    await until(() => js("document.querySelector('#settings-dialog').open"));
    await js("document.querySelector('#close-settings').click();Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});document.querySelector('#screen').focus()");
    async function key(type, code, flags = {}) {
      const prevented = await js(`(() => { const e = new KeyboardEvent(${JSON.stringify(type)}, {code:${JSON.stringify(code)},bubbles:true,cancelable:true,...${JSON.stringify(flags)}});document.activeElement.dispatchEvent(e);return e.defaultPrevented; })()`);
      await new Promise(resolve => setImmediate(resolve));
      return prevented;
    }
    commands.length = 0;
    assert.equal(await key('keydown', 'KeyZ'), false, 'unbound key keeps its default');
    assert.equal(await key('keyup', 'KeyZ'), false);
    assert.ok(commands.some(c => c.type === 'key' && c.name === 'Z' && c.value), 'ordinary keys still reach computer cores');
    commands.length = 0;
    assert.equal(await key('keydown', 'KeyN'), true);
    assert.equal(await key('keydown', 'KeyN', {repeat:true}), true);
    assert.equal(await key('keyup', 'KeyN'), true);
    assert.equal(commands.filter(c => c.type === 'key' && c.name === 'N' && c.value).length, 1);
    assert.ok(commands.some(c => c.type === 'input' && c.mask & (1 << 4)));
    assert.ok(commands.some(c => c.type === 'input' && c.mask === 0));
    commands.length = 0;
    assert.equal(await key('keydown', 'MetaLeft', {metaKey:true}), false, 'bound Command alone is allowed');
    assert.ok(commands.some(c => c.type === 'input' && c.mask & (1 << 5)));
    commands.length = 0;
    assert.equal(await key('keydown', 'KeyN', {metaKey:true}), false, 'Command + bound key keeps its shortcut');
    assert.equal(await key('keyup', 'KeyN', {metaKey:true}), false);
    assert.equal(await key('keyup', 'MetaLeft'), false);
    assert.ok(commands.some(c => c.type === 'clear'), 'chord releases the previously bound modifier');
    assert.equal(commands.some(c => c.type === 'key' && c.name === 'N' && c.value), false, 'shortcut does not press a game key');
    for (const flags of [{ctrlKey:true}, {altKey:true}, {isComposing:true}]) {
      assert.equal(await key('keydown', 'KeyN', flags), false);
      await key('keyup', 'KeyN', flags);
    }
    assert.equal(await key('keydown', 'ShiftLeft', {shiftKey:true}), false);
    assert.equal(await key('keydown', 'KeyN', {shiftKey:true}), true, 'Shift + a game button remains playable');
    await key('keyup', 'KeyN'); await key('keyup', 'ShiftLeft');
    commands.length = 0;
    await key('keydown', 'MetaLeft', {metaKey:true});
    await key('keydown', 'KeyP', {metaKey:true});
    assert.ok(commands.some(c => c.type === 'clear'), 'application shortcuts release bound modifiers too');
    await key('keyup', 'MetaLeft');
    await js("document.querySelector('#screen').blur()");commands.length=0;
    assert.equal(await key('keydown','KeyN'),true,'body focus still sends gameplay controls');await key('keyup','KeyN');
    assert.ok(commands.some(c=>c.type==='input' && c.mask & (1<<4)));
    await js("window.nativeFixture=document.createElement('div');window.nativeFixture.innerHTML='<button>Action</button><input type=range><input type=text><select><option>Choice</option></select>';document.body.append(window.nativeFixture);window.nativeFixture.querySelector('button').focus()");
    commands.length=0;assert.equal(await key('keydown','Enter'),false,'button activation has priority');await key('keyup','Enter');
    assert.equal(commands.some(c=>c.type==='key'&&c.value),false);
    assert.equal(await key('keydown','KeyN'),true,'unhandled button keys reach gameplay');await key('keyup','KeyN');
    await js("window.nativeFixture.querySelector('input[type=range]').focus()");commands.length=0;
    assert.equal(await key('keydown','ArrowRight'),false,'slider arrow keys stay native');await key('keyup','ArrowRight');
    assert.equal(commands.some(c=>c.type==='key'&&c.value),false);
    assert.equal(await key('keydown','KeyN'),true,'unhandled slider keys reach gameplay');await key('keyup','KeyN');
    for(const selector of ['input[type=text]','select']) {
      await js(`window.nativeFixture.querySelector(${JSON.stringify(selector)}).focus()`);commands.length=0;
      assert.equal(await key('keydown','KeyN'),false,'native editor keys stay native');await key('keyup','KeyN');
      assert.equal(commands.some(c=>c.type==='key'&&c.value),false);
    }
    await js('window.nativeFixture.remove()');
    await js("document.querySelector('#settings-dialog').showModal();document.querySelector('[data-setting=\"input.keyboard.south\"] input').focus()");
    assert.equal(await key('keydown', 'KeyN'), false, 'text fields do not capture gameplay input');
    console.log('PASS binding-aware keyboard defaults, modifier controls, shortcut chords, key releases and text focus');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
