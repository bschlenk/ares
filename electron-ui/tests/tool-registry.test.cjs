const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { ToolRegistry } = require('../dist/tools/registry.js');
const { registerTools } = require('../dist/mcp/register-tools.js');
const { LocalServiceClient } = require('../dist/services/local-endpoint.js');

test('CLI discovers shared schemas without launching an app; defaults and validation are shared', async () => {
  const client = new LocalServiceClient('/tmp/nonexistent-ares-tools.json', 'unused');
  const registry = new ToolRegistry(); registerTools(registry, client);
  const list = registry.list();
  const cli = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, '../dist/cli.js'), 'tools'], {encoding:'utf8'}));
  assert.deepEqual(cli, list);
  assert.equal(list.find(t => t.name === 'batch').inputSchema.properties.legacy_results.default, false);
  assert(list.some(t => t.name === 'memory_capture_export'));
  await assert.rejects(registry.call('run_frames', {n:-1}));
  const bad = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/cli.js'), 'call', 'run_frames', '--n', '-1'], {encoding:'utf8'});
  assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.match(bad.stderr, /too_small/);
  client.close();
});
