import { contextBridge, ipcRenderer } from 'electron'
import type { AresBridge } from './bridge.js'
let fullscreen = false, fullscreenRevision = 0
const applyWindowChrome = () => {
  if (!document.body) return
  if (process.platform === 'darwin') document.body.dataset.windowChrome = 'macos'
  document.body.dataset.fullscreen = String(fullscreen)
}
ipcRenderer.on('window-fullscreen', (_event, value: boolean) => {
  ++fullscreenRevision
  fullscreen = value
  applyWindowChrome()
})
window.addEventListener('DOMContentLoaded', () => {
  applyWindowChrome()
  const revision = fullscreenRevision
  void ipcRenderer.invoke('window.fullscreen').then((value: boolean) => {
    if (revision !== fullscreenRevision) return
    fullscreen = value
    applyWindowChrome()
  })
})
let exportGesture=false;
for(const kind of ['click','keydown'])window.addEventListener(kind,event=>{if(event.isTrusted){exportGesture=true;setTimeout(()=>{exportGesture=false;},0);}},true);
function takeExportGesture(){const allowed=exportGesture&&navigator.userActivation.isActive;exportGesture=false;return allowed;}
const api: AresBridge = {
  agentAction: action => ipcRenderer.invoke('agent.action', action),
  workspace: {
    load: () => ipcRenderer.invoke('workspace.load'),
    save: layout => ipcRenderer.invoke('workspace.save', layout),
  },
  onAction: callback => {
    const listener = (_event: unknown, action: Parameters<Parameters<AresBridge['onAction']>[0]>[0]) => callback(action)
    ipcRenderer.on('app-action', listener)
    return () => ipcRenderer.removeListener('app-action', listener)
  },
  preferences: {
    catalog: () => ipcRenderer.invoke('preferences.catalog'),
    set: (id, value) => ipcRenderer.invoke('preferences.set', id, value),
    reset: id => ipcRenderer.invoke('preferences.reset', id),
    chooseFile: id => ipcRenderer.invoke('preferences.chooseFile', id),
    changed: callback => {
      const listener = (_event: unknown, snapshot: import('./settings/contracts.js').SettingsSnapshot) => callback(snapshot)
      ipcRenderer.on('preferences-changed', listener)
      return () => ipcRenderer.removeListener('preferences-changed', listener)
    },
  },
  plugins: {
    library: (token, request) => ipcRenderer.invoke('plugin.library', token, request),
    clipboard:(token,text)=>ipcRenderer.invoke('plugin.clipboard',token,text,takeExportGesture()),
    exportText:(token,params)=>ipcRenderer.invoke('plugin.exportText',token,params,takeExportGesture()),
    recordFrames:(token,params)=>ipcRenderer.invoke('plugin.recordFrames',token,params,takeExportGesture()),
    finishExport:(token,id,cancel)=>ipcRenderer.invoke('plugin.finishExport',token,id,cancel),
    frames:callback=>{const listener=(_event:unknown,token:string,sample:import('./services/observer-contracts.js').ObserverDelivery)=>callback(token,sample);ipcRenderer.on('plugin-frame',listener);return ()=>ipcRenderer.removeListener('plugin-frame',listener);},
    frameAck:(token,id,delivery)=>ipcRenderer.send('plugin.frameAck',token,id,delivery),
    settings: (token, request) => ipcRenderer.invoke('plugin.settings', token, request),
    actions: (callback) => {
      const listener = (_event: unknown, action: any) => callback(action)
      ipcRenderer.on('plugin-action', listener)
      return () => ipcRenderer.removeListener('plugin-action', listener)
    },
    result: (id, token, error) =>
      ipcRenderer.invoke('plugin.actionResult', id, token, error),
    reload: (id) => ipcRenderer.invoke('plugin.reload', id),
    begin: (token) => ipcRenderer.invoke('plugin.begin', token),
    finish: (token) => ipcRenderer.invoke('plugin.finish', token),
    reject: (token, message) =>
      ipcRenderer.invoke('plugin.reject', token, message),
    rollback: (token, message) =>
      ipcRenderer.invoke('plugin.rollback', token, message),
    fail: (token, message) => ipcRenderer.invoke('plugin.fail', token, message),
    catalog: () => ipcRenderer.invoke('plugin.catalog'),
    enable: (id, enabled) => ipcRenderer.invoke('plugin.enable', id, enabled),
    add: () => ipcRenderer.invoke('plugin.add'),
    refresh: () => ipcRenderer.invoke('plugin.refresh'),
    request: (token, method, params) =>
      ipcRenderer.invoke('plugin.request', token, method, params),
    storage: (token, op, key, value) =>
      ipcRenderer.invoke('plugin.storage', token, op, key, value),
    log: (token, level, message) =>
      ipcRenderer.invoke('plugin.log', token, level, message),
    changed: (callback) => {
      const listener = (_event: unknown, catalog: any) => callback(catalog)
      ipcRenderer.on('plugin-catalog', listener)
      return () => ipcRenderer.removeListener('plugin-catalog', listener)
    },
  },
  session: (method, identity, params) =>
    ipcRenderer.invoke('session', method, identity, params),
  ready: () => ipcRenderer.send('ready'),
  open: (options) => ipcRenderer.invoke('open', options),
  systems: () => ipcRenderer.invoke('systems'),
  settings: () => ipcRenderer.invoke('settings'),
  command: (data) => ipcRenderer.send('command', data),
  onSessionState: (callback) =>
    ipcRenderer.on('session-state', (_event, reply) => callback(reply)),
  onStatus: (callback) =>
    ipcRenderer.on('status', (_event, text) => callback(text)),
}
contextBridge.exposeInMainWorld('ares', api)
ipcRenderer.on('frames', (event) => {
  window.postMessage({ type: 'ares-frames' }, '*', event.ports)
})
