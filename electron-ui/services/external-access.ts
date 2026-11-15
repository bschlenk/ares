import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {ServiceError} from './contracts.js';

export type AccessState = 'unapproved' | 'pending' | 'authorized' | 'revoking';
export interface AccessSnapshot {state: AccessState; generation: number; implicit: boolean; instance: string; game_title?: string; request_id?: string;}
/** Inherited by queues, native helpers and background jobs, including after a
 * transport request returns. A replacement grant never revives an old scope. */
export const externalWork = new AsyncLocalStorage<{guard: () => void}>();
export function guardExternalWork(): void { externalWork.getStore()?.guard(); }
export class ExternalAccessController {
  private state: AccessState;
  private generation = 0;
  private requests = new Map<string,{owner:string;expires:number;persistent:boolean}>();
  private timer = setInterval(()=>this.prune(),250);
  private revocation?: Promise<void>;
  constructor(readonly instance:string, readonly implicit:boolean, private changed:()=>void = ()=>{}, private title:()=>string|undefined = ()=>undefined) {
    this.state=implicit?'authorized':'unapproved';this.timer.unref();
  }
  snapshot():AccessSnapshot {this.prune();return {state:this.state,generation:this.generation,implicit:this.implicit,instance:this.instance,game_title:this.title()};}
  private prune(){let changed=false;for(const [id,r]of this.requests)if(r.expires<=Date.now()){this.requests.delete(id);changed=true;}if(changed)this.settle();}
  private settle(){if(!this.requests.size&&this.state==='pending')this.state='unapproved';this.changed();}
  request(owner:string, timeoutMs=30000, persistent=true):AccessSnapshot {
    this.prune();
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new ServiceError('invalid_deadline');
    if(this.state==='revoking')throw new ServiceError('access_revoking');
    if(this.state==='authorized')return this.snapshot();
    const prior=[...this.requests].find(([,r])=>r.owner===owner);
    if(prior)return {...this.snapshot(),request_id:prior[0]};
    if(this.requests.size>=32)throw new ServiceError('access_waiter_limit');
    const request_id=randomUUID();this.requests.set(request_id,{owner,expires:Date.now()+timeoutMs,persistent});this.state='pending';this.changed();
    return {...this.snapshot(),request_id};
  }
  cancel(id:string,owner:string){if(this.requests.has(id)){this.requests.delete(id);this.settle();}return this.snapshot();}
  disconnect(owner:string){for(const [id,r]of this.requests)if(r.owner===owner&&!r.persistent)this.requests.delete(id);this.settle();}
  decide(allow:boolean){if(this.implicit||this.state!=='pending')return;this.requests.clear();if(allow){++this.generation;this.state='authorized';}else this.state='unapproved';this.changed();}
  capture():()=>void {const generation=this.generation;this.assert(generation);return ()=>this.assert(generation);}
  private assert(generation:number){if(this.state!=='authorized'||generation!==this.generation)throw new ServiceError('access_required');}
  revoke(cleanup:()=>Promise<void>):Promise<void>{
    if(this.implicit)return Promise.reject(new ServiceError('implicit_access'));
    if(this.revocation)return this.revocation;
    ++this.generation;this.state='revoking';this.requests.clear();this.changed();
    // Failure deliberately leaves the gate revoking; no false cleanup success.
    this.revocation=cleanup().then(()=>{this.state='unapproved';this.changed();}).finally(()=>{this.revocation=undefined;});
    return this.revocation;
  }
  close(){clearInterval(this.timer);this.requests.clear();}
}
