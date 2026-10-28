import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixtures } from './fixtures/gba.cjs';
const temporary = fs.mkdtempSync('/tmp/ares-settings-ui-');
const profile = path.join(temporary, 'profile');
fs.mkdirSync(profile);
const file = path.join(profile, 'preferences.json');
fs.writeFileSync(file, JSON.stringify({ version: 1, values: {
  'presentation.theme': 'green', 'presentation.scale': 'integer',
  'presentation.scanlines': true, 'presentation.panelLeft': true,
} }));
app.setPath('userData', profile);
delete process.env.ARES_SETTINGS;
Object.assign(process.env, { ARES_PROFILE_DIR: profile, ARES_ROM: '', ARES_AUTOTEST: '', ARES_SILENT: '1', ARES_BACKGROUND_TEST: '1', ARES_DISABLE_PLUGINS: '1', ARES_ENABLE_SERVICES: '0' });
const { sessions } = await import('../dist/main.js');
const until = async check => {
  for (let i = 0; i < 300; i++) {
    try { const result = await check(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('settings UI check timed out');
};
const deadline = setTimeout(() => app.exit(1), 25000);
app.on('will-quit', () => { clearTimeout(deadline); fs.rmSync(temporary, { recursive: true, force: true }); });
app.whenReady().then(async () => {
  try {
    const window = await until(() => BrowserWindow.getAllWindows()[0]);
    const js = code => window.webContents.executeJavaScript(code);
    app.focus({steal:true}); window.show(); window.focus();
    await until(() => js("document.body.dataset.theme === 'green'"));
    await js("document.querySelector('#settings-dialog').showModal()");
    assert.deepEqual(await js(`(() => {
      const field = document.querySelector('[data-setting="presentation.scale"]');
      const number = document.querySelector('[data-setting="audio.volume"] input');
      return [field.querySelector('select'), field.querySelector('button'), number].map(control => getComputedStyle(control).height);
    })()`), ['32px', '32px', '32px'], 'buttons, selects, and number inputs share one control height');
    for(const type of ['mouseDown','mouseUp']) window.webContents.sendInputEvent({type,button:'left',clickCount:1,x:5,y:100});
    await until(()=>js("!document.querySelector('#settings-dialog').open"));

    assert.equal(await js("document.querySelector('[data-setting=\"presentation.scale\"] select').value"), 'integer');
    assert.equal(await js("!!document.querySelector('[data-setting=\"presentation.scanlines\"]')"), false);
    assert.equal(await js("!!document.querySelector('[data-setting=\"presentation.panelLeft\"]')"), false);
    await js("document.querySelector('[data-setting=\"presentation.theme\"] select').value = 'paper'; document.querySelector('[data-setting=\"presentation.theme\"] select').dispatchEvent(new Event('input', {bubbles:true}))");
    await until(() => js("document.body.dataset.theme === 'paper'"));
    assert.equal(JSON.parse(fs.readFileSync(file)).values['presentation.theme'], 'paper');
    assert.equal(await js("localStorage.getItem('ares-workbench')"), null);
    window.webContents.reload();
    await until(() => js("document.body.dataset.theme === 'paper' && !!window.ares"));
    assert.equal(await js("window.ares.preferences.set('presentation.scanlines', false).then(() => false, () => true)"), true, 'removed demo option is unavailable');
    assert.equal(await js("window.ares.preferences.set('presentation.theme', 'bad').then(() => false, () => true)"), true);
    for (const id of ['video.luminance','video.saturation','video.gamma']) {
      assert.deepEqual(await js(`(()=>{const field=document.querySelector('[data-setting="${id}"]');return [...field.querySelectorAll('input')].map(input=>input.type)})()`), ['range','number']);
    }
    await js(`(()=>{const field=document.querySelector('[data-setting="video.luminance"]'),range=field.querySelector('input[type=range]');range.value='1.25';range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>JSON.parse(fs.readFileSync(file)).values['video.luminance']===1.25);
    await until(()=>js(`!document.querySelector('[data-setting="video.luminance"] input[type=number]').disabled`));
    assert.equal(await js(`document.querySelector('[data-setting="video.luminance"] input[type=number]').value`),'1.25');
    await js(`(()=>{const input=document.querySelector('[data-setting="video.luminance"] input[type=number]');input.value='0.85';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>JSON.parse(fs.readFileSync(file)).values['video.luminance']===0.85);
    assert.equal(await js(`document.querySelector('[data-setting="video.luminance"] input[type=range]').value`),'0.85');

    const imported = path.join(temporary, 'imported.bml');
    const original = 'Boot\n  Fast: false\n';
    fs.writeFileSync(imported, original);
    await js(`window.ares.preferences.set('paths.importBml', ${JSON.stringify(imported)})`);
    assert.equal(await js("window.ares.preferences.catalog().then(s => s.entries.find(e => e.descriptor.id === 'paths.importBml').pending)"), true);
    await js("window.ares.command({type: 'synthetic'})");
    await until(() => js("window.ares.preferences.catalog().then(s => !s.entries.find(e => e.descriptor.id === 'paths.importBml').pending)"));
    assert.equal(fs.readFileSync(imported, 'utf8'), original);
    assert.equal(JSON.parse(fs.readFileSync(file)).values['paths.importBml'], imported);

    let clearedInput = 0;
    const observeInput = (_event, command) => { if (command.type === 'clear') clearedInput++; };
    ipcMain.on('command', observeInput);
    const keyboardRow = '[data-setting="input.keyboard.south"]';
    await js(`(() => {
      const row = document.querySelector(${JSON.stringify(keyboardRow)}), input = row.querySelector('input');
      row.querySelector('button').click();
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', bubbles: true, cancelable: true }));
    })()`);
    await until(async () => JSON.parse(fs.readFileSync(file)).values['input.keyboard.south'] === 'KeyN');
    await until(() => clearedInput > 0);
    ipcMain.removeListener('command', observeInput);
    window.webContents.reload();
    await until(() => js(`document.querySelector(${JSON.stringify(keyboardRow)})?.querySelector('input').value === 'KeyN'`));
    assert.equal(await js("[...document.querySelectorAll('.setting-field button')].some(button => button.textContent === 'Save')"), false);
    assert.equal(await js("[...document.querySelectorAll('.setting-reset')].every(button => button.parentElement.className === 'setting-controls')"), true);
    const beforeLive = await sessions.request('session.status');
    await js(`document.querySelector('[data-setting="audio.volume"] input').value = '0.2'; document.querySelector('[data-setting="audio.volume"] input').dispatchEvent(new Event('input', {bubbles:true}))`);
    assert.notEqual(JSON.parse(fs.readFileSync(file)).values['audio.volume'], 0.2, 'number edits wait for the debounce');
    await until(async () => (await sessions.request('runtime.settings')).result?.volume === 0.2);
    assert.equal((await sessions.request('session.status')).session, beforeLive.session);
    assert.equal(JSON.parse(fs.readFileSync(file)).values['audio.volume'], 0.2);
    await sessions.request('execution.batchBegin', undefined, { timeoutMs: 3000 }, 'batch-settings-ui');
    const pendingAudio = await js("window.ares.preferences.set('audio.volume', 0.7)");
    assert.equal(pendingAudio.entries.find(e => e.descriptor.id === 'audio.volume').pending, true);
    assert.match(pendingAudio.error, /Saved.*busy/);
    assert.equal((await sessions.request('runtime.settings')).result.volume, 0.2);
    await js("window.ares.preferences.set('presentation.theme', 'green')");
    assert.equal((await sessions.request('runtime.settings')).result.volume, 0.2, 'unrelated edits never replay pending audio changes');
    await sessions.request('execution.release', undefined, undefined, 'batch-settings-ui');
    await js("window.ares.preferences.set('audio.volume', 0.7)");
    assert.equal((await sessions.request('runtime.settings')).result.volume, 0.7);
    assert.equal((await js("window.ares.preferences.catalog()")).error, undefined);
    window.webContents.reload();
    await until(() => js(`document.querySelector('[data-setting="audio.volume"] input')?.value === '0.7'`));
    const media = path.join(temporary, 'media'); fs.mkdirSync(media);
    const { rom } = fixtures(media);
    const firmwareId = 'firmware.GameBoyAdvance.BIOS.World';
    const rowSelector = `[data-setting="${firmwareId}"]`;
    await until(() => js(`!!document.querySelector(${JSON.stringify(rowSelector)})`));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(media, 'boot.rom')] });
    await js(`window.ares.preferences.chooseFile(${JSON.stringify(firmwareId)})`);
    assert.equal(await js(`window.ares.preferences.catalog().then(s => s.entries.find(e => e.descriptor.id === ${JSON.stringify(firmwareId)}).pending)`), true);
    assert.match(await js(`document.querySelector(${JSON.stringify(rowSelector)}).textContent`), /Saved; applies on next ROM load/);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rom] });
    await js("window.ares.open({system: 'Game Boy Advance'})");
    await until(async () => (await sessions.request('session.status')).result?.system === 'Game Boy Advance');
    await until(() => js(`window.ares.preferences.catalog().then(s => !s.entries.find(e => e.descriptor.id === ${JSON.stringify(firmwareId)}).pending)`));
    assert.equal(JSON.parse(fs.readFileSync(file)).values[firmwareId], path.join(media, 'boot.rom'));
    assert.equal(fs.readFileSync(imported, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(path.join(profile, 'runtime-settings')), [], 'launch snapshots removed after acknowledgement');
    await js(`window.ares.preferences.reset(${JSON.stringify(firmwareId)})`);
    assert.equal(await js(`window.ares.preferences.catalog().then(s => s.entries.find(e => e.descriptor.id === ${JSON.stringify(firmwareId)}).pending)`), true);
    assert.equal((await sessions.request('session.status')).result.system, 'Game Boy Advance', 'changing firmware never restarts a running game');
    console.log('SETTINGS_UI_PASS: provisioned values applied; controls and bridge persist updates; reload retains settings; invalid values rejected; key recording persists and releases input; live audio acknowledged; busy edits saved without replay; firmware picker enables GBA; reset waits for next load; imported BML unchanged');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
