export async function refreshSessions(container: HTMLElement) {
  container.replaceChildren();
  const message = document.createElement('p'); message.setAttribute('role','status'); container.append(message);
  const run = async (operation: () => Promise<unknown>) => {
    try { await operation(); await refreshSessions(container); }
    catch (error) { message.textContent = String(error); }
  };
  const button = (text: string, action: () => void) => {const b=document.createElement('button');b.textContent=text;b.onclick=action;return b;};
  try {
    const sessions: {name:string}[] = await window.ares.sessionData({operation:'list'});
    if (!sessions.length) message.textContent='No named sessions yet.';
    for (const {name} of sessions) {
      const row=document.createElement('section'), title=document.createElement('h3');title.textContent=name;row.append(title);
      for (const [mode,label] of [['inherit-personal','Fresh clone of personal'],['fresh','Start empty']] as const) {
        row.append(button(label,()=>void run(()=>window.ares.sessionData({operation:'reset',name,mode}))));
      }
      const restore=document.createElement('details'), summary=document.createElement('summary');summary.textContent='Restore previous data';restore.append(summary);
      const archives: {id:string;timestamp:string;mode:string}[] = await window.ares.sessionData({operation:'archives',name});
      if(!archives.length)restore.append('No previous data archived.');
      for(const archive of archives)restore.append(button(`${new Date(archive.timestamp).toLocaleString()} · ${archive.mode} · ${archive.id}`,()=>void run(()=>window.ares.sessionData({operation:'restore',name,archiveId:archive.id}))));
      row.append(restore);container.append(row);
    }
  } catch(error) {message.textContent=String(error);}
}
