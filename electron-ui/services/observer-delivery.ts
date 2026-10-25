import type { ObserverSample, ObserverDelivery } from './observer-contracts.js';
/** One acknowledged IPC delivery plus one latest value per native observer. */
export class ObserverDeliveries {
  private serial=0;
  private entries=new Map<string,{owner:string;id:number;outstanding:number;last:number;nativeSkipped:number;latest?:ObserverSample}>();
  constructor(private valid:(owner:string)=>boolean,private send:(event:ObserverDelivery)=>void){}
  private key(owner:string,id:number){return owner+':'+id;}
  clear(){this.entries.clear();}
  publish(sample:ObserverSample){
    for(const [key,e]of this.entries)if(!this.valid(e.owner))this.entries.delete(key);
    if(!this.valid(sample.owner))return;
    const key=this.key(sample.owner,sample.observer_id);
    let entry=this.entries.get(key);
    if(!entry){if(this.entries.size>=8)return;entry={owner:sample.owner,id:sample.observer_id,outstanding:0,last:0,nativeSkipped:0};this.entries.set(key,entry);}
    if(sample.sequence<=entry.last)return;
    entry.latest=sample;
    this.deliver(entry);
  }
  ack(owner:string,id:number,delivery:number){
    const e=this.entries.get(this.key(owner,id));if(!e||e.outstanding!==delivery||!this.valid(owner))return;
    e.outstanding=0;this.deliver(e);
  }
  stop(owner:string,id:number){this.entries.delete(this.key(owner,id));}
  private deliver(entry:{outstanding:number;last:number;nativeSkipped:number;latest?:ObserverSample}){
    if(entry.outstanding||!entry.latest)return;
    const sample=entry.latest;entry.latest=undefined;
    const nativeSkipped=sample.native_skipped??0;const skipped=Math.max(0,sample.sequence-entry.last-1)+Math.max(0,nativeSkipped-entry.nativeSkipped);entry.nativeSkipped=nativeSkipped;entry.last=sample.sequence;
    entry.outstanding=++this.serial;this.send({...sample,delivery:entry.outstanding,skipped});
  }
}
