import { randomUUID, createHash } from 'node:crypto';
import { ServiceError, type SessionIdentity } from './contracts.js';

export class ScriptResults {
  private values=new Map<string,{handle:string;operation_id:number;identity:SessionIdentity;data:Buffer;page:any;expires:number;sha256:string;consumed?:boolean}>();
  private expired=new Set<string>();
  private released=new Set<string>();
  private reservations=new Set<string>();
  consume(handle:string){this.read({handle});this.values.get(handle)!.consumed=true;return {consumed:true};}
  abort(handle:string){this.reservations.delete(handle);}
  release(handle:string){this.read({handle});this.values.delete(handle);this.released.add(handle);while(this.released.size>64)this.released.delete(this.released.values().next().value!);return {released:true};}
  reserve(){this.prune();for(const [key,value]of this.values){if(this.values.size+this.reservations.size<16&&this.bytes+(this.reservations.size+1)*4*1024*1024<=16*1024*1024)break;if(value.consumed){this.values.delete(key);this.expired.add(key);}}if(this.values.size+this.reservations.size>=16||this.bytes+(this.reservations.size+1)*4*1024*1024>16*1024*1024)throw new ServiceError('script_result_backpressure');const handle=randomUUID();this.reservations.add(handle);return handle;}
  private get bytes(){return [...this.values.values()].reduce((n,v)=>n+v.data.length,0);}
  private prune(){for(const [k,v]of this.values)if(v.expires<Date.now()){this.values.delete(k);this.expired.add(k);}while(this.expired.size>64)this.expired.delete(this.expired.values().next().value!);}
  publish(handle:string,operation_id:number,identity:SessionIdentity,data:Buffer,page:any){this.prune();this.reservations.delete(handle);if(this.values.size>=16||this.bytes+data.length>16*1024*1024)throw new ServiceError('script_result_backpressure');this.values.set(handle,{handle,operation_id,identity:{...identity},data:Buffer.from(data),page:{...page,hex:''},expires:Date.now()+15*60*1000,sha256:createHash('sha256').update(data).digest('hex')});}
  read(p:{handle?:string;operation_id?:number;offset?:number;length?:number},scope?:SessionIdentity){
    this.prune();const offset=p.offset??0,length=p.length??16384;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>16384)throw new ServiceError('invalid_request');
    let result=p.handle?this.values.get(p.handle):undefined;
    if(p.handle&&!result)throw new ServiceError(this.expired.has(p.handle)?'script_result_expired':this.released.has(p.handle)?'script_result_released':'unknown_script_result');
    if(!p.handle){if(!scope)throw new ServiceError('no_script_result');const candidates=[...this.values.values()].filter(v=>v.identity.session===scope.session&&(!p.operation_id||v.operation_id===p.operation_id));if(p.operation_id&&candidates.length>1)throw new ServiceError('ambiguous_script_result');result=candidates.at(-1);}
    if(!result)throw new ServiceError('no_script_result');
    if(offset>result.data.length)throw new ServiceError('invalid_request');
    return {...result.page,result_handle:result.handle,operation_id:result.operation_id,...result.identity,hex:result.data.subarray(offset,offset+length).toString('hex'),bytes:result.data.length,sha256:result.sha256,expires_at:new Date(result.expires).toISOString()};
  }
}
