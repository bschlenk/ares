import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import electron from 'electron';

const temporary = fs.mkdtempSync('/tmp/ares-context-'), children = [];
const profile = path.join(temporary, 'personal'); fs.mkdirSync(profile);
const preferencesFile = path.join(profile, 'preferences.json');
fs.writeFileSync(preferencesFile, JSON.stringify({version: 1, values: {'presentation.theme': 'green', 'agent.enabled': false, 'future.value': 7}}));
let sequence = 0;
function launch(name, theme) {
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('ARES_') && key !== 'ARES_HOST') delete env[key];
  Object.assign(env, {ARES_PROFILE_DIR: profile, ARES_SERVICE_DIR: path.join(temporary, 'ipc-' + sequence++), ARES_ENABLE_SERVICES: '1', ARES_BACKGROUND_TEST: '1', ARES_DEFAULT_PLUGINS: '0', ARES_SILENT: '1'});
  if (theme) env.ARES_TEST_THEME = theme;
  const child = spawn(electron, [new URL('./electron-session-context.js', import.meta.url).pathname, ...(name ? ['--session-name', name] : [])], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const result = {child, output: '', closed: once(child, 'close')};
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => result.output += value);
  children.push(result); return result;
}
async function ready(result) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const match = result.output.match(/CONTEXT_READY (.+)\n/);
    if (match) return JSON.parse(match[1]);
    if (result.child.exitCode !== null) throw new Error(result.output);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('session context startup timeout: ' + result.output);
}
const timer = setTimeout(() => { for (const result of children) result.child.kill('SIGKILL'); }, 45000);
try {
  const personal = launch(); const first = await ready(personal);
  assert.equal(first.context.kind, 'personal'); assert.equal(first.context.dataRoot, fs.realpathSync(profile));
  const named = launch('work', 'paper'), context = await ready(named);
  assert.equal(context.context.kind, 'named'); assert.equal(context.initialTheme, 'green');
  assert.notEqual(context.context.dataRoot, profile);
  assert.notEqual(context.context.runtimeRoot, first.context.runtimeRoot);
  assert.equal(JSON.parse(fs.readFileSync(preferencesFile)).values['presentation.theme'], 'green');
  const duplicate = launch('work'); assert.equal((await duplicate.closed)[0], 0, duplicate.output);
  assert.match(duplicate.output, /session_existing/); assert(duplicate.output.includes(context.context.instanceId));
  const other = launch('other'); const second = await ready(other);
  assert.notEqual(second.context.sessionId, context.context.sessionId);
  named.child.kill('SIGTERM'); assert.equal((await named.closed)[0], 0, named.output);
  const reopened = launch('work'); const again = await ready(reopened);
  assert.equal(again.context.sessionId, context.context.sessionId);
  assert.equal(again.context.dataRoot, context.context.dataRoot);
  assert.notEqual(again.context.instanceId, context.context.instanceId);
  assert.equal(again.initialTheme, 'paper');
  assert.equal(JSON.parse(fs.readFileSync(preferencesFile)).values['future.value'], 7);
  console.log('SESSION_CONTEXT_PASS: personal paths, named creation/reopen, private runtime, cross-service duplicate resolution');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(timer);
  for (const result of children) if (result.child.exitCode === null && result.child.signalCode === null) result.child.kill('SIGTERM');
  await Promise.all(children.map(result => result.closed));
  fs.rmSync(temporary, {recursive: true, force: true});
}
