import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeSessionClient } from '../dist/services/native-client.js';
import { coreDescriptors, parseNativeSettingsInfo, nativeSettingsBml } from '../dist/settings/native.js';

const host = process.env.ARES_HOST || fileURLToPath(new URL('../../build_macos/workbench/bin/ares-electron-host', import.meta.url));

test('upstream firmware discovery and new core settings remain usable through Electron', () => {
  const info = parseNativeSettingsInfo(execFileSync(host, ['--settings-info'], { encoding: 'utf8' }));
  const datel = info.firmware.find(f => f.system === 'PlayStation' && f.type === 'Datel (128KB)');
  assert.equal(datel.key, 'PlayStation/Firmware/Datel-128KB.Any');
  const descriptors = coreDescriptors(info);
  const chosen = { 'core.deinterlacing': 'Bob', 'ps1.expansionDevice': 'Datel (128KB)', 'neoGeo.mvsBios': 'uni-bios.rom' };
  const entries = descriptors.filter(d => d.id in chosen).map(descriptor => ({ descriptor, value: chosen[descriptor.id] }));
  assert.equal(entries.length, 3);
  const bml = nativeSettingsBml({ revision: 1, entries });
  assert.match(bml, /Deinterlacing: Bob/);
  assert.match(bml, /ParallelPort: Datel \(128KB\)/);
  assert.match(bml, /MVSBIOS: uni-bios.rom/);
  const systems = execFileSync(host, ['--systems'], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(systems.includes('Arcade') && systems.includes('Neo Geo AES') && systems.includes('PlayStation'));
  assert.ok(!systems.includes('Neo Geo MVS'), 'MVS now loads through Arcade');
});

test('PlayStation expansion firmware loads and saves without desktop GUI dependencies', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-ps1-expansion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Synthetic BIOS and executable only exercise loading/saving, not commercial firmware or gameplay.
  const bios = path.join(dir, 'bios.bin'), cart = path.join(dir, 'datel.bin'), exe = path.join(dir, 'fixture.exe');
  fs.writeFileSync(bios, Buffer.alloc(512 * 1024));
  fs.writeFileSync(cart, Buffer.alloc(128 * 1024, 0x5a));
  const image = Buffer.alloc(4096); image.write('PS-X EXE');
  image.writeUInt32LE(0x80010000, 0x10); image.writeUInt32LE(0x80010000, 0x18); image.writeUInt32LE(2048, 0x1c);
  fs.writeFileSync(exe, image);
  assert.equal(execFileSync(host, ['--identify', exe, '--system', 'Neo Geo MVS'], { encoding: 'utf8' }).trim(), 'Arcade');
  const config = path.join(dir, 'settings.bml');
  fs.writeFileSync(config, `PlayStation\n  ParallelPort: Datel (128KB)\n  Firmware\n    BIOS.US: ${bios}\n    Datel-128KB.Any: ${cart}\n`);
  const child = spawn(host, ['--rom', exe, '--system', 'PlayStation', '--settings', config, '--paused', '--silent', '--save-dir', path.join(dir, 'saves'), '--control-session', 'ps1-expansion'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let log = ''; child.stderr.on('data', chunk => { log += chunk; }); child.stdout.resume();
  const client = new NativeSessionClient(child.stdin, child.stdio[3], { session: 'ps1-expansion', epoch: 1 }, () => {});
  t.after(() => { client.close(); if (child.exitCode === null) child.kill(); });
  const reply = await client.request('session.status');
  assert.equal(reply.ok, true, log);
  assert.equal(reply.result.system, 'PlayStation');
  child.stdin.end();
  const [code] = await closed;
  assert.equal(code, 0, log);
  const saved = fs.readFileSync(path.join(dir, 'saves', 'PlayStation', 'Datel (128KB).eeprom'));
  assert.equal(saved.length, 128 * 1024);
  assert.ok(saved.every(byte => byte === 0x5a));
  assert.equal(fs.readFileSync(cart)[0], 0x5a);
  assert.equal(fs.readFileSync(config, 'utf8').includes('Datel-128KB.Any'), true);
});
