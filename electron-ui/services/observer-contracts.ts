import type { FrameReference } from './frame-contracts.js';
export interface ObserverSample {
  event:'observer_sample';session:string;epoch:number;owner:string;observer_id:number;
  sequence:number;native_skipped?:number;frame_reference:FrameReference;value:unknown;error:string;
}
export interface FrameSample {
  observerId:number;sequence:number;frame:FrameReference;value:unknown;skipped:number;
}
export interface ObserverDelivery extends ObserverSample { delivery:number;skipped:number }
export function validObserverSample(p:any):p is ObserverSample {
  return p?.event==='observer_sample'&&typeof p.session==='string'&&typeof p.owner==='string'&&p.owner.length<=96&&Number.isSafeInteger(p.epoch)&&p.epoch>0&&Number.isSafeInteger(p.observer_id)&&p.observer_id>0&&Number.isSafeInteger(p.sequence)&&p.sequence>=0&&typeof p.error==='string'&&p.error.length<=4096&&p.frame_reference?.native_session===p.session&&p.frame_reference?.epoch===p.epoch;
}
