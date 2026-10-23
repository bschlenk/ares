import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { installCancellation } from './cancellation.js';
import { registerTools } from './register-tools.js';
import { AutomaticServiceClient } from '../services/automatic-client.js';
import { defaultServiceDirectory, LocalServiceClient } from '../services/local-endpoint.js';
const args = process.argv.slice(2);
const take = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const file = take('--connection'), instance = take('--instance'), name = take('--instance-name'), directory = take('--service-dir');
if (args.some((arg, i) => i % 2 === 0 && !['--connection','--instance','--instance-name','--service-dir'].includes(arg)) || args.length % 2 || new Set(args.filter((_,i) => i % 2 === 0)).size !== args.length / 2 ||
    (file || instance ? !(file && path.isAbsolute(file) && instance && !name && !directory) : directory !== undefined && !path.isAbsolute(directory))) {
  console.error('Usage: ares-mcp [--service-dir /absolute/dir] [--instance-name NAME] OR --connection /absolute/instance.json --instance UUID'); process.exit(2);
}
const local = file ? new LocalServiceClient(file, instance!) : new AutomaticServiceClient(directory ?? process.env.ARES_SERVICE_DIR ?? defaultServiceDirectory(), name);
function createServer(): McpServer {
  const server = new McpServer({ name: 'ares', version: '0.2.0' });
  installCancellation(server, local);
  registerTools(server, local);
  server.server.onclose = () => local.close();
  return server;
}
const handle = serveStdio(createServer, { onerror: error => console.error(error.message) });
process.on('SIGTERM', () => { local.close(); void handle.close(); });
process.on('SIGINT', () => { local.close(); void handle.close(); });
