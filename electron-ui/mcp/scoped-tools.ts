import {localRequestContext} from '../services/local-endpoint.js';
import {requestIdentity} from '../services/request-identity.js';
import {scopeReferences, inputReferences, referenceInputs} from './target-references.js';
import {AutomaticServiceClient} from '../services/automatic-client.js';
import {encodeTarget} from '../sessions/targets.js';
import * as z from 'zod/v4';
import type {ToolRegistrar} from '../tools/registry.js';
import {ToolRegistry} from '../tools/registry.js';
import {Targets, decodeTarget} from '../sessions/targets.js';
import {SessionRepository} from '../sessions/repository.js';
import {installCancellation} from './cancellation.js';
import {registerUnscopedTools} from './register-tools.js';
import type {LocalServiceClient} from '../services/local-endpoint.js';
const output=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
const failure=(error:unknown)=>({...output({error:(error as Error).message}),isError:true});
const call=async(work:()=>Promise<unknown>)=>{try{return output(await work());}catch(error){return failure(error);}};

/** Each entry owns identity, tool caches and cancellation; active calls pin it. */
export function registerScopedTools(server:ToolRegistrar, targets:Targets, fallback:LocalServiceClient) {
  const pool=new Map<string,{client:LocalServiceClient;registry:ToolRegistry;active:number;run:<T>(work:()=>Promise<T>)=>Promise<T>}>();
  const template=new ToolRegistry();registerUnscopedTools(template,fallback);
  for(const tool of template.list()) {
    if(['session_archives','session_reset','session_restore'].includes(tool.name))continue;
    const config=template.configuration(tool.name);
    const extension:Record<string,any>={target:z.string().max(16384).optional()};
    for(const field of referenceInputs)if(config.inputSchema.shape[field])extension[field]=z.union([config.inputSchema.shape[field],z.string().startsWith('aresref1.').max(32768)]);
    server.registerTool(tool.name,{...config,inputSchema:config.inputSchema.safeExtend(extension)},async(args:any,ctx:any)=>{
      let entry: {client:LocalServiceClient;registry:ToolRegistry;active:number;run:<T>(work:()=>Promise<T>)=>Promise<T>}|undefined;
      let acquired=false;
      try {
        ctx.mcpReq.signal.throwIfAborted();
        const {target:handle,...raw}=args;
        if(tool.name==='build_info'&&!raw.app)return template.call(tool.name,raw,ctx.mcpReq.signal);
        const {values:params,refs}=inputReferences(raw);
        const selected=await targets.client(handle??refs[0]?.target,ctx.mcpReq.signal);
        if(refs.some(ref=>ref.target!==selected.target)){selected.client.close();throw new Error('target_reference_mismatch');}
        if(ctx.mcpReq.signal.aborted){selected.client.close();ctx.mcpReq.signal.throwIfAborted();}
        entry=pool.get(selected.key);
        if(entry)selected.client.close();
        else {
          if(pool.size>=8) {
            const idle=[...pool].find(([,value])=>value.active===0);
            if(!idle){selected.client.close();throw new Error('target_pool_busy');}
            idle[1].client.close();pool.delete(idle[0]);
          }
          const registry=new ToolRegistry();installCancellation(registry,selected.client);registerUnscopedTools(registry,selected.client);
          entry={client:selected.client,registry,active:0,run:requestIdentity(selected.client)};pool.set(selected.key,entry);
        }
        ++entry.active;acquired=true;
        for(const ref of refs)if(ref.identity){
          const status=await entry.client.request('session.status');
          if(!status.ok || status.session!==ref.identity.session || status.epoch!==ref.identity.epoch)throw new Error('stale_target_reference');
        }
        const {result,identity}=await entry.run(async()=>({result:await entry!.registry.call(tool.name,params,ctx.mcpReq.signal),identity:entry!.client.identity}));
        if(!selected.target && entry.client instanceof AutomaticServiceClient && entry.client.targetInstance)selected.target=encodeTarget({version:1,personal_root:targets.personalRoot,directory:targets.directory,instance:entry.client.targetInstance});
        if(!result.isError && result.content?.length===1 && result.content[0].type==='text') {
          try {const value=JSON.parse(result.content[0].text);if(value && typeof value==='object'&&!Array.isArray(value))result.content[0].text=JSON.stringify({...scopeReferences(value,selected.target,identity),target:selected.target});}catch{}
        }
        return result;
      }catch(error){return failure(error);}
      finally {if(entry&&acquired)--entry.active;}
    });
  }
  const name=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/), target=z.string().max(16384).optional();
  server.registerTool('sessions_list',{description:'List persisted names and authenticated live window metadata. Never launches, prompts or inspects native gameplay.',inputSchema:z.object({target}).strict()},p=>call(()=>targets.list(p.target)));
  server.registerTool('session_open',{description:'Create/reopen persistent named storage and return a reusable target with implicit external access.',inputSchema:z.object({name,target}).strict()},(p,ctx)=>call(()=>targets.open(p.name,ctx.mcpReq.signal,p.target)));
  server.registerTool('session_select',{description:'Return a target without changing adapter defaults. Instance UUIDs stay pinned; stopped names reopen when used.',inputSchema:z.object({target,name:name.optional(),instance_id:z.string().uuid().optional()}).strict().refine(p=>(p.name===undefined)!==(p.instance_id===undefined),'Supply exactly one of name/instance_id')},p=>call(()=>targets.select(p,p.target)));
  const namespace=(p:any)=>{
    const selected=p.target??targets.startupTarget, t=selected?decodeTarget(selected):undefined;
    if(p.personal_root && t && p.personal_root!==t.personal_root)throw new Error('contradictory_target_namespace');
    if(p.name && t?.name && p.name!==t.name)throw new Error('contradictory_target_name');
    const selectedName=p.name??t?.name;
    if(!selectedName)throw new Error('named_session_required');
    return {repository:new SessionRepository(p.personal_root??t?.personal_root??targets.personalRoot),name:selectedName};
  };
  const lifecycle={target,name:name.optional(),personal_root:z.string().refine(v=>v.startsWith('/'),'Absolute personal root required').optional()};
  for(const tool of ['session_archives','session_recovery_list'])server.registerTool(tool,{description:'List retained generations offline in the selected named namespace.',inputSchema:z.object(lifecycle).strict()},p=>call(async()=>{const n=namespace(p);return n.repository.archives(n.name);}));
  server.registerTool('session_reset',{description:'Reset a closed named session; archive previous data and return recovery information.',inputSchema:z.object({...lifecycle,mode:z.enum(['inherit-personal','fresh'])}).strict()},p=>call(async()=>{const n=namespace(p);const session=await n.repository.replace(n.name,p.mode);const archives=await n.repository.archives(n.name);return {...session,recovery_id:archives[0]?.id,archives};}));
  server.registerTool('session_restore',{description:'Restore an archived closed named session, retaining displaced data.',inputSchema:z.object({...lifecycle,archive_id:z.string().uuid()}).strict()},p=>call(async()=>{const n=namespace(p);return n.repository.replace(n.name,'restore',p.archive_id);}));
  for(const operation of ['access_request','access_status','access_wait','access_cancel'])server.registerTool(operation,{
    description:'Request window-wide personal approval, inspect it, wait without retaining a gameplay command, or cancel a pending request. Named sessions have implicit access.',
    inputSchema:z.object({target,request_id:z.string().uuid().optional(),timeout_ms:z.number().int().min(1).max(60000).default(30000)}).strict()
  },(p,ctx)=>call(async()=>{
    const selected=await targets.client(p.target,ctx.mcpReq.signal),client=selected.client;
    let requestId:string|undefined;
    try {
      return await localRequestContext.run({signal:ctx.mcpReq.signal},async()=>{
        if(operation==='access_status')return {...await client.manage({operation}),target:selected.target};
        if(operation==='access_cancel')return {...await client.manage({operation,request_id:p.request_id}),target:selected.target};
        const requested=await client.manage({operation:'access_request',timeout_ms:p.timeout_ms,waiter:operation==='access_wait'});requestId=requested.request_id;
        if(operation==='access_request' || requested.state==='authorized')return {...requested,target:selected.target};
        const deadline=Date.now()+p.timeout_ms;
        while(Date.now()<deadline){
          ctx.mcpReq.signal.throwIfAborted();
          const status=await client.manage({operation:'access_wait'});
          if(status.state!=='pending')return {...status,target:selected.target};
          await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('cancelled'));};const timer=setTimeout(()=>{ctx.mcpReq.signal.removeEventListener('abort',abort);resolve();},100);ctx.mcpReq.signal.addEventListener('abort',abort,{once:true});});
        }
        throw new Error('access_timeout');
      });
    } finally {
      if(operation==='access_wait'&&requestId)await client.manage({operation:'access_cancel',request_id:requestId}).catch(()=>{});
      client.close();
    }
  }));
  return ()=>{for(const entry of pool.values())entry.client.close();pool.clear();fallback.close();};
}
