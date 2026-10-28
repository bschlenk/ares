import { app, BrowserWindow, dialog, Menu, shell, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeFixture } from '../fixture.cjs';
import { makeZip } from './fixtures/zip.js';
const temporary = fs.mkdtempSync('/tmp/ares-library-ui-'), profile = path.join(temporary, 'profile'), roms = path.join(temporary, 'roms');
fs.mkdirSync(profile); fs.mkdirSync(roms);
for (const file of ['Alpha (USA).gba', 'Gamma.nes']) fs.writeFileSync(path.join(roms, file), 'fixture');
fs.writeFileSync(path.join(roms, 'Beta.zip'), makeZip([['notes.txt', 'Original test ROM'], ['nested/Beta.gb', makeFixture()]]));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(roms, 'Alpha (USA).box.png'), png);
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ version: 1, values: { 'library.directory': roms, 'library.downloadArtwork': false } }));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, root:{id:'video',panel:'video'}, floating:[{id:'old-library',panel:'plugin:ares.library:browser',mode:'popup',open:true,x:60,y:60,width:380,height:400,shortcut:'Mod+Shift+Digit1',interactive:true}]}));
app.setPath('userData', profile);
Object.assign(process.env, { ARES_PROFILE_DIR: profile, ARES_ROM: '', ARES_AUTOTEST: '', ARES_SILENT: '1', ARES_BACKGROUND_TEST: '1', ARES_ENABLE_SERVICES: '0' });
delete process.env.ARES_DISABLE_PLUGINS; delete process.env.ARES_DEFAULT_PLUGINS; delete process.env.ARES_PLUGIN_DIRS;
const { plugins, sessions } = await import('../dist/main.js');
const until = async check => { for (let i = 0; i < 400; i++) { try { const result = await check(); if (result) return result; } catch {} await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Library UI timed out'); };
const deadline = setTimeout(() => app.exit(1), 30000);
app.on('will-quit', () => { clearTimeout(deadline); fs.rmSync(temporary, { recursive: true, force: true }); });
app.whenReady().then(async () => {
  try {
    const window = await until(() => BrowserWindow.getAllWindows()[0]), js = code => window.webContents.executeJavaScript(code);
    window.show(); window.focus();
    await until(() => js('document.hasFocus()'));
    window.webContents.on('console-message', (_e, _level, message) => console.error('renderer:', message));
    await until(() => plugins.catalog().plugins.find(p => p.manifest?.id === 'ares.library' && p.phase === 'active'));
    await until(() => js("!!document.querySelector('[data-plugin-command=\"ares.library:open\"]')"));
    await js(`window.folderFlashed=false;window.scanHintShown=false;window.firstOpenObserver=new MutationObserver(()=>{const folder=document.querySelector('.rom-library [data-folder]');if(folder&&!folder.hidden)window.folderFlashed=true;if(document.querySelector('.rom-status')?.textContent.includes('Scanning'))window.scanHintShown=true;});window.firstOpenObserver.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});`);
    await js("document.querySelector('#open').click()");
    await until(() => js("document.querySelectorAll('.rom-card').length === 3"));
    assert.equal(await js("document.querySelector('.plugin-modal').matches(':modal')"), true);
    assert.deepEqual(await js("window.firstOpenObserver.disconnect();({folderFlashed:window.folderFlashed,scanHintShown:window.scanHintShown})"), {folderFlashed:false,scanHintShown:false}, 'first open never flashes setup or scanning text for a configured folder');

    assert.equal(await js("document.activeElement.matches('input[type=search]')"), true);
    assert.equal(await js("document.querySelector('.plugin-modal-content').hasAttribute('tabindex')"), false);
    await js("document.querySelector('#screen').focus()");
    assert.equal(await js("document.activeElement.matches('input[type=search]')"), true, 'background canvas is inert');
    for (const type of ['mouseDown','mouseUp']) window.webContents.sendInputEvent({type,button:'left',clickCount:1,x:5,y:100});
    await until(()=>js("!document.querySelector('.plugin-modal[open]')"));
    await js("document.querySelector('#open').click()");
    await until(()=>js("!!document.querySelector('.plugin-modal[open]')"));
    await until(() => js("!!document.querySelector('.rom-card img[src^=\"data:image/png\"]')"));
    await js("window.libraryCover = document.querySelector('.rom-card img[src]'); window.librarySource = window.libraryCover.src");
    await js("window.coverMutations=[];window.coverObserver=new MutationObserver(records=>window.coverMutations.push(...records.map(r=>r.attributeName)));window.coverObserver.observe(window.libraryCover,{attributes:true,attributeFilter:['src','hidden']})");
    const openMenu = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items ?? []).find(item => item.accelerator === 'CmdOrCtrl+O');
    for (let i = 0; i < 3; i++) {
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true,cancelable:true}))");
      await until(() => js("!document.querySelector('.plugin-modal[open]')"));
      if (i === 0) await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'o',code:'KeyO',metaKey:true,bubbles:true,cancelable:true}))");
      else if (i === 1) {
        const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
        window.webContents.sendInputEvent({type:'keyDown', keyCode:'O', modifiers});
        window.webContents.sendInputEvent({type:'keyUp', keyCode:'O', modifiers});
      } else openMenu.click();
      await until(() => js("!!document.querySelector('.plugin-modal[open]')"));
      assert.equal(await js("document.activeElement.matches('input[type=search]')"), true, 'reopened browser focuses search');
      await until(() => js("!document.querySelector('.plugin-modal [data-refresh]').disabled"));
      assert.equal(await js("window.libraryCover === document.querySelector('.rom-card img[src]') && !window.libraryCover.hidden && window.libraryCover.src === window.librarySource"), true, 'refresh retains the same visible image');
    }
    assert.equal(await js('window.coverMutations.length'), 0, 'reopening and refreshing do not reset the visible image');
    assert.equal(await js("!!document.querySelector('.floating-panel')"), false, 'old window placement is removed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'workspace.json'))).floating.length, 0);
    fs.copyFileSync(path.resolve(import.meta.dirname, '../assets/app-icon.png'), path.join(roms, 'Alpha (USA).box.png'));
    assert.equal(await js("document.querySelector('.plugin-modal [data-refresh]').click(); !window.libraryCover.hidden && window.libraryCover.src===window.librarySource"), true, 'refresh keeps the old art visible while loading');
    await until(() => js('window.libraryCover.src !== window.librarySource'));
    assert.equal(await js("window.libraryCover === document.querySelector('.rom-card img[src]') && !window.libraryCover.hidden"), true, 'decoded replacement swaps into the same element');
    assert.equal(await js("window.coverMutations.includes('hidden')"), false, 'replacement never hides the old art');
    for (const [key, expected] of [['ArrowRight','Beta'], ['ArrowLeft','Alpha'], ['ArrowDown','Beta'], ['ArrowUp','Alpha']]) {
      await js(`document.querySelector('.plugin-modal > header button').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
      assert.ok((await js("document.querySelector('.rom-card.selected').textContent")).includes(expected), 'arrows navigate even from the host modal header');
      assert.equal(await js("document.activeElement===document.querySelector('.rom-card.selected')"), true, 'arrow navigation focuses the selected ROM');
    }
    await js("document.querySelectorAll('.rom-card')[2].focus()");
    assert.equal(await js("document.activeElement===document.querySelector('.rom-card.selected') && document.querySelectorAll('.rom-card[tabindex=\"0\"]').length===1"), true, 'focusing a ROM selects it and leaves one tab stop');
    const tab = async (reverse = false) => {
      const modifiers = reverse ? ['shift'] : [];
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers});
      await until(() => js("document.activeElement===document.querySelector('.rom-card.selected')"));
    };
    await js("document.querySelector('[data-view-control] input:checked').focus()");
    for (const [keyCode, view] of [['Right','grid'],['Left','flow']]) {
      window.webContents.sendInputEvent({type:'keyDown',keyCode});
      window.webContents.sendInputEvent({type:'keyUp',keyCode});
      await until(() => js(`document.querySelector('.rom-covers').dataset.view===${JSON.stringify(view)}`));
      assert.equal(await js("document.activeElement.matches('[data-view-control] input:checked')"), true, 'native radio arrows move view focus');
      assert.equal(await js("document.querySelector('.rom-card.selected')===document.querySelectorAll('.rom-card')[2]"), true, 'view radio arrows do not move the game selection');
    }
    await tab();
    assert.equal(await js("document.activeElement===document.querySelectorAll('.rom-card')[2]"), true, 'Tab enters on the selected ROM');
    assert.deepEqual(await js("({width:getComputedStyle(document.activeElement).outlineWidth,offset:getComputedStyle(document.activeElement).outlineOffset})"), {width:'1px',offset:'1px'});
    await js("document.querySelector('dialog[open] > header button').focus()");
    await tab(true);
    assert.equal(await js("document.activeElement===document.querySelectorAll('.rom-card')[2]"), true, 'Shift+Tab also enters on the selected ROM');
    const popup = Menu.prototype.popup, reveal = shell.showItemInFolder, writeClipboard = clipboard.writeText;
    let contextMenu, revealed, copied;
    try {
      Menu.prototype.popup = function(options) { contextMenu = this; options.callback?.(); };
      shell.showItemInFolder = file => { revealed = file; };
      clipboard.writeText = text => { copied = text; };
      await js("document.querySelectorAll('.rom-card')[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
      await until(() => contextMenu);
      assert.deepEqual(contextMenu.items.map(item=>item.label), [process.platform==='darwin'?'Reveal in Finder':'Reveal in folder','Copy absolute path']);
      contextMenu.items[0].click(); contextMenu.items[1].click();
      const archive = fs.realpathSync(path.join(roms,'Beta.zip'));
      assert.equal(revealed, archive); assert.equal(copied, archive);
      assert.equal(await js("getComputedStyle(document.querySelector('.rom-card')).cursor"), 'default');
    } finally { Menu.prototype.popup = popup; shell.showItemInFolder = reveal; clipboard.writeText = writeClipboard; }
    await js("document.querySelectorAll('.rom-card')[0].focus()");
    for (const selector of ['.rom-toolbar input', '[data-system]', '[data-sort]']) {
      assert.equal(await js(`(() => { const target=document.querySelector(${JSON.stringify(selector)});target.focus();const event=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});target.dispatchEvent(event);return event.defaultPrevented; })()`), false, 'native arrow controls keep their behavior');
    }
    await js("window.savedScrollIntoView=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){window.navigationScroll=options;return window.savedScrollIntoView.call(this,options)};void 0");
    await js("document.querySelector('.plugin-modal > header button').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',repeat:true,bubbles:true,cancelable:true}))");
    assert.equal(await js('window.navigationScroll.behavior'), 'instant', 'held arrows skip scrolling animation');
    await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
    assert.equal(await js('window.navigationScroll.behavior'), 'smooth', 'individual presses retain animation');
    await js('void (Element.prototype.scrollIntoView=window.savedScrollIntoView)');
    assert.deepEqual(await js("[...document.querySelectorAll('.rom-card small')].map(e=>e.textContent)"), ['Game Boy Advance', 'Game Boy', 'Famicom']);
    await until(() => js("!!document.querySelector('.rom-card img[src^=\"data:image/png\"]')"));
    await js("document.querySelector('.rom-toolbar input').value='Beta';document.querySelector('.rom-toolbar input').dispatchEvent(new Event('input'))");
    assert.equal(await js("document.querySelectorAll('.rom-card').length"), 1);
    await js("document.querySelector('.rom-toolbar input[type=search]').focus()");
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await until(() => js("document.activeElement===document.querySelector('.rom-card.selected')"));
    assert.equal(await js("!!document.querySelector('.plugin-modal[open]')"), true, 'Enter from search focuses a game without launching it');

    await js("document.querySelector('.rom-toolbar input').value='';document.querySelector('.rom-toolbar input').dispatchEvent(new Event('input'));document.querySelector('[data-sort]').value='system';document.querySelector('[data-sort]').dispatchEvent(new Event('change'));document.querySelector('[data-view-control] input[value=grid]').checked=true;document.querySelector('[data-view-control] input[value=grid]').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.deepEqual(await js("[...document.querySelectorAll('.rom-card small')].map(e=>e.textContent)"), ['Famicom', 'Game Boy', 'Game Boy Advance']);
    assert.equal(await js("document.querySelector('.rom-covers').dataset.view"), 'grid');
    await new Promise(resolve => setTimeout(resolve, 400));
    if (process.env.ARES_LIBRARY_SCREENSHOT) fs.writeFileSync(process.env.ARES_LIBRARY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    assert.ok(await js("document.querySelector('.rom-card').getBoundingClientRect().height >= 250"));
    for (let i = 0; i < 12; ++i) {
      const basename = `ZZ Demo ${String(i).padStart(2, '0')}`;
      fs.writeFileSync(path.join(roms, basename + '.gb'), 'fixture');
      fs.writeFileSync(path.join(roms, basename + '.box.png'), png);
    }
    await js("document.querySelector('[data-sort]').value='title';document.querySelector('[data-sort]').dispatchEvent(new Event('change'));document.querySelector('[data-view-control] input[value=flow]').checked=true;document.querySelector('[data-view-control] input[value=flow]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.plugin-modal [data-refresh]').click()");
    await until(() => js("document.querySelectorAll('.rom-card').length===15"));
    await until(() => js("[...document.querySelectorAll('.rom-card')].some(card=>card.getBoundingClientRect().left>document.querySelector('.rom-covers').getBoundingClientRect().right && card.querySelector('img').naturalWidth>0)"));
    await js("[...document.querySelectorAll('.rom-card')].find(e=>e.textContent.includes('Beta')).dispatchEvent(new MouseEvent('dblclick'))");
    await until(async () => (await sessions.request('session.status')).result?.system === 'Game Boy');
    await until(() => plugins.catalog().plugins.find(p => p.manifest?.id === 'ares.examples.memory' && p.phase === 'active'));
    assert.equal(await js("!!document.querySelector('.plugin-modal[open]')"), false);
    let chosen;
    dialog.showOpenDialog = async (_window, options) => { chosen = options; return { canceled: true, filePaths: [] }; };
    await js("window.ares.preferences.set('library.browser','native'); window.ares.open({system:''})");
    assert.equal(chosen.defaultPath, roms);
    await js("window.ares.preferences.chooseFile('library.directory')");
    assert.deepEqual(chosen.properties, ['openDirectory']);
    const memory = plugins.catalog().plugins.find(p => p.manifest?.id === 'ares.examples.memory');
    assert.equal(await js(`window.ares.plugins.library(${JSON.stringify(memory.lease.token)}, {operation:'scan'}).then(r=>r.plugin_error.code)`), 'plugin_capability_denied');
    await until(() => plugins.catalog().plugins.find(p => p.manifest?.id === 'ares.library' && p.phase === 'active'));
    await js("window.ares.preferences.set('library.browser','ares.library:open');window.ares.open({system:''})");
    await until(() => js("!!document.querySelector('.plugin-modal[open]')"));
    await js("document.querySelector('[data-view-control] input[value=grid]').click()");
    await until(() => {
      const file = path.join(profile,'plugins','ares.library-v1.json');
      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file,'utf8')).view === 'grid';
    });
    await plugins.reload('ares.library');
    await until(() => js("document.querySelector('.plugin-modal[open] .rom-covers')?.dataset.view==='grid'"));
    assert.equal(await js("document.querySelector('[data-view-control] input[value=grid]').checked"), true, 'saved view survives a fresh plugin instance');
    await plugins.enable('ares.library', false);
    await until(() => js("!document.querySelector('.plugin-modal')"));
    await js("window.ares.preferences.set('library.browser','ares.library:open'); window.ares.open({system:''})");
    assert.equal(chosen.defaultPath, roms);
    console.log('PASS ROM library shortcuts/reopening, compressed ZIP launch, mixed systems, filtering, sorting, local art, permissions, folder picker and fallback');
    app.quit();
  } catch (error) { console.error(error); console.log(JSON.stringify(plugins.catalog().plugins.map(p=>({id:p.manifest?.id,error:p.error,state:p.state,logs:p.logs})))); app.exit(1); }
});
