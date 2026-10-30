import { registerOverlay } from './overlays.js'
import { PLUGIN_REQUEST_LIMIT, PluginAdmissionError, unwrapPluginBridge } from './admission.js'
import { mountSettingsForm } from '../settings/form.js'
import type { PluginSettingsRequest } from '../settings/contracts.js'
import type { PluginInfo } from './contracts.js'
import type { Disposer, PluginContext, PluginModule } from './sdk.js'
export async function bounded<T>(
  promise: Promise<T>,
  label: string,
  milliseconds = 2000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out (${milliseconds}ms)`)),
          milliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export function jsonState(value: unknown): unknown {
  if (value === undefined) return undefined
  const bytes = JSON.stringify(value)
  if (bytes === undefined || new TextEncoder().encode(bytes).length > 16384)
    throw new Error('Transient UI state must be JSON under 16 KiB')
  return JSON.parse(bytes)
}
export interface Dock {
  commands: HTMLElement
  registerPanel(id: string, title: string, mount: (context: import('../workspace/runtime.js').PanelMount) => void | Disposer, placement?: 'input-settings' | 'modal'): Disposer
  closePanel?(id: string): void
  openPanel(id: string, automatic?: boolean, size?: { width: number; height: number }): void
  changed(): void
  error(error: unknown): void
}
/** Owns every SDK effect; registrations and timers remain inert until publish. */
export class PluginScope {
  readonly abort = new AbortController()
  readonly token: string
  private disposers = new Set<Disposer>()
  private arms = new Set<() => void>()
  private commandFragment = document.createDocumentFragment()
  private panels = new Map<string, { instances: Set<{ visible: boolean }>; open(automatic?: boolean, size?: { width: number; height: number }): void }>()
  private pendingOpens = new Set<string>()
  private commands = new Map<string, () => void | Promise<void>>()
  private links: HTMLLinkElement[] = []
  private ready = false
  private published = false
  private disposal?: Promise<void>
  listeners = 0
  timers = 0
  pending = 0
  readonly context: PluginContext
  constructor(
    readonly info: PluginInfo,
    readonly module: PluginModule,
    private dock: Dock,
  ) {
    const m = info.manifest!,
      lease = info.lease!
    this.token = lease.token
    const alive = () => {
      if (this.abort.signal.aborted) throw Object.assign(new Error('stale_plugin_scope'), { code: 'stale_plugin_scope' })
    }
    const writable = () => {
      alive()
      if (!this.ready)
        throw Object.assign(new Error(
          'plugin_not_ready: use a command for writes; activation/reload never replays mutations',
        ), {code: 'plugin_not_ready'})
    }
    let currentMount: { disposers: Set<Disposer>; visible: boolean } | undefined
    const add = (dispose: Disposer): Disposer => {
      const owner = currentMount
      alive()
      let active = true
      const once = () => {
        if (!active) return
        active = false
        this.disposers.delete(once)
        owner?.disposers.delete(once)
        return dispose()
      }
      this.disposers.add(once)
      owner?.disposers.add(once)
      return once
    }
    const effect = (start: () => Disposer) => {
      alive()
      let cancel: Disposer | undefined,
        active = true
      const arm = () => {
        if (active && !cancel && !this.abort.signal.aborted) cancel = start()
      }
      this.arms.add(arm)
      if (this.published) arm()
      return add(() => {
        active = false
        this.arms.delete(arm)
        return cancel?.()
      })
    }
    const fail = (error: unknown) => this.dock.error(error)
    const settingsRequest = async (request: PluginSettingsRequest) => {
      alive()
      if (['set', 'reset', 'chooseFile'].includes(request.operation)) writable()
      if (this.pending >= PLUGIN_REQUEST_LIMIT) throw new PluginAdmissionError(this.pending)
      ++this.pending
      try {
        const snapshot = unwrapPluginBridge(await window.ares.plugins.settings(this.token, request))
        alive(); return snapshot
      } finally { --this.pending }
    }

    this.context = {
      id: m.id,
      session: lease.identity,
      system: lease.system,
      game: lease.game,
      profile: lease.profile,
      signal: this.abort.signal,
      settings: {
        catalog: () => settingsRequest({ operation: 'catalog' }),
        set: (id, value) => settingsRequest({ operation: 'set', id, value }),
        reset: id => settingsRequest({ operation: 'reset', id }),
        chooseFile: id => settingsRequest({ operation: 'chooseFile', id }),
        changed: callback => effect(() => window.ares.preferences.changed(() => {
          void settingsRequest({ operation: 'catalog' }).then(snapshot => {
            if (!this.abort.signal.aborted) callback(snapshot)
          }).catch(() => {})
        })),
        registerSection: async (section, descriptors) => {
          await settingsRequest({ operation: 'register', section, descriptors })
          return add(() => {
            if (this.abort.signal.aborted) return
            return window.ares.plugins.settings(this.token, { operation: 'unregister', section }).then(() => {}, () => {})
          })
        },
        mount: element => {
          alive()
          return effect(() => mountSettingsForm(element, this.context.settings))
        },
      },
      library: {
        cached: async () => { writable(); const result = unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'cached' })); alive(); return result as import('../library/contracts.js').LibrarySnapshot | null; },
        scan: async () => { writable(); const result = unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'scan' })); alive(); return result as import('../library/contracts.js').LibrarySnapshot; },
        artwork: async (id, kind = 'box') => { writable(); const result = unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'artwork', id, kind })); alive(); return result as string | null; },
        launch: async id => { writable(); unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'launch', id })); },
        chooseDirectory: async () => { writable(); unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'chooseDirectory' })); alive(); },
        openFile: async () => { writable(); unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'openFile' })); },
        contextMenu: async id => { writable(); unwrapPluginBridge(await window.ares.plugins.library(this.token, { operation: 'contextMenu', id })); },
      },
      clipboard:{writeText:async text=>{writable();return unwrapPluginBridge(await window.ares.plugins.clipboard(this.token,text));}},
      demonstrations:{request:async params=>{writable();return unwrapPluginBridge(await window.ares.plugins.demonstration(this.token,params));}},
      exports:{
        saveText:async params=>{writable();return unwrapPluginBridge(await window.ares.plugins.exportText(this.token,params));},
        recordFrames:async params=>{
          writable();const status=unwrapPluginBridge(await window.ares.plugins.recordFrames(this.token,params));
          if(status.state!=='recording')return status;
          const finish=(cancel:boolean)=>window.ares.plugins.finishExport(this.token,status.jobId,cancel).then(unwrapPluginBridge);
          add(()=>finish(true).then(()=>{},()=>{}));return {jobId:status.jobId,stop:()=>finish(false),cancel:()=>finish(true)};
        },
      },
      scripts: {
        run: params => this.context.services.request('scripts.run', params),
        observe: async (params, callback) => {
          const reply=await this.context.services.request('scripts.observe',params);
          if(!reply.ok)throw new Error(reply.error);
          let pending=false,closed=false,last=-1;
          const timer=setInterval(async()=>{
            if(pending||closed)return;pending=true;
            try {
              const r=await this.context.services.request('script.observerRead',{offset:0,length:16384,observerId:reply.result!.observer_id});
              if(!closed&&r.ok&&r.result){
                if(r.result.error)throw new Error(r.result.error);
                if(r.result.bytes&&r.result.frame!==last){last=r.result.frame??-1;const bytes=Uint8Array.from(r.result.hex.match(/../g)??[],b=>parseInt(b,16));await callback(JSON.parse(new TextDecoder().decode(bytes)));}
              }
            }catch(error){if(!closed){closed=true;clearInterval(timer);this.context.log.error(`Observer stopped: ${error}`);void window.ares.plugins.request(this.token,'script.observerStop',{observerId:reply.result!.observer_id}).catch(()=>{});}}
            finally{pending=false;}
          },100);
          return add(()=>{closed=true;clearInterval(timer);return window.ares.plugins.request(this.token,'script.observerStop',{observerId:reply.result!.observer_id}).then(()=>{},()=>{});});
        },
      },
      services: {
        request: async (method, params) => {
          alive()
          if (
            ![
              'scripts.observe','script.observerRead','script.observerStop',
              'session.status',
              'memory.regions',
              'memory.read',
              'memory.readMany', 'memory.sample', 'memory.snapshot.capture', 'memory.recorder.start', 'memory.recorder.stop', 'memory.capture.status', 'memory.capture.read', 'memory.capture.page', 'memory.capture.release', 'memory.snapshot.compare', 'memory.capture.freeze', 'memory.query.start', 'memory.query.advance', 'memory.query.page', 'memory.query.release', 'memory.snapshot.changes',
              'n64.memory.readMany', 'n64.memory.read',
              'n64.peripheral.registers',
              'n64.rsp.lastTask','n64.capture.rsp','n64.capture.matrices','n64.capture.transforms',
              'n64.debug.lastStop',
              'n64.debug.registers',
              'execution.status',
            ].includes(method)
          )
            writable()
          if (this.pending >= PLUGIN_REQUEST_LIMIT) throw new PluginAdmissionError(this.pending)
          ++this.pending
          this.dock.changed()
          try {
            const reply = await window.ares.plugins.request(
              this.token,
              method,
              params,
            )
            alive()
            return unwrapPluginBridge(reply)
          } finally {
            --this.pending
            this.dock.changed()
          }
        },
      },
      scope: {
        onFrame:(params,callback)=>effect(()=>{
          let id=0,closed=false,retries=0;
          let retry:ReturnType<typeof setTimeout>|undefined;
          const freeze=(value:any):any=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
          const stop=()=>id?window.ares.plugins.request(this.token,'script.observerStop',{observerId:id}).then(()=>{},()=>{}):Promise.resolve();
          const unlisten=window.ares.plugins.frames((token,sample)=>{
            if(token!==this.token)return;
            if(!id){window.ares.plugins.frameAck(token,sample.observer_id,sample.delivery);return;}
            if(sample.observer_id!==id)return;
            if(closed){window.ares.plugins.frameAck(token,id,sample.delivery);return;}
            void (async()=>{
              try{
                alive();if(sample.error)throw new Error(sample.error);
                await callback(freeze({observerId:id,sequence:sample.sequence,frame:sample.frame_reference,value:sample.value,skipped:sample.skipped}));
              }catch(error){const report=!closed&&!this.abort.signal.aborted&&!/stale_plugin_scope|stale_epoch|disconnected/.test(String(error));closed=true;unlisten();if(report)this.context.log.error(`Frame observer stopped: ${error}`);void stop();}
              finally{window.ares.plugins.frameAck(token,id,sample.delivery);}
            })();
          });
          const start=()=>{if(closed)return;void this.context.services.request('scripts.observe',{...params,args:params.args??{},timeoutMs:600000,maxFrames:0,every:params.every??1,boundary:params.boundary??'vi',push:true}).then(reply=>{
            if(!reply.ok||!reply.result)throw new Error(reply.error??'invalid_reply');id=reply.result.observer_id;if(closed)void stop();
          }).catch(error=>{
            if(closed||this.abort.signal.aborted)return;
            // Registration is read-only. A state load/exclusive job can briefly
            // own the native thread while this scope publishes; retry admission,
            // without replaying an execution or memory mutation.
            if(/(?:^|\W)(?:busy|observer_preparation_busy)(?:$|\W)/.test(String(error))&&retries++<600){retry=setTimeout(start,Math.min(1000,100*2**Math.min(retries,4)));return;}
            closed=true;unlisten();if(!/stale_plugin_scope|stale_epoch|disconnected/.test(String(error)))this.context.log.error(`Frame observer failed: ${error}`);
          });};start();
          return ()=>{closed=true;clearTimeout(retry);unlisten();return stop();};
        }),
        add,
        listen: (target, event, listener) => {
          const view = currentMount
          return effect(() => {
            const guarded: EventListener = (e) => {
              if (!this.abort.signal.aborted && (!view || view.visible))
                try {
                  void Promise.resolve(listener(e)).catch((error) => {
                    if (!this.abort.signal.aborted) fail(error)
                  })
                } catch (error) {
                  fail(error)
                }
            }
            target.addEventListener(event, guarded)
            ++this.listeners
            this.dock.changed()
            return () => {
              target.removeEventListener(event, guarded)
              --this.listeners
              this.dock.changed()
            }
          })
        },
        interval: (callback, milliseconds) => {
          const view = currentMount
          if (!Number.isFinite(milliseconds) || milliseconds < 50)
            throw new Error('Plugin intervals must be at least 50ms')
          if (this.arms.size >= 128)
            throw new Error('At most 128 scoped effects')
          return effect(() => {
            const timer = setInterval(() => {
              if (
                !this.abort.signal.aborted &&
                (view ? view.visible : [...this.panels.values()].some(p => [...p.instances].some(instance => instance.visible)))
              )
                try {
                  void Promise.resolve(callback()).catch((error) => {
                    if (!this.abort.signal.aborted) fail(error)
                  })
                } catch (error) {
                  fail(error)
                }
            }, milliseconds)
            ++this.timers
            this.dock.changed()
            return () => {
              clearInterval(timer)
              --this.timers
              this.dock.changed()
            }
          })
        },
      },
      recovery: {
        capture:async()=>{writable();const value=await window.ares.plugins.storage(this.token,'recovery.capture','host');alive();return value as import('./recovery-contracts.js').RecoveryStatus;},
        start:async options=>{writable();const value=await window.ares.plugins.storage(this.token,'recovery.start','host',options);alive();return value as import('./recovery-contracts.js').RecoveryStatus;},
        stop:async()=>{writable();const value=await window.ares.plugins.storage(this.token,'recovery.stop','host');alive();return value as import('./recovery-contracts.js').RecoveryStatus;},
        status:async()=>{alive();const value=await window.ares.plugins.storage(this.token,'recovery.status','host');alive();return value as import('./recovery-contracts.js').RecoveryStatus;},
      },
      journal: {
        append:async(stream,record)=>{writable();const result=await window.ares.plugins.storage(this.token,'journal.append',stream,record);alive();return result as import('./journal-contracts.js').JournalReceipt;},
        read:async<T>(stream:string,options?:{afterSequence?:number;limit?:number})=>{alive();const result=await window.ares.plugins.storage(this.token,'journal.read',stream,{afterSequence:options?.afterSequence??0,limit:options?.limit??32});alive();return result as import('./journal-contracts.js').JournalPage<T>;},
      },
      storage: {
        get: async <T>(key: string) => {
          alive()
          const value = await window.ares.plugins.storage(
            this.token,
            'get',
            key,
          )
          alive()
          return value as T | undefined
        },
        set: async (key, value) => {
          writable()
          await window.ares.plugins.storage(this.token, 'set', key, value)
          alive()
        },
        delete: async (key) => {
          writable()
          await window.ares.plugins.storage(this.token, 'delete', key)
          alive()
        },
      },
      log: {
        info: (message) => {
          alive()
          void window.ares.plugins
            .log(this.token, 'info', message)
            .catch(() => {})
        },
        warn: (message) => {
          alive()
          void window.ares.plugins
            .log(this.token, 'warn', message)
            .catch(() => {})
        },
        error: (message) => {
          alive()
          void window.ares.plugins
            .log(this.token, 'error', message)
            .catch(() => {})
        },
      },
      ui: {
        registerOverlay:(id,mount,options={})=>{
          alive();if(!/^[a-z][a-z0-9.-]{0,63}$/.test(id))throw new Error('invalid_overlay_id');
          return effect(()=>registerOverlay(m.id+':'+id,mount,options,fail));
        },
        registerPanel: (id, mount) => {
          alive()
          const contribution = m.contributes.panels?.find(p => p.id === id)
          if (!contribution || this.panels.has(id)) throw new Error('Undeclared or duplicate panel: ' + id)
          const instances = new Set<{ visible: boolean }>()
          const install = effect(() => this.dock.registerPanel(id, contribution.title, context => {
            const instance = { visible: true, disposers: new Set<Disposer>() }
            const abort = new AbortController(), visibility = new Set<Disposer>()
            instances.add(instance)
            const cancel = context.onVisibility(visible => { instance.visible = visible })
            const previous = currentMount; currentMount = instance
            let cleanup: void | Disposer
            try {
              cleanup = mount({
                instanceId: context.instanceId,
                element: context.element,
                signal: abort.signal,
                onVisibility: callback => {
                  alive()
                  const dispose = context.onVisibility(visible => { if (!abort.signal.aborted && !this.abort.signal.aborted) callback(visible) })
                  visibility.add(dispose)
                  return () => { visibility.delete(dispose); return dispose() }
                },
              })
            } catch (error) {
              abort.abort(); instances.delete(instance); void cancel()
              for (const dispose of [...instance.disposers].reverse()) void dispose()
              for (const dispose of visibility) void dispose()
              throw error
            } finally { currentMount = previous }
            let disposed = false
            return async () => {
              if (disposed) return
              disposed = true; abort.abort(); instances.delete(instance)
              const actions = [cancel, ...visibility, ...[...instance.disposers].reverse(), ...(cleanup ? [cleanup] : [])]
              const settled = await Promise.allSettled(actions.map(dispose => Promise.resolve().then(dispose)))
              const failed = settled.find(result => result.status === 'rejected')
              if (failed?.status === 'rejected') throw failed.reason
            }
          }, contribution.placement))
          this.panels.set(id, { instances, open: (automatic, size) => this.dock.openPanel(id, automatic, size) })
          return add(() => { this.panels.delete(id); return install() })
        },
        registerCommand: (id, run) => {
          alive()
          const contribution = m.contributes.commands?.find((c) => c.id === id)
          if (!contribution || this.commands.has(id))
            throw new Error('Undeclared or duplicate command: ' + id)
          this.commands.set(id, run)
          const button = document.createElement('button')
          button.textContent = contribution.title
          button.dataset.pluginCommand = m.id + ':' + id
          button.onclick = () => {
            try {
              writable()
              void Promise.resolve(run()).catch(fail)
            } catch (error) {
              fail(error)
            }
          }
          if (this.published) this.dock.commands.append(button)
          else this.commandFragment.append(button)
          return add(() => {
            button.remove()
            this.commands.delete(id)
          })
        },
        closePanel: id => { writable(); if (!this.panels.has(id)) throw new Error('Unknown panel: ' + id); this.dock.closePanel?.(id) },
        openPanel: (id, size) => {
          alive()
          if (!this.panels.has(id)) throw new Error('Unknown panel: ' + id)
          if (!this.published) this.pendingOpens.add(id)
          else this.panels.get(id)!.open(false, size)
        },
      },
    }
  }
  async action(kind: 'open' | 'command', name: string) {
    if (!this.ready || this.abort.signal.aborted)
      throw Object.assign(new Error('stale_plugin_scope'), { code: 'stale_plugin_scope' })
    if (kind === 'open') {
      const panel = this.panels.get(name)
      if (!panel) throw new Error('Unknown panel')
      panel.open()
    } else {
      const run = this.commands.get(name)
      if (!run) throw new Error('Unknown command')
      await run()
    }
    if (this.abort.signal.aborted) throw Object.assign(new Error('stale_plugin_scope'), { code: 'stale_plugin_scope' })
  }
  async activate(state?: unknown) {
    const result = Promise.resolve(this.module.activate(this.context, state))
    void result.then(
      (cleanup) => {
        if (typeof cleanup === 'function') {
          if (this.abort.signal.aborted)
            void Promise.resolve(cleanup()).catch(console.error)
          else this.context.scope.add(cleanup)
        }
      },
      () => {},
    )
    await bounded(result, 'Plugin activation')
  }
  publish() {
    if (this.abort.signal.aborted) throw Object.assign(new Error('stale_plugin_scope'), { code: 'stale_plugin_scope' })
    this.ready = true
    this.published = true
    this.dock.commands.append(this.commandFragment)
    if (this.info.manifest!.styles) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = this.info.lease!.baseURL + this.info.manifest!.styles
      document.head.append(link)
      this.links.push(link)
    }
    for (const arm of this.arms) arm()
    for (const id of this.pendingOpens) this.panels.get(id)?.open(true)
    this.pendingOpens.clear()
    this.dock.changed()
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.abort.abort()
    this.ready = false
    const results: Promise<unknown>[] = []
    for (const dispose of [...this.disposers].reverse())
      try {
        results.push(Promise.resolve(dispose()))
      } catch (error) {
        results.push(Promise.reject(error))
      }
    for (const link of this.links) link.remove()
    this.links = []
    this.arms.clear()
    this.dock.changed()
    this.disposal = bounded(
      Promise.allSettled(results).then((results) => {
        const rejected = results.find((r) => r.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
      }),
      'Plugin cleanup',
      1000,
    ).then(() => {})
    return this.disposal
  }
}
