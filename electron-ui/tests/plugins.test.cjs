const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const manifest = {
  id: 'test.memory',
  name: 'Test',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'plugin.js',
  capabilities: ['memory.read'],
  contributes: { panels: [{ id: 'memory', title: 'Memory' }] },
}
test('plugin manifests validate built paths, contributions and exact content profiles', async () => {
  const { validateManifest, activation } =
    await import('../dist/plugins/manifest.js')
  for (const patch of [
    { apiVersion: 2 },
    { entry: '../outside.js' },
    { entry: 'src/plugin.tsx' },
    { entry: '%2e%2e/file.js' },
    { capabilities: ['filesystem'] },
    {
      contributes: {
        panels: [
          { id: 'x', title: 'X' },
          { id: 'x', title: 'X' },
        ],
      },
    },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...patch }))
  const m = validateManifest({
    ...manifest,
    activation: {
      systems: ['Nintendo 64'],
      games: [{ profile: 'verified-revision', sha256: 'a'.repeat(64) }],
    },
  })
  assert.equal(
    activation(m, 'Nintendo 64', { sha256: 'a'.repeat(64) }).profile,
    'verified-revision',
  )
  assert.equal(
    activation(m, 'Game Boy Advance', { sha256: 'a'.repeat(64) }).matches,
    false,
  )
  assert.equal(
    activation(m, 'Nintendo 64', { sha256: 'b'.repeat(64) }).matches,
    false,
  )
})
test('registry scopes capabilities, resources, storage and pending work across lifecycle changes', async (t) => {
  const { PluginRegistry } = await import('../dist/plugins/registry.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ares-plugins-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bundled = path.join(root, 'bundled'),
    plugin = path.join(bundled, 'memory')
  await fs.mkdir(plugin, { recursive: true })
  await fs.writeFile(
    path.join(plugin, 'manifest.json'),
    JSON.stringify(manifest),
  )
  await fs.writeFile(
    path.join(plugin, 'plugin.js'),
    'export function activate() {}',
  )
  let identity = { session: 'session1', epoch: 1 },
    pending
  const calls = []
  const client = {
    request: async (method, id, params, owner) => {
      calls.push({ method, id, owner, params })
      if (method === 'memory.read' && pending) return pending
      return {
        protocol: 1,
        id: 'test',
        ...identity,
        ok: true,
        result: { regions: [] },
      }
    },
  }
  const registry = new PluginRegistry(
    bundled,
    path.join(root, 'data'),
    client,
    () => identity,
  )
  await registry.initialize([plugin])
  assert.equal(registry.catalog().plugins.length, 1, 'a bundled directory explicitly enabled for development is discovered once')
  registry.attach()
  registry.observe({
    protocol: 1,
    id: 'status',
    ...identity,
    ok: true,
    result: {
      system: 'Nintendo 64',
      paused: true,
      synthetic: false,
      capabilities: [],
    },
  })
  await registry.enable(manifest.id, true)
  const token = registry.catalog().plugins[0].lease.token
  await registry.request(token, 'memory.regions')
  assert.match(calls.at(-1).owner, /^plugin-/)
  await assert.rejects(
    registry.request(token, 'memory.write', {}),
    /plugin_capability_denied/,
  )
  registry.finish(token)
  await assert.rejects(registry.request(token,'scripts.run',{source:'export default()=>1',args:{},timeoutMs:1000,maxFrames:0}),/plugin_capability_denied/);
  await assert.rejects(registry.request(token,'scripts.observe',{path:'.',args:{},timeoutMs:1000,maxFrames:0}),/plugin_capability_denied/);
  await assert.rejects(registry.request(token,'scripts.observe',{source:'export default()=>1',args:{},timeoutMs:1000,maxFrames:0,outputPath:'/tmp/forbidden.json'}),/plugin_capability_denied/);
  await registry.request(token,'scripts.observe',{path:'plugin.js',args:{},timeoutMs:1000,maxFrames:0,projectRoot:'/tmp/untrusted'});
  const scripted=calls.at(-1),scriptRoot=await fs.realpath(path.join(root,'data/artifacts',registry.catalog().plugins[0].artifact));assert.equal(scripted.method,'scripts.observe');assert.equal(scripted.params.projectRoot,scriptRoot);assert.equal(scripted.params.path,path.join(scriptRoot,'plugin.js'));

  await registry.storage(token, 'set', 'answer', 42)
  assert.equal(await registry.storage(token, 'get', 'answer'), 42)
  await assert.rejects(registry.storage(token, 'set', '__proto__', {}))
  await assert.rejects(
    registry.storage(token, 'set', 'large', 'x'.repeat(17000)),
    /16 KiB/,
  )
  assert.match(
    (
      await registry.resource(
        registry.catalog().plugins[0].lease.baseURL + 'plugin.js',
      )
    ).type,
    /javascript/,
  )
  await fs.writeFile(path.join(root, 'outside.js'), 'secret')
  await fs.symlink(
    path.join(root, 'outside.js'),
    path.join(plugin, 'escape.js'),
  )
  await assert.rejects(
    registry.resource(
      registry.catalog().plugins[0].lease.baseURL + 'escape.js',
    ),
    /ENOENT|escapes/,
  )
  await fs.unlink(path.join(plugin, 'escape.js'))
  let finish
  pending = new Promise((resolve) => (finish = resolve))
  const late = registry.request(token, 'memory.read', {})
  await registry.enable(manifest.id, false)
  finish({ ok: true })
  await assert.rejects(late, /stale_plugin_scope/)
  await assert.rejects(
    registry.storage(token, 'get', 'answer'),
    /stale_plugin_scope/,
  )
  await fs.writeFile(
    path.join(plugin, 'plugin.js'),
    'export const marker="edited-while-disabled";export function activate(){}',
  )
  await registry.enable(manifest.id, true)
  assert.match(
    (
      await registry.resource(
        registry.catalog().plugins[0].lease.baseURL + 'plugin.js',
      )
    ).bytes.toString(),
    /edited-while-disabled/,
  )
  const next = registry.catalog().plugins[0].lease.token
  assert.notEqual(token, next)
  identity = { ...identity, epoch: 2 }
  await assert.rejects(
    registry.request(next, 'memory.regions'),
    /stale_plugin_scope/,
  )
  registry.disconnect()
  assert.equal(registry.catalog().plugins[0].lease, undefined)
})
test('registry reports invalid builds and duplicate IDs; configuration and storage persist', async (t) => {
  const { PluginRegistry } = await import('../dist/plugins/registry.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ares-plugin-config-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bundled = path.join(root, 'bundled'),
    base = path.join(bundled, 'valid'),
    local = path.join(root, 'local')
  await fs.mkdir(base, { recursive: true })
  await fs.mkdir(local)
  for (const dir of [base, local]) {
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest),
    )
    await fs.writeFile(
      path.join(dir, 'plugin.js'),
      'export function activate(){}',
    )
  }
  const identity = { session: 'config', epoch: 1 },
    client = { request: async () => ({ ok: true }) }
  const create = () =>
    new PluginRegistry(bundled, path.join(root, 'data'), client, () => identity)
  let registry = create()
  await registry.initialize()
  await registry.enable(manifest.id, true)
  await registry.add(local)
  assert.match(registry.catalog().plugins[1].error, /Duplicate plugin id/)
  registry.attach()
  registry.observe({
    ok: true,
    ...identity,
    result: {
      system: 'Synthetic',
      paused: true,
      synthetic: true,
      capabilities: [],
    },
  })
  const token = registry.catalog().plugins[0].lease.token
  registry.finish(token)
  await registry.storage(token, 'set', 'persisted', { value: 7 })
  registry.detach()
  assert.equal(registry.catalog().plugins[0].state, 'waiting')
  registry = create()
  await registry.initialize()
  registry.attach()
  registry.observe({
    ok: true,
    ...identity,
    result: {
      system: 'Synthetic',
      paused: true,
      synthetic: true,
      capabilities: [],
    },
  })
  assert.deepEqual(
    await registry.storage(
      registry.catalog().plugins[0].lease.token,
      'get',
      'persisted',
    ),
    { value: 7 },
  )
  const bad = path.join(root, 'unbuilt')
  await fs.mkdir(bad)
  await fs.writeFile(
    path.join(bad, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      id: 'test.unbuilt',
      entry: 'dist/plugin.js',
    }),
  )
  await registry.add(bad)
  assert.match(
    registry.catalog().plugins.at(-1).error,
    /build the declared entry/,
  )
  registry.disconnect()
})

test('compact transform reads require debug.read; capture control also requires session.control',async t=>{
 const {PluginRegistry}=await import('../dist/plugins/registry.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ares-transform-permissions-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const capabilities of [[],['debug.read'],['session.control'],['debug.read','session.control']]){
  const source=path.join(root,'source-'+capabilities.length+'-'+capabilities.join('-'));await fs.mkdir(source);
  await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({...manifest,capabilities}));await fs.writeFile(path.join(source,'plugin.js'),'export function activate(){}');
  const identity={session:'transform-permissions',epoch:1},calls=[];
  const client={request:async(method,id,params,owner)=>{calls.push({method,owner});return {protocol:1,id:'p',...identity,ok:true,result:{}};}};
  const registry=new PluginRegistry(path.join(root,'empty'),path.join(source,'profile'),client,()=>identity);await registry.initialize([source]);registry.attach();registry.observe({protocol:1,id:'p',...identity,ok:true,result:{system:'Nintendo 64',paused:true,synthetic:false,capabilities:[]}});await registry.enable(manifest.id,true);const token=registry.catalog().plugins[0].lease.token;registry.finish(token);
  const read=()=>registry.request(token,'n64.capture.transforms',{generation:null,offset:0,limit:32});
  if(capabilities.includes('debug.read')){await read();assert.equal(calls.at(-1).method,'n64.capture.transforms');assert.match(calls.at(-1).owner,/^plugin-/);}else await assert.rejects(read(),/plugin_capability_denied/);
  const control=()=>registry.request(token,'n64.capture.control',{rsp:true,rdp:null});
  if(capabilities.includes('debug.read')&&capabilities.includes('session.control'))await control();else await assert.rejects(control(),/plugin_capability_denied/);
  registry.disconnect();
 }
});
