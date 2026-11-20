import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {pluginBuildCache} from '../dist/plugins/build-cache.js';

const exec = promisify(execFile);

test('plugin build caches use OS cache locations and separate source directories', () => {
  const home = path.resolve('/tmp/ares-cache-home');
  const source = path.join(home, 'plugin');
  const options = {home, env: {}};
  const mac = pluginBuildCache(source, {...options, platform: 'darwin'});
  assert.equal(path.dirname(mac), path.join(home, 'Library', 'Caches', 'Ares Workbench', 'plugin-builds'));
  assert.match(path.basename(mac), /^[a-f0-9]{64}$/);
  assert.notEqual(mac, pluginBuildCache(source + '-other', {...options, platform: 'darwin'}));

  const linux = {...options, platform: 'linux'};
  assert.equal(path.dirname(pluginBuildCache(source, linux)), path.join(home, '.cache', 'ares-workbench', 'plugin-builds'));
  const xdg = path.join(home, 'xdg-cache');
  assert.equal(path.dirname(pluginBuildCache(source, {...linux, env: {XDG_CACHE_HOME: xdg}})), path.join(xdg, 'ares-workbench', 'plugin-builds'));
  assert.equal(pluginBuildCache(source, {...linux, env: {XDG_CACHE_HOME: 'relative'}}), pluginBuildCache(source, linux));
});

test('CLI builds leave sources untouched, share symlink namespaces, and retain explicit outputs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ares-cli-build-cache-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const source = path.join(root, 'plugin');
  const home = path.join(root, 'home');
  await fs.mkdir(source);
  await fs.mkdir(home);
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({
    id: 'test.build-cache', name: 'Cache test', version: '1.0.0', apiVersion: 1,
    entry: 'plugin.js', capabilities: [], contributes: {},
  }));
  await fs.writeFile(path.join(source, 'plugin.js'), 'export function activate() {}');
  const cli = fileURLToPath(new URL('../dist/plugins/cli.js', import.meta.url));
  const env = {...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'local'), XDG_CACHE_HOME: path.join(home, 'cache')};
  const build = async (directory, ...args) => JSON.parse((await exec(process.execPath, [cli, 'build', directory, ...args], {env})).stdout);
  const built = await build(source);
  const cache = pluginBuildCache(await fs.realpath(source), {home, env});
  assert.equal(path.dirname(built.directory), cache);
  assert.deepEqual((await fs.readdir(source)).sort(), ['manifest.json', 'plugin.js']);
  assert.match(await fs.readFile(path.join(built.directory, 'plugin.js'), 'utf8'), /activate/);

  const linked = path.join(root, 'linked-plugin');
  await fs.symlink(source, linked, 'dir');
  assert.equal((await build(linked)).directory, built.directory);
  const output = path.join(root, 'explicit-output');
  assert.equal(path.dirname((await build(source, '--output', output)).directory), output);

  await fs.rm(source, {recursive: true});
  await assert.rejects(build(source), /ENOENT/);
  await fs.access(built.directory); // A leftover cache does not become an installed source.
});
