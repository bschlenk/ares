import {FocusPause} from './focus-pause.js';
import { heldButtons, InputClips } from './input-clips.js';
import { startScript, ScriptJobs } from './scripts.js';
import type { ScriptRunParams } from './script-contracts.js';
import { MemoryArtifacts } from './memory-artifacts.js';
import type { MemoryExportParams } from './artifact-contracts.js';
import { MemoryDumps } from './memory-dumps.js';
import type { DumpParams } from './inspection-contracts.js';
import { RdpArtifacts } from './rdp-artifacts.js';
import { Batches } from './batches.js';
import type { BatchParams } from './batch-contracts.js';
import { StateLoading } from './state-loading.js';
import { StateArtifacts } from './state-artifacts.js';
import { StateInspection } from './state-inspection.js';
import { STATE_METHODS } from './state-contracts.js';
import { RecordingArtifacts } from './recording-artifacts.js';
import { AudioArtifacts } from './audio-artifacts.js';
import { Screenshots } from './screenshots.js';
import { SCREENSHOT_METHODS } from './screenshot-contracts.js';
import type { ScreenshotParams } from './screenshot-contracts.js';
import { TraceArtifacts } from './trace-artifacts.js';
import type { TraceExportParams } from './artifact-contracts.js';
import { METHODS, PROTOCOL, encodeRequest, ServiceError, type SessionIdentity, type ServiceMethod, type ServiceParams, type ServiceResult, type SessionReply } from './contracts.js';
import type { NativeSessionClient } from './native-client.js';

function mainCapabilities(reply: SessionReply<any>): void {
  if (reply.ok && Array.isArray(reply.result?.capabilities)) for (const method of ['artifact.inputRequest','artifact.inputExport','artifact.inputImport','scripts.observe', 'scripts.run', 'artifact.memoryExport', 'experiment.batch', 'artifact.traceExport', 'artifact.rdpExport', 'artifact.dump', ...SCREENSHOT_METHODS, ...STATE_METHODS, 'artifact.audioSave', 'artifact.videoStop']) if (!reply.result.capabilities.includes(method)) reply.result.capabilities.push(method);
}

/** Electron main owns this router, independently of renderer/plugin lifetimes. */
export class SessionRouter {
  private title?: string;
  private focusPause = new FocusPause(reply => this.publishState(reply));
  configureFocusPause(enabled: boolean, focused: boolean): Promise<void> { return this.focusPause.configure(enabled, focused); }
  private decorateState(reply: SessionReply): SessionReply {
    const decorated = this.focusPause.decorate(reply);
    return decorated.ok && decorated.result ? {...decorated,result:{...decorated.result,title:this.title}} : decorated;
  }
  private publishState(reply: SessionReply): void { this.onSessionState?.(this.decorateState(reply)); }
  onObserverSample?:(sample:import('./observer-contracts.js').ObserverSample)=>void;
  private observerStartTail:Promise<unknown>=Promise.resolve();
  private observerStarts=new Map<string,{count:number;cancelled:boolean}>();
  private async startObserver(client:NativeSessionClient,identity:SessionIdentity,params:ScriptRunParams,owner:string){
    let entry=this.observerStarts.get(owner);
    if(entry?.cancelled||(entry?.count??0)>=4||[...this.observerStarts.values()].reduce((n,e)=>n+e.count,0)>=8)throw new ServiceError('observer_limit');
    if(!entry){entry={count:0,cancelled:false};this.observerStarts.set(owner,entry);}
    ++entry.count;const owned=entry;
    const result=this.observerStartTail.then(()=>{if(owned.cancelled||this.client!==client)throw new ServiceError('disconnected');return startScript(client,identity,params,owner,()=>this.client===client&&!owned.cancelled,true);});
    this.observerStartTail=result.catch(()=>{});
    try{return await result;}finally{if(!--owned.count&&this.observerStarts.get(owner)===owned)this.observerStarts.delete(owner);}
  }
  private scripts = new ScriptJobs(error=>this.diagnose('scripts.run',error));
  private inputClips=new InputClips();
  health() {return this.client?.health()??{connected:false,observation:'cached'};}
  readScriptResult(params:any) {if(params.list===true)return this.scripts.results.list(params.offset,params.limit);if(params.discard===true){if(typeof params.handle!=='string')throw new ServiceError('invalid_request');return this.scripts.results.discard(params.handle);}if(params.consumed===true){if(typeof params.handle!=='string')throw new ServiceError('invalid_request');return this.scripts.results.consume(params.handle);}if(params.release===true){if(typeof params.handle!=='string')throw new ServiceError('invalid_request');return this.scripts.results.release(params.handle);}return this.scripts.readResult(params,this.identity);}
  private memoryArtifacts = new MemoryArtifacts();
  private batches = new Batches();
  private stateLoading = new StateLoading();
  private stateArtifacts = new StateArtifacts();
  private states = new StateInspection();
  private recording = new RecordingArtifacts();
  private audio = new AudioArtifacts();
  private screenshots = new Screenshots();
  private artifacts = new TraceArtifacts();
  private rdpArtifacts = new RdpArtifacts();
  private memoryDumps = new MemoryDumps();
  private nextArtifactId = 0;
  private client?: NativeSessionClient;
  get identity() { return this.client?.identity; }
  private stateTimer?: ReturnType<typeof setInterval>;
  constructor(private onSessionState?: (reply: SessionReply) => void, private diagnose: (source:string,error:unknown)=>void = ()=>{}) {}
  attach(client: NativeSessionClient, title?: string): void {
    this.detach(); this.title = title; this.client = client; this.focusPause.attach(client);
    client.onObserverSample=sample=>{if(this.client===client)this.onObserverSample?.(sample);};
    if (!this.onSessionState) return;
    // CPU break/watch hits can stop ordinary play without a request or a video
    // frame. Main observes that state independently of the renderer's lifetime.
    let pending = false;
    this.stateTimer = setInterval(async () => {
      if (pending || this.client !== client) return;
      pending = true;
      try {
        const reply = await client.request('session.status');
        mainCapabilities(reply);
        if (this.client === client && reply.ok) this.publishState(reply);
      } catch { /* NativeSessionClient owns disconnect/timeout handling. */ }
      finally { pending = false; }
    }, 250);
    this.stateTimer.unref();
  }
  detach(): void {
    for(const entry of this.observerStarts.values())entry.cancelled=true;
    this.inputClips.close();this.scripts.close(); this.memoryArtifacts.close(); this.memoryDumps.close(); this.rdpArtifacts.close(); this.batches.close(); this.artifacts.close(); this.screenshots.close(); this.audio.close(); this.recording.close(); this.states.close(); this.stateArtifacts.close(); this.stateLoading.close();
    clearInterval(this.stateTimer); this.stateTimer = undefined;
    this.title = undefined; this.focusPause.attach(); this.client?.close(); this.client = undefined;
  }
  async request<M extends ServiceMethod>(method: M, identity?: SessionIdentity, params?: ServiceParams<M>, owner = 'ui'): Promise<SessionReply<ServiceResult<M>>> {
    if (method === 'session.pause' || method === 'session.resume') {
      const reply = await this.focusPause.explicit(owner, () => this.dispatchRequest(method, identity, params, owner), reply => reply.ok);
      if (reply.ok) this.publishState(reply as SessionReply);
      return this.decorateState(reply as SessionReply) as SessionReply<ServiceResult<M>>;
    }
    if (['execution.runFrames', 'execution.runUntilFrame', 'execution.stepInstructions', 'scripts.run', 'experiment.batch', 'n64.input.tap', 'state.load', 'n64.state.loadCommit', 'n64.demo.start', 'n64.demo.replay', 'n64.cpu.call', 'n64.rsp.run', 'n64.rsp.step', 'n64.trace.start', 'n64.rdp.captureStart', 'n64.memory.writeMany', 'script.start', 'video.record.scriptStart'].includes(method)) await this.focusPause.takeControl();
    const reply = await this.dispatchRequest(method, identity, params, owner);
    return method.startsWith('session.') ? this.decorateState(reply as SessionReply) as SessionReply<ServiceResult<M>> : reply;
  }
  private async dispatchRequest<M extends ServiceMethod>(method: M, identity?: SessionIdentity, params?: ServiceParams<M>, owner = 'ui'): Promise<SessionReply<ServiceResult<M>>> {
    if(method.startsWith('n64.demo.'))owner=this.inputClips.ownerFor(owner);
    if (!METHODS.includes(method)) throw new ServiceError('invalid_request');
    if (method === 'execution.release') { const start=this.observerStarts.get(owner);if(start)start.cancelled=true; this.scripts.release(owner); this.memoryArtifacts.release(owner); this.memoryDumps.release(owner); this.rdpArtifacts.release(owner); this.batches.release(owner); this.artifacts.release(owner); this.screenshots.release(owner); this.audio.release(owner); this.recording.release(owner); this.states.release(owner); this.stateArtifacts.release(owner); this.stateLoading.release(owner); }
    if (!this.client) throw new ServiceError('native_host_disconnected');
    const client = this.client;
    if (method.startsWith('artifact.') || method.startsWith('state.') || method.startsWith('experiment.') || (method === 'scripts.run' || method === 'scripts.observe')) {
      const startingIdentity = { ...(identity ?? client.identity) };
      encodeRequest('validation', startingIdentity, method, params, owner);
      const envelope = { protocol: PROTOCOL, id: `artifact${++this.nextArtifactId}`, ...startingIdentity };
      try {
        let result;
        if(method==='artifact.inputRetry'||method==='artifact.inputRequest'||method==='artifact.inputExport'||method==='artifact.inputImport')result=await this.inputClips.run(this,startingIdentity,method,params,owner,()=>this.client===client);
        else if (method === 'scripts.run') result = await this.scripts.start(client, this, startingIdentity, params as ScriptRunParams, owner, () => this.client === client);
        else if (method === 'scripts.observe') result = await this.startObserver(client,startingIdentity,params as ScriptRunParams,owner);
        else if (method === 'experiment.cancelBatch') {
          if(startingIdentity.session !== client.identity.session) throw new ServiceError('wrong_session');
          result={cancelled:this.batches.cancel(owner,(params as {token:string}).token)};
        } else if (method === 'experiment.batch') result = await this.batches.run(client, this, startingIdentity, params as BatchParams, owner, () => this.client === client, child => { this.stateLoading.release(child); this.screenshots.release(child); });
        else if (method === 'state.load') {result = await this.stateLoading.load(client, startingIdentity, params as { path: string; resume: boolean; keepOverrides: boolean }, owner, () => this.client === client);this.scripts.ownedEpoch(owner,{session:client.identity.session,epoch:result.epoch});}
        else if (method === 'state.save') result = await this.stateArtifacts.save(client, startingIdentity, params as { path: string; overwrite: boolean; metadata: boolean }, owner, () => this.client === client);
        else if (method === 'state.info' || method === 'state.list' || method === 'state.peek') result = await this.states.inspect(client, startingIdentity, method, params, owner, () => this.client === client);
        else if (method === 'artifact.memoryExport') result = await this.memoryArtifacts.export(client, startingIdentity, params as MemoryExportParams, owner, () => this.client === client);
        else if (method === 'artifact.dump') result = await this.memoryDumps.save(client, startingIdentity, params as DumpParams, owner, () => this.client === client);
        else if (method === 'artifact.rdpExport') result = await this.rdpArtifacts.export(client, startingIdentity, params as TraceExportParams, owner, () => this.client === client);
        else if (method === 'artifact.traceExport') result = await this.artifacts.export(client, startingIdentity, params as TraceExportParams, owner, () => this.client === client);
        else if (method === 'artifact.videoStop') { const p = params as { path: string; overwrite: boolean }; result = await this.recording.stop(client, startingIdentity, p.path, p.overwrite, owner, () => this.client === client); }
        else if (method === 'artifact.audioSave') result = await this.audio.save(client, startingIdentity, (params as { path: string }).path, owner, () => this.client === client);
        else if (method === 'artifact.screenshot') result = await this.screenshots.capture(client, startingIdentity, params as ScreenshotParams, owner, () => this.client === client);
        else {
          if (startingIdentity.session !== client.identity.session || startingIdentity.epoch !== client.identity.epoch) throw new ServiceError('stale_epoch');
          const p = params as { imageId: string; offset: number; length: number };
          result = method === 'artifact.imageRead' ? this.screenshots.read(p.imageId, p.offset, p.length, owner, startingIdentity) : this.screenshots.releaseImage(p.imageId, owner);
        }
        return { ...envelope, ...((method === 'state.load' || method === 'experiment.batch' || method==='artifact.inputRequest') ? { epoch: (result as { epoch: number }).epoch } : {}), ok: true, result } as SessionReply<ServiceResult<M>>;
      } catch (error) {
        if(!(error instanceof ServiceError))this.diagnose(method,error);
        return { ...envelope, ...client.identity, ok: false, error: error instanceof ServiceError ? error.code : ('unexpected_error: '+(error instanceof Error?error.message:String(error))).slice(0,2048) };
      }
    }
    // The authenticated parent may pause/cancel its batch child. Other callers
    // keep their own generation and remain subject to native ownership checks.
    const child = (method === 'session.pause' || method === 'execution.cancel') ? this.batches.child(owner) : undefined;
    const reply = await client.request(method, identity, params, child ?? owner);
    if(method==='execution.status'&&reply.ok&&reply.result){const output=this.scripts.outputs.get((reply.result as {operation_id:number}).operation_id);if(output)(reply.result as any).script_output=output;Object.assign(reply.result,this.scripts.metadata((reply.result as any).operation_id));}
    if(reply.ok&&method==='n64.demo.read')for(const e of (reply.result as any).events)e.held=heldButtons(e.buttons);
    if(reply.ok&&method.startsWith('n64.demo.')&&reply.result)Object.assign(reply.result,this.inputClips.metadata((reply.result as any).job_id));
    if(reply.ok&&method==='n64.state.loadCommit')this.scripts.ownedEpoch(owner,{session:reply.session,epoch:reply.epoch});
    const cancelled = reply.result as { owner?: string; stop_reason?: string };
    if (child && reply.ok && (method === 'session.pause' || cancelled.owner === child && cancelled.stop_reason === 'cancelled')) this.batches.interrupt(owner, method === 'session.pause' ? 'paused' : 'cancelled');
    if (method.startsWith('session.')) mainCapabilities(reply);
    if (this.client === client && reply.ok && method.startsWith('session.') && method !== 'session.pause' && method !== 'session.resume') this.publishState(reply as SessionReply);
    if (this.client === client && reply.ok && method.startsWith('execution.') &&
        (method !== 'execution.status' || (reply.result as { state?: string })?.state === 'done')) {
      const state = await client.request('session.status');
      mainCapabilities(state);
      if (this.client === client && state.ok) this.publishState(state);
    }
    return reply;
  }
}
