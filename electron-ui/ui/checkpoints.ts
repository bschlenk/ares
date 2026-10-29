import {styleModalClose} from './modal-close.js';
import {dismissOnBackdrop} from './dialog-dismiss.js';
import {notify} from '../workspace/shell.js';
import {DEFAULT_CHECKPOINT_FORMAT,formatCheckpoint} from '../services/checkpoint-format.js';
import type {CheckpointEntry} from '../services/checkpoint-contracts.js';
export function installCheckpointControls() {
  const save=document.getElementById('video-save-state') as HTMLButtonElement;
  const load=document.getElementById('video-load-state') as HTMLButtonElement;
  const dialog=document.getElementById('state-browser') as HTMLDialogElement;
  const content=document.getElementById('state-grid')!;
  const feedback=document.getElementById('state-feedback')!;
  const invitation=document.getElementById('state-resume')!;
  let session='',format=DEFAULT_CHECKPOINT_FORMAT,seen='',dismissed=false,busy=false,revision=0,rootValue:unknown;
  let expires:ReturnType<typeof setTimeout>|undefined;
  const dismiss=()=>{dismissed=true;clearTimeout(expires);invitation.hidden=true;invitation.replaceChildren();};
  const request=(operation:'list'|'save'|'load'|'rename'|'delete'|'reveal',id?:string,name?:string)=>window.ares.checkpoints({operation,session,id,name});
  function errorText(error:unknown):string|null {
    const text=String(error);
    if(/checkpoint_session_changed|stale_session|stale_epoch/.test(text))return null;
    if(/ENOSPC/.test(text))return 'The storage device is full. Free some space and retry.';
    if(/ENOTDIR|ENOENT|EEXIST|EACCES|EPERM|invalid_storage_root/.test(text))return 'The save-state folder is unavailable. Choose a writable folder in Settings.';
    if(/configuration_mismatch|unsupported_version/.test(text))return 'This checkpoint uses incompatible core settings or a different serializer version.';
    if(/integrity_failed|invalid_checkpoint/.test(text))return 'This checkpoint is damaged and could not be loaded.';
    return text;
  }
  const action=async(run:()=>Promise<unknown>)=>{
    if(busy)return;busy=true;save.disabled=true;
    const token=session;
    try{await run()}catch(error){const message=errorText(error);if(token===session&&message){feedback.textContent=message;notify(message)}}finally{busy=false;void refresh()}
  };
  const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=run;return b};
  const date=(entry:CheckpointEntry)=>formatCheckpoint(new Date(entry.capturedAt),format);
  async function render() {
    const token=session,rev=++revision;
    feedback.textContent='Loading…';
    try {
      const entries:CheckpointEntry[]=await request('list');
      if(token!==session||rev!==revision||!dialog.open)return;
      content.replaceChildren();feedback.textContent=entries.length?'':'No save states yet.';
      let autosaves=false;
      for(const entry of entries){
        if(!entry.permanent&&!autosaves){const divider=document.createElement('h3');divider.textContent='Autosaves';content.append(divider);autosaves=true;}
        const card=document.createElement('article');card.className='state-card';
        const preview=button('',()=>{});preview.className='state-preview';preview.title='Double-click to load';preview.setAttribute('aria-label',`Load ${entry.name||date(entry)}`);
        const image=document.createElement('img');image.src=entry.screenshotUrl!;image.alt='Saved game position';image.loading='lazy';
        if(entry.screenshot.aspect){const aspect=entry.screenshot.aspect;image.style.objectFit='fill';image.style.width=aspect<4/3?`${aspect*75}%`:'100%';image.style.height=aspect>=4/3?`${400/(3*aspect)}%`:'100%'}
        preview.append(image);
        const doLoad=()=>void action(async()=>{await request('load',entry.id);if(token===session)dialog.close()});
        preview.ondblclick=doLoad;preview.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();doLoad()}};
        const label=document.createElement('strong');label.textContent=entry.name||date(entry);
        const time=document.createElement('time');time.dateTime=entry.capturedAt;time.textContent=entry.name?date(entry):'';
        const name=document.createElement('input');name.type='text';name.value=entry.name;name.maxLength=256;name.placeholder='Name this state';name.setAttribute('aria-label','State name');
        const rename=button('Rename',()=>void action(async()=>{await request('rename',entry.id,name.value);await render()}));
        const remove=button('Move to Trash',()=>void action(async()=>{await request('delete',entry.id);await render()}));
        const reveal=button(navigator.platform.toLowerCase().includes('mac')?'Reveal in Finder':'Reveal in folder',()=>void action(()=>request('reveal',entry.id)));
        const actions=document.createElement('div');actions.className='state-actions';actions.append(rename,reveal,remove);
        card.append(preview,label,time,name,actions);content.append(card);
      }
    }catch(error){if(token===session&&rev===revision)feedback.textContent=errorText(error)||''}
  }
  function open(){dismiss();if(!dialog.open)dialog.showModal();void render()}
  const close=document.getElementById('state-close') as HTMLButtonElement;styleModalClose(close);dismissOnBackdrop(dialog,()=>dialog.close());
  close.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>document.getElementById('screen')?.focus());
  load.onclick=open;save.onclick=()=>void action(async()=>{await request('save');notify('Save state created');if(dialog.open)await render()});
  async function refresh(){
    const status=await window.ares.checkpoints({operation:'status'});
    const next=status.session||'';
    if(next!==session){session=next;++revision;dialog.close();dismiss();dismissed=false;}
    save.disabled=busy||!status.available;load.disabled=!status.available;
    save.title=load.title=status.available?'':status.reason;
    if(!status.available||seen===session||!session)return;
    seen=session;const token=session;
    const remaining=10000-(Date.now()-status.loadedAt);
    if(remaining<=0)return;
    expires=setTimeout(dismiss,remaining);
    try{
      const entries:CheckpointEntry[]=await request('list');
      if(token!==session||dismissed||Date.now()-status.loadedAt>=10000)return;
      const latest=entries.filter(e=>!e.permanent).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];
      if(!latest)return;
      const image=document.createElement('img');image.src=latest.screenshotUrl!;image.alt='Latest autosave';
      if(latest.screenshot.aspect){const aspect=latest.screenshot.aspect;image.style.objectFit='fill';image.style.width=`${Math.min(96,72*aspect)}px`;image.style.height=`${Math.min(72,96/aspect)}px`}
      const label=document.createElement('span');label.textContent=`Continue from ${date(latest)}?`;
      invitation.replaceChildren(image,label,button('Resume',()=>{dismiss();void action(()=>request('load',latest.id))}),button('Choose different',open),button('Dismiss',dismiss));invitation.hidden=false;
    }catch(error){const message=errorText(error);if(token===session&&!dismissed&&message)notify(message)}
  }
  function preferences(snapshot:import('../settings/contracts.js').SettingsSnapshot){
    const root=snapshot.entries.find(e=>e.descriptor.id==='states.root')?.value;
    if(rootValue!==undefined&&root!==rootValue)dismiss();rootValue=root;
    const value=snapshot.entries.find(e=>e.descriptor.id==='states.dateFormat')?.value;
    format=typeof value==='string'?value:DEFAULT_CHECKPOINT_FORMAT;
    if(dialog.open)void render();
  }
  window.ares.preferences.changed(preferences);void window.ares.preferences.catalog().then(preferences);
  window.ares.onCheckpointsChanged(()=>void refresh());window.ares.onSessionState(()=>void refresh());
  void refresh();
}
