// Projection/camera visualization derived from frozen, verified RSP state.
export function camera(persp, view) {
  if (!persp || !view) return null
  const s = -persp[11] || 1 // guPerspective's "scale" multiplies every element
  const p = Array.from(persp, (x) => x / s)
  const fovy = (2 * Math.atan(1 / p[5]) * 180) / Math.PI
  const aspect = p[5] / p[0]
  const A = p[10],
    B = p[14] // (n+f)/(n-f), 2nf/(n-f)
  const near = B / (A - 1),
    far = B / (A + 1)
  // view = [R | 0; t 1] with R's columns = camera right/up/back in world space
  const R = (i, j) => view[i * 4 + j]
  const t = [view[12], view[13], view[14]]
  const eye = [0, 1, 2].map(
    (i) => -(t[0] * R(i, 0) + t[1] * R(i, 1) + t[2] * R(i, 2)),
  )
  const fwd = [-R(0, 2), -R(1, 2), -R(2, 2)]
  const up = [R(0, 1), R(1, 1), R(2, 1)]
  const yaw = (Math.atan2(fwd[0], fwd[2]) * 180) / Math.PI
  const pitch = (Math.asin(Math.max(-1, Math.min(1, fwd[1]))) * 180) / Math.PI
  return { eye, fwd, up, yaw, pitch, fovy, aspect, near, far }
}


export function matrix(raw) {
  const half=(offset)=>parseInt(raw.slice(offset,offset+4),16);
  return Array.from({length:16},(_,i)=>((half(i*4)<<16)|half(64+i*4))/65536);
}
export function viewport(raw) {
  const half=i=>(parseInt(raw.slice(i*4,i*4+4),16)<<16>>16)/4;
  return {sx:half(0),sy:half(1),tx:half(4),ty:half(5)};
}
// A joint origin is a derived visualization, not an observed vertex/pixel.
// Prefer the actual combined matrix computed at G_VTX; never rebuild a matrix stack.
export function projectState(s, useCombined=false) {
  const m=matrix(s.modelview_raw),p=matrix(s.projection_raw),vp=viewport(s.viewport_raw);
  const c=useCombined&&s.combined_raw?matrix(s.combined_raw).slice(12):[0,1,2,3].map(j=>m.slice(12).reduce((sum,v,k)=>sum+v*p[k*4+j],0));
  if(c[3]<=1e-6||!vp.sx||!vp.sy)return null;
  const point={x:vp.tx+c[0]/c[3]*vp.sx,y:vp.ty-c[1]/c[3]*vp.sy,z:c[2]/c[3]};
  return Object.values(point).every(Number.isFinite)?point:null;
}
export function bindCapture(capture,sample) {
  const a=capture.frame_reference,b=sample.frame;
  return !!a&&a.native_session===b.native_session&&a.epoch===b.epoch&&a.origin===b.origin&&a.origin_commit===b.origin_commit&&b.vi===a.vi;
}
export function describeCapture(capture,sample) {
  if(!bindCapture(capture,sample))return {matched:false,objects:[],camera:null,partial:true,reason:'Capture does not match this VI origin.'};
  const candidates=new Set(sample.frame.task_candidates??[]),tasks=new Map(),nodes=[];
  let omitted=0,cam=null;
  for(const r of capture.entries){
    if(!candidates.has(r.task_id))continue;
    let task=tasks.get(r.task_id);if(!task)tasks.set(r.task_id,task={slots:[],persp:null,view:null});
    const s=r.state,p=(parseInt(r.word0,16)&255)^1;
    if(!r.command_complete||!s||s.depth===null){task.slots=[];++omitted;continue;}
    if(p&4){
      if(p&2){task.persp=matrix(s.projection_raw);task.perspRaw=s.projection_raw;task.view=null;}
      else if(r.operand_raw&&!task.view){task.view=matrix(r.operand_raw);const decoded=task.persp&&task.persp[11]!==0?camera(task.persp,task.view):null;cam=decoded?{...decoded,perspective_raw:task.perspRaw,view_raw:r.operand_raw}:null;}
      else {task.view=null;cam=null;}
      continue;
    }
    const depth=s.depth,push=!!(p&1),load=!!(p&2);
    // Actual stack depth establishes ancestry. Unknown/missing slots stay roots.
    const parentDepth=push?r.before_depth:load?depth-1:depth;
    if(parentDepth===null||parentDepth>0&&task.slots[parentDepth]===undefined)++omitted;
    let parent=parentDepth===null?-1:(task.slots[parentDepth]??-1);
    const seg4=parseInt(s.segment4,16)>>>0;
    // Model segment changes establish object boundaries, not a GPU bone ABI.
    if(parent>=0&&nodes[parent].seg4!==seg4)parent=-1;
    const source=r.vertex_state??s,m=matrix(s.modelview_raw);
    const node={seq:r.seq,taskId:r.task_id,seg4,parent,depth,matrix:m,world:m.slice(12,15),screen:projectState(source,!!r.vertex_state),projection:r.vertex_state?'rsp_combined_at_vertex_load':'derived_from_rsp_matrices',vertexBatches:r.vertex_batches,matrixRaw:s.modelview_raw,projectionRaw:source.projection_raw,combinedRaw:source.combined_raw,viewportRaw:source.viewport_raw,stateId:s.id,vertexStateId:r.vertex_state?.id??null};
    nodes.push(node);task.slots.length=depth+1;task.slots[depth]=nodes.length-1;
  }
  const groups=new Map();
  nodes.forEach((node,index)=>{let root=index;while(nodes[root].parent>=0)root=nodes[root].parent;if(!groups.has(root))groups.set(root,[]);groups.get(root).push(index);});
  let best=null;
  const objects=[...groups].map(([root,indices])=>{
    const n=nodes[root],distance=sample.value.kirby?Math.hypot(...n.world.map((v,k)=>v-sample.value.kirby[k])):Infinity;
    const object={key:`${n.taskId}:${n.seq}`,name:`model @0x${n.seg4.toString(16)}`,seg4:n.seg4,root:0,taskId:n.taskId,joints:indices.map(i=>({...nodes[i],parent:indices.indexOf(nodes[i].parent)}))};
    if(indices.length>=4&&distance<60&&(!best||distance<best.distance))best={object,distance};return object;
  });
  const seen=new Map();for(const object of objects){const id=`${object.seg4}:${object.joints.length}`,occurrence=(seen.get(id)??0)+1;seen.set(id,occurrence);object.key=`model:${id}:${occurrence}`;}
  if(best){best.object.name='Kirby';best.object.key='kirby';}
  const partial=capture.truncated||capture.matrix_overflow||omitted>0;
  return {matched:true,objects,camera:cam,partial,omitted,reason:objects.length?'':'No verified model matrices for the scanout task candidates.',mapping:'candidate_only',projection:'derived_joint_origins',generation:capture.generation};
}

// Validate every page belongs to the same immutable generation. Never reread RAM.
export async function readCapture(request,generation) {
  let page=await request('n64.capture.transforms',{generation,offset:0,limit:32});
  const first=page,entries=[...page.entries];
  while(page.next_offset!==null){
    page=await request('n64.capture.transforms',{generation:first.generation,offset:page.next_offset,limit:32});
    if(page.generation!==first.generation||page.epoch!==first.epoch||page.retained!==first.retained||JSON.stringify(page.frame_reference)!==JSON.stringify(first.frame_reference))throw Error('inconsistent_capture');
    entries.push(...page.entries);
  }
  if(entries.length!==first.retained)throw Error('incomplete_capture');
  return {...first,entries};
}
