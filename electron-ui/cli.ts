import { waitForScript } from './services/script-wait.js';
import { publishArtifact } from './services/artifact-writer.js';
import fs from 'node:fs/promises';
import path from 'node:path';
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
    if(process.env.ARES_OWNER_LEASE)await client.manage({operation:'owner_lease',action:'use',lease_id:process.env.ARES_OWNER_LEASE});
    if(command==='call'&&!process.env.ARES_OWNER_LEASE&&['audio_capture','memory_snapshot','memory_sample','memory_query_start','video_start','memory_record_start','controller_set','script_observe','demonstration_request','demonstration_start','demonstration_replay'].includes(tool))throw new Error('This resource ends on CLI disconnect. Create an owner_lease and set ARES_OWNER_LEASE for start/run/stop commands.');
    if (command === 'tools' && !tool) {
      process.stdout.write(JSON.stringify(registry.list()) + '\n'); return;
    }
    if (command === 'run' && tool) {
      let args: unknown = {}, outputPath: string | undefined; let retain=false;let video_path:string|undefined;const state_paths:string[]=[],output_paths:string[]=[];
      for (let i=0;i<flags.length;i+=2) {
        if(flags[i]==='--retain-result'){retain=true;--i;continue;}
        if (!flags[i+1]) throw new Error('Expected --args FILE or --output FILE');
        if (flags[i]==='--args') args=JSON.parse(await fs.readFile(flags[i+1],'utf8'));
        else if (flags[i]==='--state') state_paths.push(path.resolve(flags[i+1]));
        else if (flags[i]==='--artifact') output_paths.push(path.resolve(flags[i+1]));
        else if (flags[i]==='--video') video_path=path.resolve(flags[i+1]);
        else if (flags[i]==='--output') outputPath=flags[i+1];
        else throw new Error(`Unknown flag: ${flags[i]}`);
      }
      const started=await registry.call('run_script',{path:path.resolve(tool),args,state_paths,output_paths,file_base:process.cwd(),...(video_path?{video_path}:{})},abort.signal);
      const operation=JSON.parse(started.content[0].text);
      if(started.isError)throw new Error(JSON.stringify(operation));
      const identity={...client.identity!};
      let consumed=false;
      try {
        const final=await waitForScript(client,operation,identity,{signal:abort.signal});
        if(final.stop_reason!=='script_done'){const details=await client.request('script.read',identity,{offset:0,length:16384,operationId:operation.operation_id});throw new Error(JSON.stringify({...final,script_error:details.result?.error}));}
        const chunks:Buffer[]=[];let offset=0,total=0;
        do {
          const page=await registry.call('script_result',{result_handle:operation.result_handle,offset,length:16384},abort.signal);
          const r={ok:!page.isError,result:page.isError?undefined:JSON.parse(page.content[0].text),error:page.isError?page.content[0].text:undefined};
          if(!r.ok||!r.result)throw new Error(r.error??'invalid_reply');
          if(r.result.error)throw new Error(r.result.error);
          if(!offset)for(const log of r.result.logs)process.stderr.write(log+'\n');
          const bytes=Buffer.from(r.result.hex,'hex');chunks.push(bytes);offset+=bytes.length;total=r.result.bytes;
          if(!bytes.length&&offset<total)throw new Error('invalid_result_page');
        }while(offset<total);
        const value=Buffer.concat(chunks).toString('utf8');
        if(outputPath)await publishArtifact(outputPath,false,async write=>{await write(value+'\n');},()=>{if(abort.signal.aborted)throw new Error('cancelled');});
        process.stdout.write(value+'\n');
        consumed=true;
      } finally {
        if(!retain)await client.manage({operation:'script_result',handle:operation.result_handle,...(consumed?{consumed:true}:{discard:true})}).catch(()=>{});
      }
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
