import {app, BrowserWindow, Menu} from 'electron';
import {appContext, preferences, sessions} from '../dist/main.js';
const until=async check=>{for(let i=0;i<500;i++){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,20));}throw Error('window timeout');};
app.whenReady().then(async()=>{
  try {
    const window=await until(()=>BrowserWindow.getAllWindows()[0]);
    await until(()=>window.webContents.executeJavaScript("typeof window.ares !== 'undefined'"));
    await until(async()=>{try{return (await sessions.request('session.status')).result;}catch{return false;}});
    console.log('PERSONAL_READY '+JSON.stringify(appContext));
    process.on('message',async message=>{
      try {
        if(message.operation==='new') {
          // Deliberately poison inherited selection/game overrides. The launch
          // helper must clear them while retaining the isolated personal root.
          process.env.ARES_SESSION_NAME='parent';process.env.ARES_INSTANCE_NAME='parent';
          process.env.ARES_SAVE_DIR='/not-the-personal-root';process.env.ARES_ROM='/missing-parent-rom';
          const item=Menu.getApplicationMenu().items.find(i=>i.label==='File').submenu.items.find(i=>i.label==='New Window');
          item.click();process.send?.({id:message.id,ok:true});
        } else if(message.operation==='set') {
          await preferences.set(message.key,message.value);process.send?.({id:message.id,ok:true});
        } else if(message.operation==='snapshot') {
          process.send?.({id:message.id,snapshot:preferences.catalog(),theme:await window.webContents.executeJavaScript('document.body.dataset.theme'),status:(await sessions.request('session.status')).result});
        }
      }catch(error){process.send?.({id:message.id,error:String(error)});}
    });
  }catch(error){console.error(error);app.exit(1);}
});
