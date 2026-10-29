import type {AresBridge} from '../bridge.js';
import type {DemonstrationStatus} from '../services/demonstration-contracts.js';

/** Compact controls share the playback toolbar; the prompt remains available to AT/hover. */
export function installDemonstrationControls(bridge:AresBridge, controls:HTMLElement,
  changed:(visible:boolean)=>void, notify:(message:string)=>void) {
  const record=controls.querySelector<HTMLButtonElement>('#video-record')!;
  const cancel=controls.querySelector<HTMLButtonElement>('#video-record-cancel')!;
  const description=controls.querySelector<HTMLElement>('#recording-description')!;
  let previous:DemonstrationStatus|undefined, polling=false, acting=false;
  const update=(status?:DemonstrationStatus)=>{
    const failed=status?.publication==='failed', saving=status?.publication==='finalizing';
    const active=!!status&&(['armed','recording','replaying'].includes(status.state)||failed||saving);
    controls.hidden=!active;changed(active);
    if(!status||!active){previous=status;return;}
    const recording=status.state==='recording', armed=status.state==='armed';
    const label=failed?'Retry saving':saving?'Saving recording':armed?'Start recording':recording?'Stop recording':'Replaying recording';
    const hint=armed?(status.input_start_ready?'Press a controller button or move the stick to start.':'Release controls to enable input start.'):recording?'Stop to save the recording.':saving?'Saving the recording.':failed?'Retry saving the retained recording.':'Replay is in progress.';
    description.textContent=`${label}. ${status.prompt}${armed?' '+hint:''}`;
    record.setAttribute('aria-label',label);record.setAttribute('aria-pressed',String(recording));
    record.title=`${label} — ${status.prompt} ${hint}`;
    record.dataset.method=failed?'artifact.inputRetry':armed?'n64.demo.start':'n64.demo.stop';
    record.dataset.state=failed?'retry':saving?'saving':armed?'armed':recording?'recording':'replaying';
    record.disabled=acting||saving||status.state==='replaying';
    record.querySelector('.record-icon')!.toggleAttribute('hidden',!armed);
    record.querySelector('.stop-icon')!.toggleAttribute('hidden',armed||failed);
    record.querySelector('.retry-icon')!.toggleAttribute('hidden',!failed);
    cancel.hidden=!['armed','recording','replaying'].includes(status.state);
    cancel.disabled=acting;cancel.title=`Cancel recording — ${status.prompt}`;
    if(previous?.job_id===status.job_id&&previous.publication!=='failed'&&failed)notify('Recording could not be saved. Use Retry saving.');
    previous=status;
  };
  const refresh=async()=>{
    if(polling||acting)return;polling=true;
    try{
      const session=await bridge.session('session.status');if(!session.ok){update();return;}
      const reply=await bridge.session('n64.demo.status',{session:session.session,epoch:session.epoch});
      const status=reply.ok?reply.result:undefined;
      if(previous&&status?.job_id===previous.job_id&&previous.publication!=='committed'&&status.publication==='committed')notify('Recording saved.');
      update(status);
    }catch{update();}finally{polling=false;}
  };
  const action=async(button:HTMLButtonElement)=>{
    if(acting)return;acting=true;record.disabled=cancel.disabled=true;button.blur();
    try{
      const session=await bridge.session('session.status');if(!session.ok)throw Error(session.error);
      const method=button===cancel?'n64.demo.cancel':record.dataset.method as 'n64.demo.start'|'n64.demo.stop'|'artifact.inputRetry';
      const reply=await bridge.session(method,{session:session.session,epoch:session.epoch});if(!reply.ok)throw Error(reply.error);
      if(method==='n64.demo.start')controls.closest('#viewport')?.querySelector<HTMLCanvasElement>('canvas')?.focus({preventScroll:true});
    }catch(error){notify(error instanceof Error?error.message:String(error));}
    finally{acting=false;await refresh();}
  };
  record.onclick=()=>{void action(record);};cancel.onclick=()=>{void action(cancel);};
  const timer=setInterval(()=>{void refresh();},250);void refresh();
  return ()=>{clearInterval(timer);record.onclick=cancel.onclick=null;};
}
