import type {DemonstrationOptions} from './contracts.js';
import type { PluginSettingDescriptor, PreferencesBridge } from '../settings/contracts.js'
import type {
  SessionIdentity,
  ServiceMethod,
  ServiceParams,
  ServiceResult,
  SessionReply,
} from '../services/contracts.js'
import type { GameIdentity } from './contracts.js'
export type Disposer = () => void | Promise<void>
export interface PanelContext {
  /** Stable placement ID; use it to keep independent per-view transient state. */
  readonly instanceId: string
  /** Aborted when this particular panel instance closes or is replaced. */
  readonly signal: AbortSignal
  element: HTMLElement
  onVisibility(callback: (visible: boolean) => void): Disposer
}
/** CSS screen rectangle and DPR backing-store size; logical dimensions stay independent. */
export interface OverlaySize {geometry:import('../services/video-geometry.js').VideoGeometry|null;canvasToCss:import('../services/video-geometry.js').AffineTransform|null;canvasToPixels:import('../services/video-geometry.js').AffineTransform|null;width:number;height:number;pixelWidth:number;pixelHeight:number;dpr:number;logicalWidth:number;logicalHeight:number;sourceWidth:number;sourceHeight:number}
export interface OverlayOptions {order?:number;interactive?:boolean}
export interface OverlayContext {
  element:HTMLDivElement;readonly signal:AbortSignal;readonly size:OverlaySize;readonly frame:import('../services/frame-contracts.js').FrameReference|null;
  onResize(callback:(size:OverlaySize)=>void):Disposer;
  setVisible(visible:boolean):void;
  /** Paint only when the frozen sample matches the submitted video frame; otherwise hide as stale. */
  present(sample:import('../services/observer-contracts.js').FrameSample,paint:()=>void):void;
}
export type FrameSubscriptionParams=Omit<import('../services/script-contracts.js').ScriptRunParams,'statePaths'|'outputPaths'|'outputPath'|'projectRoot'|'args'|'timeoutMs'|'maxFrames'|'push'>&{args?:unknown};
export interface PluginContext {
  readonly id: string
  readonly session: SessionIdentity
  readonly system: string
  readonly game: GameIdentity | null
  readonly profile: string | null
  readonly signal: AbortSignal
  settings: PreferencesBridge & {
    /** Local field IDs become plugin:<plugin ID>:<section>:<field>. Activation stages metadata only. */
    registerSection(id: string, descriptors: PluginSettingDescriptor[]): Promise<Disposer>
    mount(element: HTMLElement): Disposer
  }
  /** Host-owned ROM library; no arbitrary filesystem paths or remote URLs. */
  library: import('../library/contracts.js').LibraryAPI
  demonstrations:{request(params:DemonstrationOptions):Promise<import('../services/demonstration-contracts.js').DemonstrationStatus>};
  clipboard:{writeText(text:string):Promise<{copied:true;bytes:number}>};
  exports:{saveText(params:import('../services/export-contracts.js').TextExport):Promise<import('../services/export-contracts.js').ExportStatus>;recordFrames(params:import('../services/export-contracts.js').FrameExport):Promise<import('../services/export-contracts.js').RecordingExport|import('../services/export-contracts.js').ExportStatus>};
  scripts: {
    /** Read-only latest-value observation; synchronous module callback, disposed with the plugin. */
    observe(params: Omit<import('../services/script-contracts.js').ScriptRunParams, 'statePaths' | 'outputPaths' | 'outputPath' | 'projectRoot'>, callback: (value: unknown) => void | Promise<void>): Promise<Disposer>
    /** Native exclusive job; requires session.control, memory.read, memory.write and debug.read. */
    run(params: Omit<import('../services/script-contracts.js').ScriptRunParams, 'statePaths' | 'outputPaths' | 'outputPath' | 'projectRoot'>): Promise<SessionReply<import('../services/contracts.js').ExecutionOperation>>
  }
  services: {
    request<M extends ServiceMethod>(
      method: M,
      params?: ServiceParams<M>,
    ): Promise<SessionReply<ServiceResult<M>>>
  }
  ui: {
    registerOverlay(id:string,mount:(context:OverlayContext)=>void|Disposer,options?:OverlayOptions):Disposer;
    registerPanel(
      id: string,
      mount: (context: PanelContext) => void | Disposer,
    ): Disposer
    registerCommand(id: string, run: () => void | Promise<void>): Disposer
    closePanel(id: string): void
    openPanel(id: string, size?: { width: number; height: number }): void
  }
  scope: {
    /** Push frozen native VI samples; callbacks never reread boundary RAM. At most one callback is in flight. */
    onFrame(params:FrameSubscriptionParams,callback:(sample:import('../services/observer-contracts.js').FrameSample)=>void|Promise<void>):Disposer;
    add(dispose: Disposer): Disposer
    listen(
      target: EventTarget,
      event: string,
      listener: EventListener,
    ): Disposer
    interval(callback: () => void, milliseconds: number): Disposer
  }
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  log: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
}
export interface PluginModule {
  /** Pure candidate validation without service or UI effects. */
  prepare?(): void | Promise<void>
  stateVersion?: number
  saveState?(): unknown | Promise<unknown>
  activate(
    context: PluginContext,
    state?: unknown,
  ): void | Disposer | Promise<void | Disposer>
}

export type { PluginSettingDescriptor, SettingDescriptor, SettingEntry, SettingValue, SettingsSnapshot } from '../settings/contracts.js'

export type { SessionIdentity, SessionStatus, SessionReply, ServiceMethod, ServiceParams, ServiceResult, ExecutionOperation } from '../services/contracts.js'
export type { GameIdentity, PluginManifest } from './contracts.js'

export type { FrameReference } from '../services/frame-contracts.js'
export type { FrameSample } from '../services/observer-contracts.js'

export type { RspTask, RspTaskResult } from '../services/task-contracts.js'

export type {TextExport,FrameExport,ExportStatus,RecordingExport} from '../services/export-contracts.js'

export type {FixedMatrix,RspMatrixState,MatrixPage,DrawVertex} from '../services/matrix-contracts.js';

export type {CapturedTransform,TransformPage,TransformState} from '../services/transform-contracts.js';
