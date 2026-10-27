// Preserve the supplied artwork; produce all standard macOS icon resolutions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('macOS sips/iconutil are required');
const root=path.resolve(import.meta.dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ares-icon-')),iconset=path.join(temporary,'Ares.iconset');
try{
 fs.mkdirSync(iconset);
 for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('sips',['-s','format','png','-z',String(size*scale),String(size*scale),path.join(root,'assets/app-icon.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
 execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(root,'assets/Ares.icns')]);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
