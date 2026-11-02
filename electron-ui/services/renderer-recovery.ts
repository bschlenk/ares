/** Host-side recovery only. Never reset/load the native game to repair a renderer. */
export class RendererRecovery {
 private state:'starting'|'ready'|'crashed'|'reloading'='starting';
 private failure:{at:string;reason:string}|null=null;
 private pending:Promise<unknown>|null=null;
 private readyListeners=new Set<()=>void>();
 constructor(private readonly nativeIdentity:()=>unknown,private readonly reload:()=>void,private readonly timeoutMs=10000){}
 status(){return {state:this.state,last_failure:this.failure};}
 ready(){this.state='ready';for(const resolve of this.readyListeners)resolve();}
 loading(){this.state='reloading';}
 crashed(reason:string){this.state='crashed';this.failure={at:new Date().toISOString(),reason:reason.slice(0,1000)};}
 recover():Promise<unknown>{
  if(this.pending)return this.pending;
  if(this.state!=='crashed')return Promise.resolve({recovered:false,reason:this.state==='ready'?'already_healthy':'renderer_not_crashed',renderer:this.status()});
  const before=this.nativeIdentity();if(!before)return Promise.resolve({recovered:false,reason:'native_session_unavailable',renderer:this.status()});
  this.state='reloading';
  const work=new Promise<unknown>((resolve,reject)=>{
   let timer:ReturnType<typeof setTimeout>;
   const finish=(ready:boolean)=>{clearTimeout(timer);this.readyListeners.delete(onReady);const preserved=JSON.stringify(before)===JSON.stringify(this.nativeIdentity());resolve({recovered:ready&&preserved,reason:!preserved?'native_session_changed':ready?'renderer_ready':'timeout',native_preserved:preserved,renderer:this.status()});};
   const onReady=()=>finish(true);this.readyListeners.add(onReady);timer=setTimeout(()=>finish(false),this.timeoutMs);
   try{this.reload();}catch(error){clearTimeout(timer);this.readyListeners.delete(onReady);this.crashed(String(error));reject(error);}
  });
  this.pending=work;void work.finally(()=>{this.pending=null;}).catch(()=>{});return work;
 }
}
