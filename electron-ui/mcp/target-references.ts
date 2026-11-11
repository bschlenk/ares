import {ServiceError, type SessionIdentity} from '../services/contracts.js';
const fields=new Set(['operation_id','lease_id','result_handle','handle','observer_id','capture_id']);
export const referenceInputs=[...fields,'before','after','candidates'];
export interface TargetReference {target:string;identity?:SessionIdentity;value:string|number}
export function readReference(value:unknown):TargetReference|undefined {
  if(typeof value!=='string'||!value.startsWith('aresref1.'))return;
  try {
    const ref=JSON.parse(Buffer.from(value.slice(9),'base64url').toString());
    if(typeof ref.target!=='string'||!['string','number'].includes(typeof ref.value)||
      (ref.identity && (typeof ref.identity.session!=='string'||!Number.isSafeInteger(ref.identity.epoch))))throw new Error();
    return ref;
  }catch{throw new ServiceError('invalid_target_reference');}
}
export function scopeReferences(value:any,target:string,identity?:SessionIdentity):any {
  if(Array.isArray(value))return value.map(v=>scopeReferences(v,target,identity));
  if(!value||typeof value!=='object')return value;
  const ownIdentity=identity && Number.isSafeInteger(value.epoch) && value.epoch>0 ? {session:typeof value.session==='string'?value.session:identity.session,epoch:value.epoch} : identity;
  const result:Record<string,unknown>={};
  for(const [key,v] of Object.entries(value)) {
    result[key]=scopeReferences(v,target,ownIdentity);
    if(fields.has(key)&&v!==null&&v!==0&&['string','number'].includes(typeof v))
      result[key==='operation_id'?'operation_ref':key==='lease_id'?'lease_ref':key==='result_handle'?'result_ref':key+'_ref']='aresref1.'+Buffer.from(JSON.stringify({target,identity:['lease_id','result_handle'].includes(key)?undefined:ownIdentity,value:v})).toString('base64url');
  }
  return result;
}
export function inputReferences(params:Record<string,unknown>) {
  const refs:TargetReference[]=[];
  const values={...params};
  for(const [alias,key] of [['operation_ref','operation_id'],['lease_ref','lease_id'],['result_ref','result_handle']]) {
    if(values[alias]!==undefined){if(values[key]!==undefined)throw new ServiceError('contradictory_references');values[key]=values[alias];delete values[alias];}
  }
  for(const key of referenceInputs) {
    const ref=readReference(values[key]);
    if(ref){refs.push(ref);values[key]=ref.value;}
  }
  if(refs.some(ref=>ref.target!==refs[0].target))throw new ServiceError('contradictory_reference_targets');
  return {values,refs};
}
