import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.env.ARES_DIAGNOSTIC_PROFILE;
assert(root,'ARES_DIAGNOSTIC_PROFILE is required');
process.env.ARES_PROFILE_DIR=root;
process.env.ARES_SERVICE_DIR=path.join(root,'ipc');
process.env.ARES_BACKGROUND_TEST='1';
process.env.ARES_ENABLE_SERVICES='1';
process.env.ARES_DISABLE_PLUGINS='1';
delete process.env.ARES_ROM;
const {sessions,serviceHost}=await import('../dist/main.js');
const {LocalServiceClient}=await import('../dist/services/local-endpoint.js');
app.whenReady().then(async()=>{
for(let i=0;i<200&&!serviceHost.metadataFile;i++)await new Promise(r=>setTimeout(r,20));
const client=new LocalServiceClient(serviceHost.metadataFile,serviceHost.instance);
process.stderr.emit('error',Object.assign(new Error('closed pipe'),{code:'EPIPE'}));
sessions.detach();
const health=await client.manage({operation:'app_health'});assert.equal(health.native.connected,false);
const logs=await client.manage({operation:'app_logs'});assert.equal(logs.directory,path.join(fs.realpathSync(root),'logs'));
fs.writeFileSync(path.join(root,'checked.json'),JSON.stringify({health,logs}));client.close();
setImmediate(()=>{throw new Error('diagnostic fatal acceptance stack');});

}).catch(error=>{console.error(error);app.exit(2);});
