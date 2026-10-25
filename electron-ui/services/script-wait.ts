import { ServiceError, type ExecutionOperation, type SessionIdentity } from './contracts.js';
import type { LocalServiceClient } from './local-endpoint.js';

/** Validate an epoch transition against main's record of this job's owned loads. */
export async function scriptStatus(client:LocalServiceClient, operationId:number, identity:SessionIdentity) {
  let reply=await client.request('execution.status',identity,{operationId});
  if(!reply.ok&&reply.error==='stale_epoch') {
    const fresh=await client.request('session.status');
    if(!fresh.ok||!fresh.result)throw new ServiceError(fresh.error??'invalid_reply');
    if(fresh.session!==identity.session)throw new ServiceError('stale_session');
    const next={session:fresh.session,epoch:fresh.epoch};
    reply=await client.request('execution.status',next,{operationId});
    if(!reply.ok||!reply.result)throw new ServiceError(reply.error??'invalid_reply');
    const lineage=(reply.result as any).script_lineage;
    if(lineage?.session!==identity.session||!Array.isArray(lineage.epochs)||!lineage.epochs.includes(identity.epoch)||!lineage.epochs.includes(next.epoch))throw new ServiceError('external_epoch_transition');
    identity.epoch=next.epoch;
  }
  if(!reply.ok||!reply.result)throw new ServiceError(reply.error??'invalid_reply');
  return reply.result;
}
export async function waitForScript(client:LocalServiceClient, started:ExecutionOperation, identity:SessionIdentity, options:{signal?:AbortSignal;timeoutMs?:number}={}) {
  const until=Date.now()+(options.timeoutMs??610000);
  const cancel=()=>{void scriptStatus(client,started.operation_id,identity).then(()=>client.request('execution.cancel',identity,{operationId:started.operation_id})).catch(()=>{});};
  options.signal?.addEventListener('abort',cancel,{once:true});
  try {
    let final=started;
    while(final.state==='running'||(final as any).script_output?.state==='pending'||(final as any).script_result?.state==='pending') {
      if(options.signal?.aborted){cancel();throw new ServiceError('cancelled');}
      if(Date.now()>=until)throw new ServiceError('script_wait_timeout');
      await new Promise(resolve=>setTimeout(resolve,20));
      final=await scriptStatus(client,started.operation_id,identity);
    }
    if((final as any).script_result?.state==='failed')throw new ServiceError('script_result_failed: '+((final as any).script_result.error??'transfer failed'));
    if((final as any).script_output?.state==='failed')throw new ServiceError('script_output_failed: '+((final as any).script_output.error??'publication failed'));
    return final;
  }finally{options.signal?.removeEventListener('abort',cancel);}
}
