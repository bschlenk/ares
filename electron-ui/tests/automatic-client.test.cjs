const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalServiceHost } = require('../dist/services/local-endpoint.js');
const { AutomaticServiceClient } = require('../dist/services/automatic-client.js');
const backend = { async request() { return { protocol: 1, id: 'fixture', session: 'automatic', epoch: 1, ok: true,
  result: { paused: true, system: 'Fixture', synthetic: true, capabilities: ['session.status'] } }; } };
test('automatic selection attaches to an existing unnamed app, ignores stale records and reconnects', async t => {
  const directory = fs.mkdtempSync('/tmp/ares-auto-');
  const host = new LocalServiceHost(backend, async () => ({ ready: true }));
  const client = new AutomaticServiceClient(directory);
  t.after(async () => { client.close(); await host.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await host.listen(directory);
  const stale = '11111111-1111-1111-1111-111111111111';
  fs.writeFileSync(path.join(directory, `${stale}.json`), JSON.stringify({ ...host.info, instance: stale, endpoint: path.join(directory, 'gone.sock') }), { mode: 0o600 });
  assert.equal((await client.request('session.status')).session, 'automatic');
  assert.equal(client.launchedApp, false);
  client.disconnect();
  assert.equal((await client.request('session.status')).session, 'automatic');
  client.close();
  assert.equal((await backend.request()).ok, true);
});
test('automatic selection reports multiple live apps without choosing one', async t => {
  const directory = fs.mkdtempSync('/tmp/ares-auto-');
  const hosts = [new LocalServiceHost(backend, async () => ({ ready: true })), new LocalServiceHost(backend, async () => ({ ready: true }))];
  const client = new AutomaticServiceClient(directory);
  t.after(async () => { client.close(); for (const host of hosts) await host.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const host of hosts) await host.listen(directory);
  await assert.rejects(client.request('session.status'), /multiple_apps_running/);
});
test('automatic selection waits for an existing app to initialize without launching another', async t => {
  const directory = fs.mkdtempSync('/tmp/ares-auto-'); let polls = 0;
  const host = new LocalServiceHost(backend, async () => ({ ready: ++polls >= 3 }));
  const client = new AutomaticServiceClient(directory);
  t.after(async () => { client.close(); await host.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await host.listen(directory);
  assert.equal((await client.request('session.status')).ok, true);
  assert.ok(polls >= 3); assert.equal(client.launchedApp, false);
});
