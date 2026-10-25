import { randomUUID } from 'node:crypto';
import { ServiceError, type SessionClient } from './contracts.js';
/** Explicit opt-in ownership across authenticated local connections. */
export class OwnerLeases {
  private leases=new Map<string,{owner:string;expires:number;name:string}>();
  private timer=setInterval(()=>this.prune(),250);
  constructor(private client:SessionClient){this.timer.unref();}
  private revoke(id:string){const lease=this.leases.get(id);if(!lease)return;this.leases.delete(id);void this.client.request('execution.release',undefined,undefined,lease.owner).catch(()=>{});}
  private prune(){for(const [id,l]of this.leases)if(l.expires<=Date.now())this.revoke(id);}
  owner(id:string){this.prune();const l=this.leases.get(id);if(!l)throw new ServiceError('owner_lease_expired');return l.owner;}
  manage(p:any){
    this.prune();
    if(p.action==='list')return {leases:[...this.leases].map(([lease_id,l])=>({lease_id,name:l.name,expires_at:new Date(l.expires).toISOString()}))};
    if(p.action==='create'){
      if(this.leases.size>=8)throw new ServiceError('owner_lease_limit');
      if(typeof p.name!=='string'||!p.name.length||p.name.length>64||!Number.isInteger(p.seconds)||p.seconds<1||p.seconds>600)throw new ServiceError('invalid_request');
      const lease_id=randomUUID(),l={owner:randomUUID(),expires:Date.now()+p.seconds*1000,name:p.name};this.leases.set(lease_id,l);
      return {lease_id,name:l.name,expires_at:new Date(l.expires).toISOString()};
    }
    this.owner(p.lease_id);
    if(p.action==='use')return {lease_id:p.lease_id,selected:true};
    if(p.action==='release'){this.revoke(p.lease_id);return {released:true};}
    throw new ServiceError('invalid_request');
  }
  close(){clearInterval(this.timer);for(const id of this.leases.keys())this.revoke(id);}
}
