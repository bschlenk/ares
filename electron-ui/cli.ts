import { publishArtifact } from './services/artifact-writer.js';
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
    if (command === 'run' && tool) {
      let args: unknown = {}, outputPath: string | undefined;const state_paths:string[]=[],output_paths:string[]=[];
      for (let i=0;i<flags.length;i+=2) {
        if (!flags[i+1]) throw new Error('Expected --args FILE or --output FILE');
        if (flags[i]==='--args') args=JSON.parse(await fs.readFile(flags[i+1],'utf8'));
        else if (flags[i]==='--state') state_paths.push(flags[i+1]);
        else if (flags[i]==='--artifact') output_paths.push(flags[i+1]);
        else if (flags[i]==='--output') outputPath=flags[i+1];
        else throw new Error(`Unknown flag: ${flags[i]}`);
      }
      const started=await registry.call('run_script',{path:tool,args,state_paths,output_paths},abort.signal);
      const operation=JSON.parse(started.content[0].text);
      if(started.isError)throw new Error(JSON.stringify(operation));
      const identity={...client.identity!};
      const cancel=()=>{void client.request('session.status').then(r=>{if(r.session===identity.session)return client.request('execution.cancel',{session:r.session,epoch:r.epoch},{operationId:operation.operation_id});}).catch(()=>{});};
      abort.signal.addEventListener('abort',cancel,{once:true});
      if(abort.signal.aborted)cancel();
      try {
        let final=operation;
        while(final.state==='running') {
          await new Promise(resolve=>setTimeout(resolve,20));
          const latest=client.identity;if(latest?.session!==identity.session)throw new Error('stale_session');identity.epoch=latest.epoch;
          const r=await client.request('execution.status',identity,{operationId:operation.operation_id});
          if(!r.ok&&r.error==='stale_epoch')continue;
          if(!r.ok||!r.result)throw new Error(r.error??'invalid_reply');final=r.result;
        }
        if(final.stop_reason!=='script_done'){const details=await client.request('script.read',identity,{offset:0,length:16384,operationId:operation.operation_id});throw new Error(JSON.stringify({...final,script_error:details.result?.error}));}
        const chunks:Buffer[]=[];let offset=0,total=0;
        do {
          const r=await client.request('script.read',identity,{offset,length:16384,operationId:operation.operation_id});
          if(!r.ok||!r.result)throw new Error(r.error??'invalid_reply');
          if(r.result.error)throw new Error(r.result.error);
          if(!offset)for(const log of r.result.logs)process.stderr.write(log+'\n');
          const bytes=Buffer.from(r.result.hex,'hex');chunks.push(bytes);offset+=bytes.length;total=r.result.bytes;
          if(!bytes.length&&offset<total)throw new Error('invalid_result_page');
        }while(offset<total);
        const value=Buffer.concat(chunks).toString('utf8');
        if(outputPath)await publishArtifact(outputPath,false,async write=>{await write(value+'\n');},()=>{if(abort.signal.aborted)throw new Error('cancelled');});
        process.stdout.write(value+'\n');
      } finally {abort.signal.removeEventListener('abort',cancel);}
      return;
    }
    if (command !== 'call'  || !tool) throw new Error('Usage: ares tools | ares call TOOL [--json FILE | --name VALUE ...]');
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
    (result.isError ? process.stderr : process.stdout).write(value + '\n');
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
