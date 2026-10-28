import {profileHolder} from './profile-holder.js';
import {readWatchdog} from './watchdog.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import { profileRoot } from '../profile.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalServiceClient, readConnection, namedConnection, connectionInstance } from './local-endpoint.js';
import { ServiceError, type ServiceMethod, type SessionIdentity, type ServiceParams, type ServiceResult, type SessionReply } from './contracts.js';

/** Discover a running app before launching. A launched GUI outlives this adapter. */
export class AutomaticServiceClient extends LocalServiceClient {
  private observation=new AsyncLocalStorage<boolean>();
  private boundRequest=new AsyncLocalStorage<boolean>();
  override request<M extends ServiceMethod>(method:M,identity?:SessionIdentity,params?:ServiceParams<M>):Promise<SessionReply<ServiceResult<M>>>{
    return this.boundRequest.run(identity!==undefined,()=>super.request(method,identity,params));
  }
  override manage(params:any):Promise<any>{return this.observation.run(['app_logs','app_health','build_info','script_result','plugin_exports'].includes(params?.operation),()=>super.manage(params));}
  launchedApp = false;
  private launchedInstance?: string;
  constructor(private directory: string, private name?: string) { super('', ''); }
  protected override async healthSnapshot():Promise<any|undefined>{
    try{
      const files=this.name?[path.basename(namedConnection(this.directory,this.name))]:(await fs.readdir(this.directory)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));
      const values=[];
      for(const file of files){try{const full=path.join(this.directory,file),id=this.name?await connectionInstance(full):path.basename(file,'.json');const value=await readWatchdog(await readConnection(full,id));if(value)values.push(value);}catch{}}
      if(values.length>1){const live=values.filter(v=>v.watchdog.main!=='disconnected');if(live.length===1)return live[0];return undefined;}
      return values[0];
    }catch{return undefined;}
  }
  private async discover() {
    let files: string[];
    try { files = this.name ? [path.basename(namedConnection(this.directory, this.name))] :
      (await fs.readdir(this.directory)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const live: { file: string; instance: string; ready: boolean }[] = [];
    for (const file of files) {
      const metadata = path.join(this.directory, file);
      let probe: LocalServiceClient | undefined;
      try {
        // readConnection validates permissions and shape before credentials are used.
        // Named selection obtains the instance through the same validated reader.
        probe = this.name ? LocalServiceClient.named(this.directory, this.name, 1000) :
          new LocalServiceClient(metadata, path.basename(file, '.json'), 1000);
        const status = await probe.manage({ operation: 'app_status' });
        const instance = this.name ? JSON.parse(await fs.readFile(metadata, 'utf8')).instance : path.basename(file, '.json');
        await readConnection(metadata, instance);
        live.push({ file: metadata, instance, ready: status.ready === true });
      } catch (e) {
        if (!(e instanceof ServiceError && ['app_not_running', 'instance_not_running', 'app_disconnected'].includes(e.code))) throw e;
      } finally { probe?.close(); }
    }
    if (live.length > 1) throw new ServiceError('multiple_apps_running');
    return live[0];
  }
  protected override async resolveConnection() {
    const found = await this.discover();
    if (found) {
      if(this.observation.getStore())return found;
      const deadline = Date.now() + 20000;
      let target = found;
      while (!target.ready && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const next = await this.discover();
        if (!next) throw new ServiceError('app_disconnected');
        target = next;
      }
      if (!target.ready) throw new ServiceError('app_startup_timeout');
      this.launchedApp = target.instance === this.launchedInstance;
      return target;
    }
    // Polling/cancellation for a particular native session must not launch a
    // replacement app after that session exits between two requests.
    if(this.boundRequest.getStore())throw new ServiceError('app_disconnected');
    const appRoot = fileURLToPath(new URL('../../', import.meta.url));
    const bundled = appRoot.includes(`${path.sep}Contents${path.sep}Resources${path.sep}`);
    const executable = bundled ? path.resolve(appRoot, '../../MacOS/Ares') :
      process.versions.electron ? process.execPath : path.join(appRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const env: NodeJS.ProcessEnv = { ...process.env, ARES_SERVICE_DIR: this.directory };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const logDirectory = path.join(process.env.ARES_PROFILE_DIR || profileRoot(process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support'):path.join(os.homedir(),'.config'),process.env.ARES_PROFILE),'logs');
    await fs.mkdir(logDirectory,{recursive:true,mode:0o700});
    const logPath = path.join(logDirectory, 'automatic-launch.log');
    const stat=await fs.stat(logPath).catch(()=>undefined);if(stat&&stat.size>1024*1024)await fs.rename(logPath,logPath+'.1');
    const log = await fs.open(logPath, 'a', 0o600);
    try {
      const child = spawn(executable, [...(bundled ? [] : [appRoot]), '--services', ...(this.name ? ['--instance-name', this.name] : [])],
        { env, detached: true, stdio: ['ignore', 'ignore', log.fd] });
      let failure = '', exited = false;
      child.on('error', e => { failure = e.message; exited = true; });
      child.on('exit', () => { exited = true; });
      child.unref();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const target = await this.discover();
        if (target?.ready) { this.launchedInstance = !exited ? target.instance : undefined; this.launchedApp = !exited; return target; }
        if (exited) {
          failure += await fs.readFile(logPath, 'utf8');
          if(failure.includes('profile_in_use'))throw Object.assign(new ServiceError('profile_in_use'),{details:await profileHolder(path.dirname(logDirectory))});
          throw new ServiceError('app_launch_failed');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new ServiceError('app_launch_timeout');
    } finally {
      await log.close();
      // The app retains its own descriptor, so adapter exit cannot break stderr.
      // Keep bounded launch diagnostics after the adapter exits.
    }
  }
}
