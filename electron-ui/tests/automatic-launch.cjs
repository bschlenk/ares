// End-to-end GUI test; uses an isolated profile and never targets a user app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StdioPeer } = require('./stdio-peer.cjs');
const { AutomaticServiceClient } = require('../dist/services/automatic-client.js');
const { makeFixture } = require('../fixture.cjs');
(async () => {
  const directory = fs.mkdtempSync('/tmp/ares-launch-test-');
  const services = path.join(directory, 'ipc');
  const executable = process.env.ARES_TEST_EXECUTABLE || path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const server = process.env.ARES_TEST_MCP || path.resolve(__dirname, '../dist/mcp/server.js');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ARES_PROFILE_DIR: path.join(directory, 'profile'),
    ARES_SERVICE_DIR: services, ARES_ROM: '', ARES_SAVE_DIR: '', ARES_SILENT: '1', ARES_BACKGROUND_TEST: '1', ARES_DISABLE_PLUGINS: '1' };
  let peer, pid;
  const client = new AutomaticServiceClient(services);
  try {
    peer = new StdioPeer(executable, [server, '--service-dir', services], { env });
    await peer.initialize();
    const started = await peer.tool('emu_status');
    assert.equal(started.error, undefined, JSON.stringify(started));
    assert.equal(started.adapter_launched_app, true);
    assert.equal(started.loaded, false);
    pid = (await client.manage({ operation: 'app_status' })).pid;
    const rom = path.join(directory, 'fixture.gb'); fs.writeFileSync(rom, makeFixture());
    const loaded = await peer.tool('load_rom', { path: rom, system: 'Game Boy' });
    assert.equal(loaded.error, undefined, JSON.stringify(loaded));
    assert.equal(loaded.already_loaded, false);
    assert.equal(loaded.system, 'Game Boy'); assert.equal(loaded.loaded, true); assert.equal(loaded.paused, true);
    await peer.tool('resume');
    const beforeNoop = await peer.tool('emu_status');
    const repeat = await peer.tool('load_rom', { path: rom, system: 'Game Boy' });
    assert.equal(repeat.already_loaded, true); assert.equal(repeat.session, loaded.session); assert.equal(repeat.epoch, loaded.epoch); assert.equal(repeat.paused, false);
    assert.ok(repeat.frame >= beforeNoop.frame);
    const copy = path.join(directory, 'copy.gb'); fs.copyFileSync(rom, copy);
    const sameBytes = await peer.tool('load_rom', { path: copy });
    assert.equal(sameBytes.already_loaded, true); assert.equal(sameBytes.session, loaded.session); assert.equal(sameBytes.paused, false);
    const link = path.join(directory, 'alias.gb'); fs.symlinkSync(rom, link);
    assert.equal((await peer.tool('load_rom', { path: link })).already_loaded, true);
    await peer.tool('pause');
    const missing = await peer.tool('load_rom', { path: path.join(directory, 'missing.gb') });
    assert.ok(missing.error);
    assert.equal((await peer.tool('emu_status')).session, loaded.session, 'failed preflight preserves current game');
    await peer.close(); peer = undefined;
    process.kill(pid, 0); // GUI must outlive the MCP adapter.
    peer = new StdioPeer(executable, [server, '--service-dir', services], { env }); await peer.initialize();
    const attached = await peer.tool('emu_status');
    assert.equal(attached.adapter_launched_app, false); assert.equal(attached.session, loaded.session);
    assert.equal((await client.manage({ operation: 'app_status' })).pid, pid);
    assert.equal((await peer.tool('close_rom')).loaded, false);
    const empty = await peer.tool('emu_status'); assert.equal(empty.loaded, false); assert.notEqual(empty.session, loaded.session);
    console.log('Automatic GUI launch, ROM load/close, failed-load preflight, adapter disconnect survival and unnamed reattach passed');
  } finally {
    await peer?.close(); client.close();
    if (pid) { process.kill(pid, 'SIGTERM'); await new Promise(r => setTimeout(r, 1000)); }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
