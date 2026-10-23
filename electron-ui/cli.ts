import fs from 'node:fs/promises';
import { registerTools } from './mcp/register-tools.js';
import { installCancellation } from './mcp/cancellation.js';
import { ToolRegistry } from './tools/registry.js';
import { AutomaticServiceClient } from './services/automatic-client.js';
import { defaultServiceDirectory } from './services/local-endpoint.js';

export async function main(argv = process.argv.slice(2)) {
  const client = new AutomaticServiceClient(process.env.ARES_SERVICE_DIR ?? defaultServiceDirectory(), process.env.ARES_INSTANCE_NAME);
  const registry = new ToolRegistry();
  installCancellation(registry, client);
  registerTools(registry, client);
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  try {
    const [command, tool, ...flags] = argv;
    if (command === 'tools' && !tool) {
      process.stdout.write(JSON.stringify(registry.list()) + '\n'); return;
    }
    if (command !== 'call' || !tool) throw new Error('Usage: ares tools | ares call TOOL [--json FILE | --name VALUE ...]');
    let args: Record<string, unknown> = {};
    if (flags[0] === '--json') {
      if (flags.length !== 2) throw new Error('--json requires exactly one file');
      args = JSON.parse(await fs.readFile(flags[1], 'utf8'));
    } else {
      for (let i = 0; i < flags.length; i += 2) {
        const key = flags[i];
        if (!key.startsWith('--') || !flags[i + 1] || Object.hasOwn(args, key.slice(2))) throw new Error('Expected unique --name VALUE pairs');
        const value = flags[i + 1];
        try { args[key.slice(2)] = JSON.parse(value); } catch { args[key.slice(2)] = value; }
      }
    }
    const result = await registry.call(tool, args, abort.signal);
    // Preserve images and other structured content; ordinary JSON tools emit their value directly.
    const content = result.content;
    const value = content?.length === 1 && content[0].type === 'text' ? content[0].text : JSON.stringify(result);
    process.stdout.write(value + '\n');
    if (result.isError || abort.signal.aborted) process.exitCode = abort.signal.aborted ? 130 : 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
    process.exitCode = abort.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    client.close();
  }
}
await main();
