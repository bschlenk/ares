import {Targets, encodeTarget, defaultPersonalRoot} from '../sessions/targets.js';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerTools } from './register-tools.js';
import { AutomaticServiceClient } from '../services/automatic-client.js';
import { defaultServiceDirectory, LocalServiceClient } from '../services/local-endpoint.js';
const args = process.argv.slice(2);
const take = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const file = take('--connection'), instance = take('--instance'), name = take('--instance-name'), target = take('--target'), sessionName = take('--session-name'), directory = take('--service-dir');
if (args.some((arg, i) => i % 2 === 0 && !['--connection','--instance','--instance-name','--session-name','--target','--service-dir'].includes(arg)) || args.length % 2 || new Set(args.filter((_,i) => i % 2 === 0)).size !== args.length / 2 ||
    ([name,target,sessionName,file||instance].filter(Boolean).length>1) || (file || instance ? !(file && path.isAbsolute(file) && instance && !name && !directory) : directory !== undefined && !path.isAbsolute(directory))) {
  console.error('Usage: ares-mcp [--service-dir /absolute/dir] [--instance-name NAME] OR --connection /absolute/instance.json --instance UUID'); process.exit(2);
}
const serviceDirectory=directory ?? process.env.ARES_SERVICE_DIR ?? defaultServiceDirectory();
const root=defaultPersonalRoot();
if(!target&&!name&&!sessionName&&!file&&process.env.ARES_TARGET&&process.env.ARES_INSTANCE_NAME)throw new Error('contradictory_target_flags');
const startup=target??(sessionName?encodeTarget({version:1,personal_root:root,directory:serviceDirectory,name:sessionName}):file?encodeTarget({version:1,personal_root:root,directory:path.dirname(file),instance:instance!}):name?undefined:process.env.ARES_TARGET);
const targets=new Targets(serviceDirectory,root,startup,name??process.env.ARES_INSTANCE_NAME);
const local = file ? new LocalServiceClient(file, instance!) : new AutomaticServiceClient(directory ?? process.env.ARES_SERVICE_DIR ?? defaultServiceDirectory(), name);
function createServer(): McpServer {
  const server = new McpServer({ name: 'ares', version: '0.2.0' });
  const close=registerTools(server, local, targets);
  server.server.onclose = close;
  return server;
}
const handle = serveStdio(createServer, { onerror: error => console.error(error.message) });
process.on('SIGTERM', () => { local.close(); void handle.close(); });
process.on('SIGINT', () => { local.close(); void handle.close(); });
