const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('the supplied app artwork has a complete macOS icon resource',()=>{
 const root=path.resolve(__dirname,'../assets'),source=fs.readFileSync(path.join(root,'app-icon.png')),icon=fs.readFileSync(path.join(root,'Ares.icns'));assert.equal(source.subarray(1,4).toString(),'PNG');assert.equal(source.readUInt32BE(16),1254);assert.equal(source.readUInt32BE(20),1254);
 assert.equal(icon.toString('ascii',0,4),'icns');assert.equal(icon.readUInt32BE(4),icon.length);const entries=[];let at=8;while(at<icon.length){const length=icon.readUInt32BE(at+4);assert(length>=8&&at+length<=icon.length);entries.push(icon.toString('ascii',at,at+4));at+=length;}assert.equal(at,icon.length);for(const type of ['ic07','ic08','ic09','ic10'])assert(entries.includes(type),type);assert(entries.length>=8);
});
