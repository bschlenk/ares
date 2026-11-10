import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SessionRepository} from '../dist/sessions/repository.js';
import {personalContext, managementRoot} from '../dist/sessions/context.js';
import {KernelLock} from '../dist/sessions/locks.js';
import {launchPlan, waitForNamedOwner} from '../dist/sessions/launching.js';
import {LocalServiceHost} from '../dist/services/local-endpoint.js';

const repositoryURL = new URL('../dist/sessions/repository.js', import.meta.url).href;
const storeURL = new URL('../dist/settings/store.js', import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-session-repository-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const personal = path.join(root, 'personal'); fs.mkdirSync(personal);
  return {root, personal, repository: new SessionRepository(personal)};
}
function subprocess(source, args = []) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, ...args], {stdio: ['pipe', 'pipe', 'pipe']});
  let output = '', error = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => error += data);
  const closed = once(child, 'close');
  return {child, closed, result: async () => {
    const [code, signal] = await closed;
    assert.equal(code, 0, `${signal ?? ''}: ${error}`);
    return output.trim() ? JSON.parse(output) : undefined;
  }};
}

test('subprocess creation races publish one persistent name and preserve personal data', async t => {
  const {personal, repository} = fixture(t);
  const bml = path.join(personal, 'import.bml'); fs.writeFileSync(bml, 'Video\n  Driver: OpenGL\n');
  const original = JSON.stringify({version: 1, values: {'paths.importBml': bml, 'states.root': '/external/states', 'future.plugin': {enabled: true}, 'library.directory': '/shared/roms'}});
  fs.writeFileSync(path.join(personal, 'preferences.json'), original);
  const source = `import {SessionRepository} from ${JSON.stringify(repositoryURL)}; console.log(JSON.stringify(await new SessionRepository(process.argv[1]).resolve('agent')))`;
  const results = await Promise.all(Array.from({length: 8}, () => subprocess(source, [personal]).result()));
  assert.equal(new Set(results.map(value => value.id)).size, 1);
  const manifest = results[0];
  assert.deepEqual(await new SessionRepository(personal).resolve('agent'), manifest);
  const opened = await repository.open('agent'); t.after(() => opened.lock.release());
  const {dataRoot, runtimeRoot} = opened.context;
  assert.notEqual(dataRoot, personal); assert.notEqual(dataRoot, runtimeRoot);
  const saved = JSON.parse(fs.readFileSync(path.join(dataRoot, 'preferences.json')));
  assert.deepEqual(saved.values['future.plugin'], {enabled: true});
  assert.equal(saved.values['library.directory'], '/shared/roms');
  assert.equal(saved.values['states.root'], path.join(dataRoot, 'states'));
  assert.equal(saved.values['paths.importBml'], path.join(dataRoot, 'settings.bml'));
  assert.equal(fs.readFileSync(saved.values['paths.importBml'], 'utf8'), fs.readFileSync(bml, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data.json')));
  assert.equal(ledger.personalStates, '/external/states'); assert.equal(ledger.policy, 'inherit-personal'); assert.deepEqual(ledger.initialized, {});
  assert.equal(fs.readFileSync(path.join(personal, 'preferences.json'), 'utf8'), original);
  assert.equal(fs.statSync(dataRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dataRoot, 'preferences.json')).mode & 0o777, 0o600);
  await assert.rejects(repository.open('agent'), /storage_busy/);
  await opened.lock.release();
  const reopened = await repository.open('agent'); t.after(() => reopened.lock.release());
  assert.equal(reopened.context.dataRoot, dataRoot); assert.notEqual(reopened.context.runtimeRoot, runtimeRoot);
});

test('lifecycle locks coordinate processes, namespace aliases and kernel crash release', async t => {
  const {root, personal, repository} = fixture(t);
  const manifest = await repository.resolve('locked');
  const source = `import {SessionRepository} from ${JSON.stringify(repositoryURL)}; const opened = await new SessionRepository(process.argv[1]).open('locked'); console.log(JSON.stringify(opened.context)); process.stdin.resume();`;
  const running = subprocess(source, [personal]);
  t.after(() => running.child.kill('SIGKILL'));
  await once(running.child.stdout, 'data');
  fs.symlinkSync(personal, path.join(root, 'alias'));
  const alias = new SessionRepository(path.join(root, 'alias'));
  assert.equal(alias.root, repository.root);
  await assert.rejects(alias.open('locked'), /storage_busy/);
  const lockfile = path.join(repository.root, 'locks', `session-${manifest.id}.lock`);
  const inode = fs.statSync(lockfile).ino;
  running.child.kill('SIGKILL'); await running.closed;
  const lock = await KernelLock.acquire(lockfile, {timeoutMs: 3000});
  assert.equal(fs.statSync(lockfile).ino, inode); await lock.release();
  const opened = await alias.open('locked'); await opened.lock.release();
});

test('interrupted initial generation is rebuilt before registry publication', async t => {
  const {repository} = fixture(t);
  const {randomUUID} = await import('node:crypto');
  const intent = {version: 1, name: 'interrupted', id: randomUUID(), generation: randomUUID()};
  const partial = path.join(repository.directory(intent.id), 'generations', intent.generation);
  fs.mkdirSync(partial, {recursive: true, mode: 0o700}); fs.writeFileSync(path.join(partial, 'partial-save'), 'partial');
  fs.writeFileSync(path.join(repository.root, 'creating.json'), JSON.stringify(intent), {mode: 0o600});
  const resolved = await repository.resolve('another');
  assert.equal(resolved.name, 'another');
  assert.deepEqual((await repository.list()).map(value => value.name).sort(), ['another', 'interrupted']);
  assert.equal(fs.existsSync(path.join(partial, 'partial-save')), false);
  assert.equal(fs.existsSync(path.join(partial, 'data.json')), true);
});

test('settings subprocess writers preserve unrelated and unknown keys with persisted revisions', async t => {
  const {personal} = fixture(t);
  const filename = path.join(personal, 'preferences.json');
  fs.writeFileSync(filename, JSON.stringify({version: 1, values: {'future.unknown': {keep: 42}}}));
  const source = `import {SettingsStore} from ${JSON.stringify(storeURL)}; const id=process.argv[2]; const store=new SettingsStore(process.argv[1],[{id,title:id,section:'Test',type:'number',default:0,min:0,max:100,apply:'live'}]); await store.set(id,Number(process.argv[3]));`;
  await Promise.all(Array.from({length: 12}, (_, i) => subprocess(source, [filename, `worker.${i}`, String(i + 1)]).result()));
  const data = JSON.parse(fs.readFileSync(filename)); assert.equal(data.revision, 12);
  assert.deepEqual(data.values['future.unknown'], {keep: 42});
  for (let i = 0; i < 12; i++) assert.equal(data.values[`worker.${i}`], i + 1);
  await subprocess(source, [filename, 'worker.0', '99']).result();
  assert.equal(JSON.parse(fs.readFileSync(filename)).values['worker.0'], 99);
});

test('SIGKILL at creation publication boundaries never exposes a partial workspace', async t => {
  for (const point of ['creation-intent', 'generation-written', 'manifest-published', 'registry-published']) {
    const {personal, repository} = fixture(t);
    const original = JSON.stringify({version: 1, values: {'future.unknown': point}});
    fs.writeFileSync(path.join(personal, 'preferences.json'), original);
    const source = `import {SessionRepository} from ${JSON.stringify(repositoryURL)}; await new SessionRepository(process.argv[1],p=>{if(p===process.argv[2])process.kill(process.pid,'SIGKILL')}).resolve('recover');`;
    const crashed = subprocess(source, [personal, point]);
    assert.equal((await crashed.closed)[1], 'SIGKILL');
    const manifest = await repository.resolve('recover');
    const opened = await repository.open('recover');
    assert.equal(opened.context.sessionId, manifest.id);
    const values = JSON.parse(fs.readFileSync(path.join(opened.context.dataRoot, 'preferences.json'))).values;
    assert.equal(values['future.unknown'], point);
    assert.equal(fs.readFileSync(path.join(personal, 'preferences.json'), 'utf8'), original);
    await opened.lock.release();
    assert.equal((await repository.list()).length, 1);
  }
});

test('unsafe metadata and symlink generations are rejected without touching personal data', async t => {
  const {personal, repository} = fixture(t);
  const manifest = await repository.resolve('safe');
  const generation = path.join(repository.directory(manifest.id), 'generations', manifest.generation);
  fs.renameSync(generation, generation + '.preserved');
  fs.symlinkSync(personal, generation);
  await assert.rejects(repository.open('safe'), /invalid_session_generation/);
  fs.unlinkSync(generation); fs.renameSync(generation + '.preserved', generation);
  const file = path.join(repository.root, 'registry.json');
  fs.chmodSync(file, 0o644);
  await assert.rejects(repository.list(), /insecure_metadata_file/);
});

test('settings authorization is checked after waiting for the lock and malformed latest files are preserved', async t => {
  const {personal} = fixture(t);
  const {SettingsStore} = await import('../dist/settings/store.js');
  const filename = path.join(personal, 'preferences.json');
  const store = new SettingsStore(filename, [{id: 'test.value', title: 'Test', section: 'Test', type: 'boolean', default: false, apply: 'live'}]);
  const lock = await KernelLock.acquire(path.join(personal, '.settings-locks', 'preferences.json.lock'));
  let allowed = true;
  const pending = store.set('test.value', true, () => { if (!allowed) throw new Error('revoked'); });
  await new Promise(resolve => setTimeout(resolve, 100)); allowed = false; await lock.release();
  await assert.rejects(pending, /revoked/); assert.equal(fs.existsSync(filename), false);
  fs.writeFileSync(filename, '{bad'); await assert.rejects(store.set('test.value', true));
  assert.equal(fs.readFileSync(filename, 'utf8'), '{bad');
});

test('personal roots retain their layout and use independent runtime directories and namespaces', async t => {
  const {root, personal, repository} = fixture(t);
  const one = personalContext(personal), two = personalContext(personal);
  assert.equal(one.dataRoot, fs.realpathSync(personal)); assert.equal(two.dataRoot, one.dataRoot);
  assert.notEqual(one.instanceId, two.instanceId); assert.notEqual(one.runtimeRoot, two.runtimeRoot);
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  assert.notEqual(managementRoot(other), managementRoot(personal));
  for (const name of ['../outside', '', 'a/b', '__proto__', 'a'.repeat(49)]) await assert.rejects(repository.resolve(name), /invalid_session_name/);
});

test('checkout and packaged launch plans preserve the namespace and clear inherited selection and private overrides', t => {
  const {personal} = fixture(t);
  const environment = {ARES_PROFILE_DIR: '/wrong', ARES_SAVE_DIR: '/private/saves', ARES_ROM: '/parent/game', ARES_SETTINGS: '/private/config',
    ARES_DEV_SESSION: '{}', ARES_TARGET: 'parent-target', ARES_INSTANCE_NAME: 'parent', NODE_OPTIONS: '--require bad', ELECTRON_RUN_AS_NODE: '1', ARES_HOST: '/explicit/native', ARES_SERVICE_DIR: '/isolated/ipc'};
  const checkout = launchPlan({appRoot: '/a checkout', executable: '/an electron', packaged: false}, personal, undefined, environment);
  assert.deepEqual(checkout.args, ['/a checkout']);
  assert.equal(checkout.executable, '/an electron');
  assert.deepEqual(checkout.env, {ARES_PROFILE_DIR: fs.realpathSync(personal), ARES_HOST: '/explicit/native', ARES_SERVICE_DIR: '/isolated/ipc'});
  const packaged = launchPlan({appRoot: '/an app/Resources/app', executable: '/an app/MacOS/Ares', packaged: true}, personal, 'named', environment);
  assert.deepEqual(packaged.args, ['--session-name', 'named', '--services']);
  assert.throws(() => launchPlan({appRoot: '/', executable: '/', packaged: true}, personal, '../bad'), /invalid_session_name/);
});

test('named readiness waits use authenticated app metadata without native inspection; unavailable owners are never displaced', async t => {
  const {repository} = fixture(t);
  const opened = await repository.open('waiting');
  t.after(() => opened.lock.release());
  const directory = fs.mkdtempSync('/tmp/ares-session-probe-'); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const seen = []; let ready = false;
  const host = new LocalServiceHost({request: async method => { assert.equal(method, 'execution.release'); return {ok: true}; }}, async params => {
    seen.push(params.operation); assert.equal(params.operation, 'app_status');
    return {ready, instance: opened.context.instanceId, kind: 'named', session_id: opened.context.sessionId, session_name: 'waiting'};
  }, opened.context.instanceId);
  await host.listen(directory); t.after(() => host.close());
  repository.advertise(opened.context, opened.lock, false, directory);
  const manifest = await repository.resolve('waiting');
  const timer = setTimeout(() => ready = true, 80); t.after(() => clearTimeout(timer));
  const owner = await waitForNamedOwner(repository, manifest, 2000);
  assert.equal(owner.instanceId, opened.context.instanceId); assert.equal(owner.ready, true); assert(seen.length > 1);
  await host.close();
  await assert.rejects(waitForNamedOwner(repository, manifest, 40), /session_busy_unreachable/);
  await assert.rejects(repository.open('waiting'), /storage_busy/);
});

test('canceling an in-flight named readiness probe closes it immediately without a later launch', async t => {
  const {repository} = fixture(t);
  const opened = await repository.open('cancel'); t.after(() => opened.lock.release());
  const directory = fs.mkdtempSync('/tmp/ares-session-cancel-'); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  let called; const arrived = new Promise(resolve => called = resolve);
  const host = new LocalServiceHost({request: async () => ({ok: true})}, async () => { called(); return new Promise(() => {}); }, opened.context.instanceId);
  await host.listen(directory); t.after(() => host.close());
  repository.advertise(opened.context, opened.lock, false, directory);
  const abort = new AbortController();
  const waiting = waitForNamedOwner(repository, await repository.resolve('cancel'), 10000, abort.signal);
  await arrived; const start = Date.now(); abort.abort(new Error('canceled_probe'));
  await assert.rejects(waiting, /canceled_probe/);
  assert(Date.now() - start < 500);
  await assert.rejects(repository.open('cancel'), /storage_busy/);
});
