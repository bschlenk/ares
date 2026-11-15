/** Nonmodal prompt: never changes focus, pause state or controller ownership. */
export function installExternalAccess(){
  const prompt=document.createElement('aside');prompt.id='external-access-prompt';prompt.setAttribute('aria-live','polite');
  Object.assign(prompt.style,{position:'fixed',top:'42px',right:'16px',zIndex:'10000',background:'var(--panel-bg, #242424)',color:'white',padding:'12px',borderRadius:'8px',maxWidth:'360px'});
  const text=document.createElement('p');prompt.append(text);
  const decide=(label:string,action:'allow'|'deny')=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>{void window.ares.externalAccess(action);};prompt.append(button);};
  decide('Allow','allow');decide('Deny','deny');document.body.append(prompt);
  const banner=document.createElement('span');banner.id='external-access-banner';banner.append('External access allowed ');
  const revoke=document.createElement('button');revoke.textContent='Revoke';revoke.onclick=()=>{revoke.disabled=true;void window.ares.externalAccess('revoke').catch(error=>{revoke.disabled=false;console.error(error);});};banner.append(revoke);
  document.getElementById('video-controls')!.append(banner);
  const update=(state:Awaited<ReturnType<typeof window.ares.externalAccess>>)=>{
    prompt.hidden=state.implicit||state.state!=='pending';
    text.textContent=`Allow external inspection and control of ${state.game_title??'this window'} (${state.instance.slice(0,8)})? This allows all CLI and MCP clients until revoked or closed.`;
    banner.hidden=state.implicit||!['authorized','revoking'].includes(state.state);revoke.disabled=state.state==='revoking';
  };
  window.ares.onExternalAccess(update);void window.ares.externalAccess().then(update);
}
