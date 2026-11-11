import {AsyncLocalStorage} from 'node:async_hooks';
import type {LocalServiceClient} from './local-endpoint.js';
import type {SessionIdentity} from './contracts.js';

/** Snapshot identity for each tools/call. Another call's status/load reply may
 * update the connection's latest identity without redirecting an awaiting call. */
export function requestIdentity(client:LocalServiceClient) {
  const scope=new AsyncLocalStorage<{identity?:SessionIdentity}>();
  let latest=client.identity;
  Object.defineProperty(client,'identity',{
    configurable:true,
    get(){const current=scope.getStore();return current?current.identity:latest;},
    set(identity:SessionIdentity|undefined){latest=identity;},
  });
  const request=client.request.bind(client);
  client.request=(async (...args:Parameters<typeof request>)=>{
    const reply=await request(...args);
    if(reply.ok){
      const identity={session:reply.session,epoch:reply.epoch};
      const current=scope.getStore();if(current)current.identity=identity;latest=identity;
    }
    return reply;
  }) as typeof client.request;
  return <T>(work:()=>Promise<T>)=>scope.run({identity:latest?{...latest}:undefined},work);
}
