const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installCliHelpers, mcpConfiguration, isBundledCliRuntime } = require('../dist/agent-integration.js');
test('CLI wrappers preserve spaces, quotes and arguments; refuse unrelated commands', async t => {
  const directory = fs.mkdtempSync("/tmp/ares helper's-");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  mock.method(os, 'homedir', () => directory); t.after(() => mock.restoreAll());
  const resources = path.join(directory, 'Ares.app/Contents/Resources');
  fs.mkdirSync(path.join(resources, 'app'), { recursive: true });
  const executable = path.join(directory, 'run');
  for (const file of [executable, path.join(resources, 'ares-mcp'), path.join(resources, 'ares-plugin')]) fs.writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  await assert.rejects(installCliHelpers(resources, false, executable), /built Ares.app/);
  await installCliHelpers(path.join(resources, 'app'), true, executable);
  for (const name of ['ares-mcp', 'ares-plugin']) assert.equal(execFileSync(path.join(directory, '.local/bin', name), ['argument with spaces', "'quoted'"], { encoding: 'utf8' }), "argument with spaces\n'quoted'\n");
  assert.equal(execFileSync(path.join(directory,'.local/bin/ares'),['tools'],{encoding:'utf8'}),path.join(resources,'app/dist/launcher.js')+'\ntools\n');
  await installCliHelpers(path.join(resources, 'app'), true, executable);
  fs.writeFileSync(path.join(directory, '.local/bin/ares'), 'unrelated');
  await assert.rejects(installCliHelpers(path.join(resources, 'app'), true, executable), /Existing command/);
  assert.equal(fs.readFileSync(path.join(directory, '.local/bin/ares'), 'utf8'), 'unrelated');
});
test('copied MCP configuration automatically selects the running app without a session name', async t => {
  const directory = fs.mkdtempSync('/tmp/ares-mcp-config-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  mock.method(os, 'homedir', () => directory); t.after(() => mock.restoreAll());
  const direct = await mcpConfiguration('/Applications/Ares.app/Contents/Resources/app', true, 'unused');
  assert.deepEqual(direct.mcpServers.ares, { command: '/Applications/Ares.app/Contents/Resources/ares-mcp', args: [] });
  const development = await mcpConfiguration('/tmp/app', false, '/runtime/Electron');
  assert.equal(development.mcpServers.ares.command, '/runtime/Electron');
  assert.deepEqual(development.mcpServers.ares.args, ['/tmp/app/dist/mcp/server.js']);
});

test('MCP command stays stable after moving the app and reinstalling helpers', async t => {
  const directory = fs.mkdtempSync("/tmp/ares mcp's move-");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  mock.method(os, 'homedir', () => directory); t.after(() => mock.restoreAll());
  const oldBundle = path.join(directory, 'build/Ares.app');
  const newBundle = path.join(directory, 'Applications/Ares.app');
  const appRoot = bundle => path.join(bundle, 'Contents/Resources/app');
  const executable = bundle => path.join(bundle, 'Contents/MacOS/Electron');
  fs.mkdirSync(appRoot(oldBundle), { recursive: true });
  fs.mkdirSync(path.dirname(executable(oldBundle)), { recursive: true });
  fs.writeFileSync(executable(oldBundle), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const name of ['ares-mcp', 'ares-plugin']) fs.writeFileSync(path.join(appRoot(oldBundle), '..', name), '#!/bin/sh\nprintf \"%s\\n\" \"$@\"\n', { mode: 0o755 });
  await installCliHelpers(appRoot(oldBundle), true, executable(oldBundle));
  const before = await mcpConfiguration(appRoot(oldBundle), true, executable(oldBundle));
  assert.equal(before.mcpServers.ares.command, path.join(directory, '.local/bin/ares-mcp'));
  assert.deepEqual(before.mcpServers.ares.args, []);
  assert.equal(JSON.stringify(before).includes('~'), false);
  fs.mkdirSync(path.dirname(newBundle)); fs.renameSync(oldBundle, newBundle);
  await installCliHelpers(appRoot(newBundle), true, executable(newBundle));
  const after = await mcpConfiguration(appRoot(newBundle), true, executable(newBundle));
  assert.deepEqual(after, before);
  assert.equal(execFileSync(before.mcpServers.ares.command, before.mcpServers.ares.args, { encoding: 'utf8', env: { ...process.env, HOME: directory } }), '\n');
});

test('bundled CLI detection accepts an Electron-named app and rejects npm snapshots', t => {
  const directory = fs.mkdtempSync('/tmp/ares-bundle-layout-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const contents = path.join(directory, 'Ares.app/Contents');
  const root = path.join(contents, 'Resources/app');
  const executable = path.join(contents, 'MacOS/Electron');
  fs.mkdirSync(root, { recursive: true });
  for (const file of [executable, path.join(contents, 'Resources/ares-mcp'), path.join(contents, 'Resources/ares-plugin'), path.join(contents, 'Resources/native/bin/ares-electron-host')]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  assert.equal(isBundledCliRuntime(root, executable), true);
  const snapshot = path.join(directory, 'artifacts/runs/launch-test');
  fs.mkdirSync(snapshot, { recursive: true });
  assert.equal(isBundledCliRuntime(snapshot, executable), false);
  fs.unlinkSync(path.join(contents, 'Resources/ares-mcp'));
  assert.equal(isBundledCliRuntime(root, executable), false);
});
