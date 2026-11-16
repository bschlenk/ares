import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {profileRoot} from '../profile.js';
import {LocalServiceClient, defaultServiceDirectory} from '../services/local-endpoint.js';
import {AutomaticServiceClient} from '../services/automatic-client.js';
import {ServiceError} from '../services/contracts.js';
import {SessionRepository} from './repository.js';
import {openNamedWindow, type LaunchInstallation} from './launching.js';
import {discoverInstances} from './discovery.js';
import {sessionName} from './context.js';

export type Target = {version:1; personal_root:string; directory:string; instance?:string; name?:string};
export const encodeTarget = (target:Target) => 'ares1.'+Buffer.from(JSON.stringify(target)).toString('base64url');
export function decodeTarget(value:string):Target {
  try {
    if(!value.startsWith('ares1.') || value.length>16384) throw new Error();
    const t=JSON.parse(Buffer.from(value.slice(6),'base64url').toString());
    if(t.version!==1 || typeof t.personal_root!=='string' || !path.isAbsolute(t.personal_root) || typeof t.directory!=='string' || !path.isAbsolute(t.directory) ||
      (t.instance!==undefined ? !(typeof t.instance==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(t.instance)) || t.name!==undefined : typeof t.name!=='string')) throw new Error();
    if(t.name!==undefined) sessionName(t.name);
    return t;
  } catch { throw new ServiceError('invalid_target'); }
}
export function defaultPersonalRoot():string {
  return process.env.ARES_PROFILE_DIR || profileRoot(process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support'):path.join(os.homedir(),'.config'),process.env.ARES_PROFILE);
}
export function currentInstallation():LaunchInstallation {
  const appRoot=fileURLToPath(new URL('../../',import.meta.url));
  const packaged=appRoot.includes(`${path.sep}Contents${path.sep}Resources${path.sep}`);
  return {appRoot,packaged,executable:packaged?path.resolve(appRoot,'../../MacOS/Ares'):process.versions.electron?process.execPath:path.join(appRoot,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')};
}
/** A handle is a selector, never an authorization credential. No global selection. */
export class Targets {
  readonly personalRoot:string;
  constructor(readonly directory=process.env.ARES_SERVICE_DIR??defaultServiceDirectory(), personalRoot=defaultPersonalRoot(), readonly startupTarget?:string, readonly legacyName?:string) {
    this.personalRoot=fs.existsSync(personalRoot)?fs.realpathSync(personalRoot):path.resolve(personalRoot);
  }
  private namespace(handle?:string) {
    const chosen=handle??this.startupTarget;
    return chosen?decodeTarget(chosen):{personal_root:this.personalRoot,directory:this.directory};
  }
  async list(handle?:string) { const n=this.namespace(handle); return {sessions:await new SessionRepository(n.personal_root).list(),instances:await discoverInstances(n.directory)}; }
  async select(p:{instance_id?:string;name?:string}, handle?:string) {
    if((p.instance_id!==undefined)===(p.name!==undefined)) throw new ServiceError('ambiguous_target');
    const n=this.namespace(handle);
    const base={version:1 as const,personal_root:n.personal_root,directory:n.directory};
    if(p.instance_id) {
      const instance=(await discoverInstances(n.directory)).find(i=>i.instance===p.instance_id);
      if(!instance) throw new ServiceError('app_disconnected');
      return {target:encodeTarget({...base,instance:p.instance_id}),instance};
    }
    const session=(await new SessionRepository(n.personal_root).list()).find(s=>s.name===p.name);
    if(!session) throw new ServiceError('session_not_found');
    return {target:encodeTarget({...base,name:session.name}),session};
  }
  async open(name:string,signal?:AbortSignal,handle?:string) {
    const n=this.namespace(handle);
    const owner=await openNamedWindow(new SessionRepository(n.personal_root),name,currentInstallation(),signal);
    return {...await this.select({name},handle),instance_id:owner.instanceId};
  }
  async client(handle?:string, signal?:AbortSignal):Promise<{key:string;client:LocalServiceClient;target:string}> {
    signal?.throwIfAborted();
    const chosen=handle??this.startupTarget;
    if(!chosen && this.legacyName) return {key:'legacy:'+this.legacyName,client:new AutomaticServiceClient(this.directory,this.legacyName),target:''};
    let t:Target;
    if(chosen) t=decodeTarget(chosen);
    else {
      const first=(await discoverInstances(this.directory)).find(i=>i.kind==='personal');
      if(!first) return {key:'default-launch',client:new AutomaticServiceClient(this.directory),target:''};
      t={version:1,personal_root:this.personalRoot,directory:this.directory,instance:first.instance};
    }
    let instance=t.instance, directory=t.directory;
    if(t.name) {
      const owner=await openNamedWindow(new SessionRepository(t.personal_root),t.name,currentInstallation(),signal);
      instance=owner.instanceId; directory=owner.serviceDirectory;
    }
    const target=encodeTarget({...t,directory,instance,name:undefined});
    return {key:target,client:new LocalServiceClient(path.join(directory,`${instance}.json`),instance!),target};
  }
}
