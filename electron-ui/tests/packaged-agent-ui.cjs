// Exercise the real packaged app's helper button without writing to the user's home.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const temporary = fs.mkdtempSync('/tmp/ares-packaged-agent-');
try {
  const bundle = path.join(temporary, 'Ares.app');
  fs.cpSync(path.resolve(process.argv[2] || 'build_macos/Ares.app'), bundle, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  const root = path.join(bundle, 'Contents/Resources/app');
  const manifest = path.join(root, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest)), main: 'agent-check.mjs' }));
  fs.copyFileSync(path.join(__dirname, 'stdio-peer.cjs'), path.join(root, 'stdio-peer.cjs'));
  fs.writeFileSync(path.join(root, 'agent-check.mjs'), `
import { app, BrowserWindow, clipboard } from 'electron';
import { StdioPeer } from './stdio-peer.cjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
assert.equal(app.isPackaged, true);
app.setPath('userData', path.join(process.env.HOME, 'profile'));
await import('./dist/main.js');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  try {
    let window;
    for (let i = 0; i < 400; ++i) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && await window.webContents.executeJavaScript('!!window.ares').catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const js = code => window.webContents.executeJavaScript(code);
    const installed = await js('window.ares.agentAction("install")');
    assert.match(installed, /Installed ares/);
    const helper = path.join(process.env.HOME, '.local/bin/ares-mcp');
    assert.ok(fs.existsSync(helper));
    await js('window.ares.preferences.set("agent.enabled", true)');
    await js('window.ares.agentAction("copy")');
    const config = JSON.parse(await clipboard.readText());
    assert.equal(config.mcpServers.ares.command, helper);
    assert.deepEqual(config.mcpServers.ares.args, []);
    assert.equal(JSON.stringify(config).includes(app.getAppPath()), false, 'installed helper configuration is independent of the bundle location');
    assert.deepEqual(JSON.parse(await js('window.ares.agentAction(\"preview\")')), config);
    const peer = new StdioPeer(config.mcpServers.ares.command, config.mcpServers.ares.args);
    try { await peer.initialize(); assert.ok((await peer.tool('emu_status')).system); } finally { await peer.close(); }
    fs.writeFileSync(path.join(process.env.HOME, 'passed'), JSON.stringify({ isPackaged: app.isPackaged, executable: process.execPath, command: config.mcpServers.ares.command }));
    console.log('PACKAGED_AGENT_UI_PASS');
    clearTimeout(timeout); app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('ARES_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { HOME: temporary, ARES_BACKGROUND_TEST: '1', ARES_DISABLE_PLUGINS: '1', ARES_SILENT: '1' });
  const result = spawnSync(path.join(bundle, 'Contents/MacOS/Ares'), [], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(temporary, 'passed')), result.stdout + result.stderr);
  console.log('PACKAGED_AGENT_UI_PASS', JSON.parse(fs.readFileSync(path.join(temporary, 'passed'))));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
