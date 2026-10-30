import * as z from 'zod/v4';
import type { ToolRegistrar } from '../tools/registry.js';
import { ServiceError, type SessionClient, type SessionIdentity, type SessionReply } from '../services/contracts.js';
export function registerCoreTools(server:ToolRegistrar,client:SessionClient,status:()=>Promise<SessionIdentity>) {
  const unwrap=<T>(r:SessionReply<T>):T=>{if(!r.ok||!r.result)throw new ServiceError(r.error??'invalid_reply');return r.result;};
  const output=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
  const call=(fn:()=>Promise<unknown>)=>fn().then(output,e=>({...output({error:e instanceof ServiceError?e.code:'request_failed',message:e.message}),isError:true}));
  for(const [tool,method] of [['input_describe','input.describe'],['input_state','input.state']] as const)server.registerTool(tool,{description:'Cross-core named digital input ports from the loaded core. Uses native node names; no N64 mask mapping.',inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true}},()=>call(async()=>unwrap(await client.request(method,await status()))));
  server.registerTool('input_set',{description:'Replace one discovered port’s complete digital held state. Native frame and wall leases are mandatory. Requires a retained CLI owner lease across calls. Normal execution continues.',inputSchema:z.object({port:z.number().int().min(1).max(256).default(1),buttons:z.array(z.string().min(1).max(256)).max(64),lease_frames:z.number().int().min(1).max(600).default(120),lease_ms:z.number().int().min(1).max(10000).default(10000)}).strict()},p=>call(async()=>unwrap(await client.request('input.set',await status(),{port:p.port,buttons:p.buttons,leaseFrames:p.lease_frames,leaseMs:p.lease_ms}))));
  server.registerTool('input_release',{description:'Release only this owner’s digital input. Port 0 releases all its ports.',inputSchema:z.object({port:z.number().int().min(0).max(256).default(0)}).strict()},p=>call(async()=>unwrap(await client.request('input.release',await status(),p))));
  server.registerTool('wait_frames',{description:'Wait for real elapsed native frames during normal execution. Does not pause, resume or change speed. Paused time counts only toward the wall deadline. Cancellation releases this owner’s input.',inputSchema:z.object({frames:z.number().int().min(0).max(600),timeout_ms:z.number().int().min(1).max(60000).default(10000)}).strict()},(p,ctx)=>call(async()=>{
    const identity=await status();const started=unwrap(await client.request('clock.waitStart',identity,{frames:p.frames,timeoutMs:p.timeout_ms}));let result=started;
    try {
      while(result.state==='waiting') {
        if(ctx.mcpReq.signal.aborted)throw new ServiceError('cancelled');
        await new Promise<void>(resolve=>{const timer=setTimeout(done,10);function done(){clearTimeout(timer);ctx.mcpReq.signal.removeEventListener('abort',done);resolve();}ctx.mcpReq.signal.addEventListener('abort',done,{once:true});});
        if(ctx.mcpReq.signal.aborted)throw new ServiceError('cancelled');
        result=unwrap(await client.request('clock.waitRead',identity,{waitId:started.wait_id}));
      }
      return result;
    } finally {
      if(result.state==='waiting')await client.request('clock.waitCancel',identity,{waitId:started.wait_id}).catch(()=>{});
      if(ctx.mcpReq.signal.aborted)await client.request('input.release',identity,{port:0}).catch(()=>{});
    }
  }));
}
