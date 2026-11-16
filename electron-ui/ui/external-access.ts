import type {WindowPresentation} from '../sessions/presentation.js';
/** Nonmodal prompt: never changes focus, pause state or controller ownership. */
export function installExternalAccess(){
  const prompt=document.createElement('aside');prompt.id='external-access-prompt';prompt.dataset.captureExclude='';prompt.hidden=true;prompt.setAttribute('aria-live','polite');
  const text=document.createElement('p');prompt.append(text);
  const decide=(label:string,action:'allow'|'deny')=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>{void window.ares.externalAccess(action);};prompt.append(button);};
  decide('Allow','allow');decide('Deny','deny');document.body.append(prompt);
  const banner=document.createElement('span');banner.id='external-access-banner';banner.dataset.captureExclude='';banner.hidden=true;
  const explanation=document.createElement('span');explanation.textContent='External clients can access real personal settings and saves. ';banner.append(explanation);
  const revoke=document.createElement('button');revoke.textContent='Revoke';revoke.onclick=()=>{revoke.disabled=true;void window.ares.externalAccess('revoke').catch(error=>{revoke.disabled=false;console.error(error);});};banner.append(revoke);
  const named=document.createElement('span');named.id='named-session-banner';named.dataset.captureExclude='';named.hidden=true;
  document.getElementById('video-controls')!.append(named,banner);
  return (snapshot:WindowPresentation)=>{
    const state=snapshot.access;
    prompt.hidden=state.implicit||state.state!=='pending';
    text.textContent=`Allow external inspection and control of ${state.game_title??'this window'} (${state.instance.slice(0,8)})? All CLI and MCP clients can modify your real personal settings and saves until revoked or closed.`;
    named.hidden=snapshot.kind!=='named';named.textContent=`Session: ${snapshot.sessionName??''}`;
    banner.hidden=state.implicit||!['authorized','revoking'].includes(state.state);revoke.disabled=state.state==='revoking';
  };
}
