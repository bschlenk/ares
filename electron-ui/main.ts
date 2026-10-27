import {MainWatchdog} from './services/watchdog.js';
import {ServiceError} from './services/contracts.js'
import {PluginExports} from './services/plugin-exports.js'
import { ObserverDeliveries } from './services/observer-delivery.js'
import { attachDiagnostics } from './services/diagnostic-guard.js'
import { buildInfo } from './services/build-info.js'
import { AppLogs } from './services/app-logs.js'
import { pluginBridgeResult } from './plugins/admission.js'
import { WorkspaceStore } from './workspace/store.js'
import { PluginSettingsService } from './settings/plugins.js'
import { inputDescriptors } from './settings/input.js'
import { validRuntimeSettings, type RuntimeSettings } from './services/runtime-contracts.js'
import { coreDescriptors, firmwareDescriptors, importedValues, nativeSettingsBml, parseNativeSettingsInfo } from './settings/native.js'
import { SettingsStore } from './settings/store.js'
import { presentationSettings, nativeRuntimeSettings, agentSettings } from './settings/builtins.js'
import { profileRoot, profileSaves } from './profile.js'
import { PluginRegistry } from './plugins/registry.js'
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  MessageChannelMain,
  Menu,
  protocol,
  clipboard,
  type MessagePortMain,
} from 'electron'
import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { FrameParser, type NativeFrame } from './protocol.js'
import { createHash, randomUUID } from 'node:crypto'
import { NativeSessionClient } from './services/native-client.js'
import { LocalServiceHost } from './services/local-endpoint.js'
import { installCliHelpers, mcpConfiguration, isBundledCliRuntime } from './agent-integration.js'
import { SessionRouter } from './services/session-router.js'
import type { NativeCommand, StartOptions } from './bridge.js'
import type {
  SessionIdentity,
  ServiceMethod,
  ServiceParams,
} from './services/contracts.js'
// Compiled entry lives in dist/ in both checkout and copied distribution.
const appRoot = fileURLToPath(new URL('../', import.meta.url))
const saveDirectory = (() => {
  try {
    // Respect explicit Electron profiles used by embedders/tests and --user-data-dir.
    const inferredProfile = path.join(app.getPath('appData'), app.getName())
    const suppliedProfile = app.getPath('userData')
    const selectedProfile = process.env.ARES_PROFILE_DIR ||
      (app.commandLine.hasSwitch('user-data-dir') || suppliedProfile !== inferredProfile
        ? suppliedProfile
        : profileRoot(app.getPath('appData'), process.env.ARES_PROFILE))
    fs.mkdirSync(selectedProfile, { recursive: true })
    const profileDirectory = fs.realpathSync(selectedProfile)
    app.setName('Ares Workbench')
    app.setPath('userData', profileDirectory)
    app.setPath('sessionData', path.join(profileDirectory, 'browser'))
    // Electron owns the OS-backed lock and releases it even after a crash. Never
    // forward a second launch's arguments or mutations to the existing instance.
    if (!app.requestSingleInstanceLock()) {
      console.error(`profile_in_use: ${profileDirectory}; choose ARES_PROFILE or ARES_PROFILE_DIR`)
      app.exit(1)
    }
    fs.mkdirSync(app.getPath('sessionData'), { recursive: true })
    app.setAppLogsPath(path.join(profileDirectory, 'logs'))
    return profileSaves(profileDirectory, process.env.ARES_SAVE_DIR)
  } catch (error) {
    console.error(error)
    app.exit(1)
    throw error
  }
})()

const appLogs = new AppLogs(path.join(app.getPath('userData'), 'logs'))
const fatal = (error: unknown) => {
  appLogs.write('main', 'fatal', error)
  const fallback = setTimeout(() => app.exit(1), 1500)
  void appLogs.flush().finally(() => { clearTimeout(fallback); app.exit(1) })
}
attachDiagnostics((source,error,isFatal)=>{if(isFatal)fatal(error);else appLogs.write(source,'error',error)})

interface NativeSession {
  child: ChildProcessByStdio<Writable, Readable, Readable>
  system: string
  romHash?: string
  generation: number
  outstanding: boolean
  lastSequence: number
  diagnostic: string
  failure?: string
  lastPresentation?:import('./services/frame-contracts.js').FrameReference
  lastFrame?: NativeFrame
  closed: Promise<void>
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ares-plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])
export const sessions = new SessionRouter((reply) => {
  plugins.observe(reply)
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send('session-state', reply)
}, (source,error)=>appLogs.write(source,'error',error))
export const plugins = new PluginRegistry(
  path.join(appRoot, 'bundled-plugins'),
  path.join(app.getPath('userData'), 'plugins'),
  sessions,
  () => sessions.identity,
  (catalog) => {
    if (window && !window.isDestroyed())
      window.webContents.send('plugin-catalog', catalog)
  },
)
const observerDeliveries=new ObserverDeliveries(owner=>{
  if(!owner.startsWith('plugin-'))return false;
  try{plugins.authorize(owner.slice(7));return true;}catch{return false;}
},sample=>{if(window&&!window.isDestroyed())window.webContents.send('plugin-frame',sample.owner.slice(7),sample)});
ipcMain.on('plugin.frameAck',(event,token:unknown,id:unknown,delivery:unknown)=>{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||typeof token!=='string'||!Number.isSafeInteger(id)||!Number.isSafeInteger(delivery))return;
  observerDeliveries.ack('plugin-'+token,id as number,delivery as number);
});
const pluginExports=new PluginExports({
  authorize(token,capability){const info=plugins.authorize(token);if(!info.manifest?.capabilities.includes(capability)||!info.lease)throw new ServiceError('plugin_capability_denied');return {pluginId:info.manifest.id,identity:info.lease.identity};},
  async choose(name){if(!window||window.isDestroyed())throw new Error('window_closed');const result=await dialog.showSaveDialog(window,{title:'Export plugin data',defaultPath:name,properties:['showOverwriteConfirmation','createDirectory']});return result.canceled?undefined:result.filePath;},
  clipboard(text){clipboard.writeText(text);},
  async start(owner,identity,params){const reply=await sessions.request('scripts.observe',identity,params,owner);if(!reply.ok||!reply.result)throw new ServiceError(reply.error??'observer_start_failed');return reply.result.observer_id;},
  stop(owner){return sessions.request('execution.release',undefined,undefined,owner);},
});
sessions.onObserverSample=sample=>{const value={...sample,frame_reference:{...sample.frame_reference,app_instance:serviceHost.instance}};pluginExports.observe(value);observerDeliveries.publish(value);};
for(const operation of ['clipboard','exportText','recordFrames','finishExport'] as const)ipcMain.handle('plugin.'+operation,(event,token:unknown,params:unknown,extra:unknown)=>pluginBridgeResult(async()=>{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||typeof token!=='string')throw new Error('invalid_sender');
  if(operation==='clipboard'){if(typeof params!=='string')throw new Error('invalid_export_request');return pluginExports.clipboard(token,params,extra===true);}
  if(operation==='exportText')return pluginExports.save(token,params as import('./services/export-contracts.js').TextExport,extra===true);
  if(operation==='recordFrames')return pluginExports.record(token,params as import('./services/export-contracts.js').FrameExport,extra===true);
  if(typeof params!=='string'||typeof extra!=='boolean')throw new Error('invalid_export_request');return pluginExports.finish(token,params,extra);
}));
const pluginCatalog = (offset = 0, limit = 4) => {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 128 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 4
  )
    throw new Error('invalid_plugin_page')
  const all = plugins.catalog()
  return {
    ...all,
    plugins: all.plugins
      .slice(offset, offset + limit)
      .map((p) => ({ ...p, logs: [] })),
    total: all.plugins.length,
    nextOffset: offset + limit < all.plugins.length ? offset + limit : null,
  }
}
const pluginActions = new Map<
  string,
  {
    token: string
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
async function pluginAction(
  token: string,
  kind: 'open' | 'command',
  name: string,
) {
  plugins.authorize(token)
  if (!window || window.isDestroyed()) throw new Error('renderer_unavailable')
  const id = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pluginActions.delete(id)
      reject(new Error('plugin_action_timeout; request was not replayed'))
    }, 3000)
    pluginActions.set(id, { token, resolve, reject, timer })
    window.webContents.send('plugin-action', { id, token, kind, name })
  })
  return { completed: true }
}
export const serviceHost = new LocalServiceHost(sessions, async (params) => {
  if (
    !params ||
    typeof params !== 'object' ||
    Object.keys(params).some(
      (key) =>
        ![
          'operation',
          'handle',
          'release',
          'operation_id',
          'job_id',
          'length',
          'id',
          'source',
          'enabled',
          'token',
          'name',
          'offset',
          'limit',
          'cursor',
          'generation',
          'path',
          'panel',
          'system',
        ].includes(key),
    )
  )
    throw new Error('invalid_plugin_request')
  switch (params.operation) {
    case 'plugin_exports': return pluginExports.page(params)
    case 'script_result': return sessions.readScriptResult(params)
    case 'build_info': return {...buildInfo(),native_sha256:await hashRom(hostPath),app_instance:appLogs.instance,app_root:appRoot,executable:process.execPath}
    case 'app_logs': return appLogs.read(params)
    case 'app_health': return appHealth()
    case 'app_status': return { ready: sessions.identity !== undefined, pid: process.pid }
    case 'load_rom': {
      if (Object.keys(params).some(key => !['operation', 'path', 'system'].includes(key)) || typeof params.path !== 'string' || !path.isAbsolute(params.path) || params.path.includes('\0') || (params.system !== undefined && typeof params.system !== 'string')) throw new Error('invalid_rom_request')
      return queueOperation(async () => {
        const stat = await fs.promises.stat(params.path)
        if (!stat.isFile()) throw new Error('rom_requires_file')
        const romHash = await hashRom(params.path)
        const alreadyLoaded = !!active?.romHash && active.romHash === romHash
        if (!alreadyLoaded) await start({ rom: params.path, system: params.system, agent: true, romHash })
        const reply = await sessions.request('session.status')
        if (!reply.ok) throw new Error(reply.error)
        return { ...reply.result, session: reply.session, epoch: reply.epoch, already_loaded: alreadyLoaded }
      })
    }
    case 'close_rom': {
      if (Object.keys(params).join(',') !== 'operation') throw new Error('invalid_rom_request')
      await queueOperation(() => start({ agent: true }))
      return { loaded: false, session: sessions.identity?.session, epoch: sessions.identity?.epoch }
    }

    case 'provenance': {
      if (Object.keys(params).sort().join(',') !== 'operation' && Object.keys(params).sort().join(',') !== 'enabled,operation') throw new Error('invalid_provenance_request')
      if (params.enabled !== undefined && typeof params.enabled !== 'boolean') throw new Error('invalid_provenance_request')
      const snapshot = params.enabled === undefined ? preferences.catalog() : await setPreference('debug.provenance', params.enabled)
      const entry = snapshot.entries.find(entry => entry.descriptor.id === 'debug.provenance')!
      return { enabled: entry.applied, requested: entry.value, pending: entry.pending, error: snapshot.error ?? null }
    }
    case 'logs':
      return plugins.logs(params.id, params.cursor, params.limit, params.generation)
    case 'screenshot': {
      if (!window || window.isDestroyed()) throw new Error('window_closed')
      if (typeof params.path !== 'string' || !path.isAbsolute(params.path)) throw new Error('absolute_path_required')
      let rect: Electron.Rectangle | undefined
      if (params.panel !== undefined) {
        if (typeof params.panel !== 'string' || params.panel.length > 256) throw new Error('invalid_panel')
        const selector = JSON.stringify(params.panel)
        rect = await window.webContents.executeJavaScript(`(() => {const all=[...document.querySelectorAll('[data-plugin-panel]')];const e=all.find(e=>e.dataset.pluginPanel===${selector} && e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0);if(!e)return;const r=e.getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`)
        if (!rect) throw new Error('panel_not_open')
      }
      const before=await window.webContents.executeJavaScript('window.overlaySnapshot?.()??null')
      const image = await window.webContents.capturePage(rect)
      const after=await window.webContents.executeJavaScript('window.overlaySnapshot?.()??null')
      const frame_reference=before?.frame&&after?.frame&&JSON.stringify(before)===JSON.stringify(after)?after.frame:null
      const overlay_geometry=frame_reference?{coordinate_space:'overlay_css',rect_coordinate_space:'window_css',...after.size,rect:after.rect,capture_rect:rect??null}:null
      await fs.promises.writeFile(params.path, image.toPNG(), { flag: 'wx' })
      return { frame_reference,overlay_geometry,frame_match:frame_reference?'renderer_submit':'unavailable_or_changed',path: params.path, source: params.panel === undefined ? 'window' : 'panel', panel: params.panel ?? null, ...image.getSize() }
    }
    case 'list':
      return pluginCatalog(params.offset ?? 0, params.limit ?? 4)
    case 'add':
      if (typeof params.source !== 'string' || !path.isAbsolute(params.source))
        throw new Error('source_requires_absolute_directory')
      await plugins.add(params.source)
      return pluginCatalog()
    case 'enable':
      await plugins.enable(params.id, params.enabled)
      return pluginCatalog()
    case 'resetStartup':
      await plugins.resetStartup()
      return pluginCatalog()
    case 'reload':
      await plugins.reload(params.id)
      return pluginCatalog()
    case 'open':
    case 'command':
      if (typeof params.token !== 'string' || typeof params.name !== 'string')
        throw new Error('plugin_token_and_name_required')
      if (plugins.authorize(params.token).manifest?.id !== params.id)
        throw new Error('plugin_id_mismatch')
      return pluginAction(params.token, params.operation, params.name)
    default:
      throw new Error('unknown_plugin_operation')
  }
})
export { stop as stopNative }
const installedHost = path.join(
  process.resourcesPath,
  'native/bin/ares-electron-host',
)
const installedLayout = app.isPackaged || fs.existsSync(installedHost)
const hostPath =
  process.env.ARES_HOST ||
  (installedLayout
    ? installedHost
    : path.resolve(appRoot, '../build-electron-make/bin/ares-electron-host'))
const resourceDirectory = process.env.ARES_RESOURCE_DIR || path.dirname(hostPath)
let generation = 0
const probe = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(hostPath, ['--resource-dir', resourceDirectory, ...args], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout.trim())
    })
  })
let window: BrowserWindow
if (!app.isPackaged && process.env.ARES_DEV_RELOAD === '1') {
  process.on('message', message => {
    if ((message as { type?: string } | null)?.type === 'ares-dev-reload' && window && !window.isDestroyed())
      window.webContents.reloadIgnoringCache()
  })
}
export const workspace = new WorkspaceStore(path.join(app.getPath('userData'), 'workspace.json'))
export const preferences = new SettingsStore(
  path.join(app.getPath('userData'), 'preferences.json'), [
    ...presentationSettings,
    ...agentSettings,
    ...nativeRuntimeSettings,
    ...inputDescriptors,
    { id: 'paths.importBml', title: 'Imported ares settings', section: 'Paths', type: 'string', file: { extensions: ['bml'] },
      default: path.join(app.getPath('userData'), 'settings.bml'), apply: 'next-rom' },
  ],
  snapshot => {
    if (window && !window.isDestroyed()) window.webContents.send('preferences-changed', snapshot)
  },
  async (id, value) => {
    if (id === 'agent.enabled') { await configureServices(value === true); return }
    if (id === 'debug.provenance') {
      if (sessions.identity) {
        const reply = await sessions.request('runtime.provenance', sessions.identity, { enabled: value === true })
        if (!reply.ok) throw new Error(reply.error)
      }
      return
    }
    if (!nativeRuntimeSettings.some(descriptor => descriptor.id === id)) return
    const session = active, identity = sessions.identity
    if (!session || !identity) throw new Error('no_session; applies on next ROM load')
    // Apply only this edit; other saved-but-pending controls must not be replayed.
    const entries = preferences.catalog().entries
    const get = (key: string) => key === id ? value : entries.find(entry => entry.descriptor.id === key)!.applied
    const configuration = {
      volume: get('audio.volume'), mute: get('audio.mute'), luminance: get('video.luminance'),
      saturation: get('video.saturation'), gamma: get('video.gamma'),
    }
    if (!validRuntimeSettings(configuration)) throw new Error('invalid_runtime_settings')
    const reply = await sessions.request('runtime.configure', identity, configuration)
    if (!reply.ok) throw new Error(reply.error)
    if (active !== session || sessions.identity?.session !== identity.session || sessions.identity?.epoch !== identity.epoch) throw new Error('stale_session')
    if (Object.keys(configuration).some(key => reply.result?.[key as keyof RuntimeSettings] !== configuration[key as keyof RuntimeSettings])) throw new Error('runtime_settings_not_applied')
  },
  {
    ...(process.env.ARES_SETTINGS ? { 'paths.importBml': process.env.ARES_SETTINGS } : {}),
    ...(serviceLaunchOverride() === undefined ? {} : { 'agent.enabled': serviceLaunchOverride() }),
  },
)
function appHealth(){return { instance: appLogs.instance, observed_at: new Date().toISOString(), native: { generation: active?.generation, failure: active?.failure, last_video_sequence: active?.lastSequence, ...sessions.health() }, last_error: appLogs.lastError, logs_directory: appLogs.directory,user_interaction_waits:pluginExports.waits() };}
const mainWatchdog=new MainWatchdog(appHealth,error=>appLogs.write('watchdog','error',error));
function serviceLaunchOverride(): boolean | undefined {
  const switches = process.argv.filter(arg => arg === '--services' || arg === '--no-services')
  if (switches.length) return switches.at(-1) === '--services'
  if (process.env.ARES_ENABLE_SERVICES === '1' || process.argv.includes('--instance-name')) return true
  return undefined
}
async function configureServices(enabled: boolean) {
  if (!enabled) { await mainWatchdog.close(); await serviceHost.close(); return }
  if (serviceHost.info) return
  const index = process.argv.indexOf('--instance-name')
  const name = index < 0 ? undefined : process.argv[index + 1]
  if (index >= 0 && (!name || name.startsWith('--'))) throw new Error('invalid_instance_name')
  const file = await serviceHost.listen(process.env.ARES_SERVICE_DIR, name, hostPath)
  try{await mainWatchdog.start(serviceHost.info!);}catch(error){await mainWatchdog.close();await serviceHost.close();throw error;}
  console.error(`ares service instance ${serviceHost.instance}: ${file}`)
}
let nativeSettingsRegistered = false
async function refreshNativeSettings() {
  const importedFile = String(preferences.catalog().entries.find(entry => entry.descriptor.id === 'paths.importBml')!.value)
  const info = parseNativeSettingsInfo(await probe(['--settings-info', '--settings', importedFile]))
  // A newer file choice can arrive while the metadata probe is running.
  if (preferences.catalog().entries.find(entry => entry.descriptor.id === 'paths.importBml')!.value !== importedFile) return
  if (!nativeSettingsRegistered) {
    preferences.register([...firmwareDescriptors(info), ...coreDescriptors(info)])
    nativeSettingsRegistered = true
  }
  preferences.inherit(importedValues(info, preferences.catalog().entries.map(entry => entry.descriptor)))
}
async function setPreference(id: string, value: unknown, reset = false, guard: () => void = () => {}) {
  if (reset) await preferences.reset(id, guard); else await preferences.set(id, value, guard)
  if (id === 'paths.importBml') await refreshNativeSettings()
  return preferences.catalog()
}
async function choosePreferenceFile(id: string, guard: () => void = () => {}) {
  guard()
  const descriptor = preferences.catalog().entries.find(entry => entry.descriptor.id === id)?.descriptor
  if (!descriptor?.file) throw new Error('not_a_file_setting')
  const result = await dialog.showOpenDialog(window, {
    title: descriptor.title, properties: ['openFile'],
    filters: descriptor.file.extensions.length ? [{ name: descriptor.title, extensions: descriptor.file.extensions }] : [],
  })
  return result.canceled ? preferences.catalog() : setPreference(id, result.filePaths[0], false, guard)
}
plugins.connectSettings(new PluginSettingsService(preferences, setPreference, choosePreferenceFile))
let active: NativeSession | null = null,
  port: MessagePortMain | null = null
let quitting = false,
  operation: Promise<void> = Promise.resolve()
const status = (text: string) => {
  if (window && !window.isDestroyed()) window.webContents.send('status', text)
}
function command(text: string) {
  if (active && !active.child.stdin.destroyed && active.child.stdin.writable)
    active.child.stdin.write(text + '\n')
}
async function stop() {
  const old = active
  if (!old) return
  active = null
  plugins.disconnect()
  sessions.detach()
  // EOF also releases the native command reader. Escalate only for a stuck host.
  old.child.stdin.end('quit\n')
  const timer = setTimeout(() => old.child.kill('SIGKILL'), 2000)
  await old.closed
  clearTimeout(timer)
}
async function hashRom(file: string) {
  const hash = createHash('sha256')
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}
async function start(options: StartOptions & { agent?: boolean; romHash?: string }) {
  const romHash = options.rom ? options.romHash ?? await hashRom(options.rom) : undefined
  let system = 'Synthetic'
  await refreshNativeSettings()
  const startupSettings = preferences.catalog()
  const settingsFile = String(startupSettings.entries.find(entry => entry.descriptor.id === 'paths.importBml')!.value)
  // Probe before stopping the running game, so an unsupported file leaves it intact.
  if (options.rom) {
    const identifyArgs = [
      '--identify',
      options.rom,
      '--save-dir',
      saveDirectory,
    ]
    if (options.system) identifyArgs.push('--system', options.system)
    if (settingsFile) identifyArgs.push('--settings', settingsFile)
    const matches = (await probe(identifyArgs)).split('\n').filter(Boolean)
    system = matches[0]
    if (!matches.length) throw new Error('unsupported_rom')
    if (matches.length > 1) {
      if (options.agent) throw new Error('ambiguous_system: supply system; choices: ' + matches.join(', '))
      const choice = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Choose system',
        message: 'This file can be loaded by more than one system.',
        buttons: [...matches, 'Cancel'],
        cancelId: matches.length,
      })
      if (choice.response === matches.length) return
      system = matches[choice.response]
    }
  }
  await stop()
  const args = options.rom ? ['--rom', options.rom] : ['--synthetic']
  if (options.rom) args.push('--system', system)
  if (options.agent) args.push('--paused')
  if (startupSettings.entries.find(entry => entry.descriptor.id === 'debug.provenance')!.value) args.push('--debug-provenance')
  for (const media of options.media || []) args.push('--media', media)
  if (settingsFile) args.push('--settings', settingsFile)
  if (options.hd) args.push('--1080p')
  if (options.silent || process.env.ARES_SILENT === '1') args.push('--silent')
  args.push('--save-dir', saveDirectory, '--resource-dir', resourceDirectory)
  const identity = { session: randomUUID(), epoch: 1 }
  args.push('--control-session', identity.session)
  const configurationDirectory = path.join(app.getPath('userData'), 'runtime-settings')
  fs.mkdirSync(configurationDirectory, { recursive: true })
  const configurationFile = path.join(configurationDirectory, `${identity.session}.bml`)
  fs.writeFileSync(configurationFile, nativeSettingsBml(startupSettings), { flag: 'wx', mode: 0o600 })
  args.push('--settings-overlay', configurationFile)
  const removeConfiguration = () => fs.rmSync(configurationFile, { force: true })
  const child = spawn(hostPath, args, {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  }) as ChildProcessByStdio<Writable, Readable, Readable>
  const session: NativeSession = {
    child,
    system,
    romHash,
    generation: ++generation,
    outstanding: false,
    lastSequence: 0,
    diagnostic: '',
    closed: Promise.resolve(),
  }
  session.closed = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      removeConfiguration()
      if (active === session) {
        active = null
        plugins.disconnect()
        sessions.detach()
        status(
          session.failure ||
            (code !== 0 || signal
              ? `Host stopped (${signal || code}). ${session.diagnostic}`
              : 'Host stopped. Open a ROM or restart a test.'),
        )
      }
      resolve()
    }),
  )
  active = session
  const client = new NativeSessionClient(
    child.stdin,
    child.stdio[3] as Readable,
    identity,
    (error) => {
      if (active === session) {
        appLogs.write('native','error',error,session.generation)
        session.failure = String(error)
        status(session.failure)
        child.kill()
      }
    },
  )
  sessions.attach(client)
  void client.request('session.status').then(reply => {
    removeConfiguration()
    if (reply.ok && active === session) {
      preferences.markApplied(startupSettings, 'next-rom')
      preferences.markApplied(startupSettings, 'live', [...nativeRuntimeSettings.map(descriptor => descriptor.id), 'debug.provenance'])
    }
  }).catch(error => status(String(error)))
  child.on('error', (error) => { appLogs.write('native', 'error', error, session.generation); status(`Cannot start native host: ${error.message}`) })
  child.on('close', (code, signal) => { appLogs.endNative(session.generation); appLogs.write('native', code ? 'error' : 'info', JSON.stringify({event:'exit',code,signal}), session.generation) })
  child.stdin.on('error', () => {}) // exit races are reported by close/error
  child.stderr.on('data', (data) => {
    appLogs.native(data, session.generation)
    session.diagnostic = data.toString().trim().slice(0,8192)
    if (active === session) status(session.diagnostic)
  })
  const parser = new FrameParser((frame) => {
    if (active !== session) return
    session.outstanding = true
    session.lastSequence = frame.sequence
    if(frame.frameReference)frame.frameReference={...frame.frameReference,native_session:identity.session,app_instance:serviceHost.instance}
    session.lastFrame = frame
    // This is intentionally a copied baseline. MessagePortMain does not transfer ArrayBuffers.
    port?.postMessage({
      ...frame,
      generation: session.generation,
      receivedMs: performance.timeOrigin + performance.now(),
    })
  })
  child.stdout.on('data', (data) => {
    try {
      parser.push(data)
    } catch (error) {
      session.failure = String(error)
      status(session.failure)
      child.kill()
    }
  })
  port?.postMessage({ reset: true, system })
  command('ack')
  if (options.agent) {
    const reply = await client.request('session.pause');
    if (!reply.ok) throw new Error(reply.error)
  }
}
function queueOperation<T>(task: () => Promise<T>) {
  const result = operation.then(task)
  operation = result.then(() => {}, () => {})
  return result
}
function enqueue(task: () => Promise<void>) {
  return queueOperation(task).catch((error) => {
    status(error.message)
    console.error(error)
  })
}
app
  .whenReady()
  .then(async () => {
    await refreshNativeSettings()
    await plugins.initialize(
      (process.env.ARES_PLUGIN_DIRS || '')
        .split(path.delimiter)
        .filter(Boolean),
      process.env.ARES_DEFAULT_PLUGINS === '0'
        ? []
        : [
            'ares.examples.memory',
            'ares.tools.debugger',
            'ares.tools.settings',
            'ares.tools.controls',
            'ares.examples.kirby',
          ],
      process.argv.includes('--disable-plugins') ||
        process.env.ARES_DISABLE_PLUGINS === '1',
    )
    protocol.handle('ares-plugin', async (request) => {
      try {
        const { bytes, type } = await plugins.resource(request.url)
        return new Response(new Uint8Array(bytes), {
          headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' },
        })
      } catch {
        return new Response('Plugin resource unavailable or scope expired', {
          status: 404,
        })
      }
    })
    await configureServices(preferences.catalog().entries.find(entry => entry.descriptor.id === 'agent.enabled')!.value === true)
    window = new BrowserWindow({
      show: process.env.ARES_BACKGROUND_TEST !== '1',
      width: 1100,
      height: 800,
      minWidth: 650,
      minHeight: 480,
      backgroundColor: '#000000',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
      webPreferences: {
        preload: path.join(appRoot, 'dist/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    const action = (name: Parameters<Parameters<import('./bridge.js').AresBridge['onAction']>[0]>[0]) => () => window.webContents.send('app-action', name)
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: app.getName(), submenu: [
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: action('settings') },
        { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
        { type: 'separator' as const }, { role: 'quit' as const },
      ] }] : []),
      { label: 'File', submenu: [
        { label: 'Open ROM…', accelerator: 'CmdOrCtrl+O', click: action('open') },
        ...(process.platform !== 'darwin' ? [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: action('settings') }] : []),
        { role: 'close' as const },
      ] },
      { role: 'editMenu' },
      { label: 'Emulation', submenu: [
        { label: 'Pause / Resume', accelerator: 'CmdOrCtrl+P', click: action('pause') },
        { label: 'Reset', accelerator: 'CmdOrCtrl+Shift+R', click: action('reset') },
      ] },
      { label: 'View', submenu: [
        { id: 'reload-interface', label: 'Reload Interface', accelerator: 'CmdOrCtrl+R', click: () => window.webContents.reload() },
        { id: 'show-developer-tools', label: 'Show Developer Tools', accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I', click: () => window.webContents.openDevTools({ mode: 'bottom' }) },
        { type: 'separator' },
        { label: 'Customize Workspace', accelerator: 'CmdOrCtrl+Shift+L', click: action('edit-workspace') },
        { label: 'Video Only', click: action('reset-workspace') },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ] },
      { role: 'windowMenu' },
    ]))
    for (const operation of ['load', 'save'] as const) ipcMain.handle('workspace.' + operation, (event, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('invalid_sender')
      if (operation === 'load' && args.length === 0) return workspace.load()
      if (operation === 'save' && args.length === 1) return workspace.save(args[0] as import('./workspace/model.js').WorkspaceLayout)
      throw new Error('invalid_request')
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('render-process-gone', (_event, details) => {
      appLogs.write('renderer', 'error', JSON.stringify(details))
      observerDeliveries.clear()
      plugins.detach()
      port?.close()
      port = null
    })
    window.webContents.on('did-start-loading', () => {
      observerDeliveries.clear()
      plugins.detach()
      port?.close()
      port = null
    })
    ipcMain.on('ready', (event) => {
      if (event.sender !== window.webContents) return
      port?.close()
      const channel = new MessageChannelMain()
      port = channel.port1
      port.on('message', ({ data }) => {
        if (port !== channel.port1) return
        if (
          active &&
          data?.generation === active.generation &&
          data?.ack === active.lastSequence &&
          active.outstanding
        ) {
          if(data.submitted&&active.lastFrame?.frameReference)active.lastPresentation={...active.lastFrame.frameReference,presentation:{window:'main',sequence:data.ack,stage:'renderer_submit'},provenance:'matched'}
          active.outstanding = false
          command('ack')
        }
      })
      port.start()
      window.webContents.postMessage('frames', null, [channel.port2])
      if (active) {
        port.postMessage({ reset: true, system: active.system })
        if (active.outstanding && active.lastFrame)
          port.postMessage({
            ...active.lastFrame,
            generation: active.generation,
            receivedMs: performance.timeOrigin + performance.now(),
          })
      } else
        enqueue(() =>
          start(
            process.env.ARES_ROM
              ? { rom: process.env.ARES_ROM, system: process.env.ARES_SYSTEM }
              : { hd: process.env.ARES_HD === '1' },
          ),
        )
    })
    ipcMain.handle(
      'plugin.actionResult',
      (event, id: string, token: string, error?: string) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('invalid_sender')
        const action = pluginActions.get(id)
        if (!action || action.token !== token) return
        pluginActions.delete(id)
        clearTimeout(action.timer)
        try {
          plugins.authorize(token)
          if (error) throw new Error(String(error).slice(0, 2048))
          action.resolve()
        } catch (error) {
          action.reject(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
      },
    )
    for (const name of [
      'catalog',
      'enable',
      'add',
      'refresh',
      'request',
      'storage',
      'settings',
      'log',
      'fail',
      'reload',
      'begin',
      'finish',
      'reject',
      'rollback',
    ] as const) {
      ipcMain.handle('plugin.' + name, async (event, ...args) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('invalid_sender')
        switch (name) {
          case 'catalog':
            return plugins.attach()
          case 'reload':
            return plugins.reload(args[0])
          case 'begin':
            return plugins.begin(args[0])
          case 'finish':
            return plugins.finish(args[0])
          case 'reject':
            return plugins.reject(args[0], args[1])
          case 'rollback':
            return plugins.rollback(args[0], args[1])
          case 'enable':
            return plugins.enable(args[0], args[1])
          case 'refresh':
            return plugins.refresh()
          case 'request':
            return pluginBridgeResult(async() => {const result=await plugins.request(args[0],args[1],args[2]);if(args[1]==='script.observerStop'&&args[2]?.observerId)observerDeliveries.stop('plugin-'+args[0],args[2].observerId);return result;})
          case 'settings':
            return pluginBridgeResult(() => plugins.settings(args[0], args[1]))
          case 'storage':
            return plugins.storage(args[0], args[1], args[2], args[3])
          case 'fail':
            return plugins.fail(args[0], args[1])
          case 'log':
            return plugins.log(args[0], args[1], args[2])
          case 'add': {
            const result = await dialog.showOpenDialog(window, {
              title: 'Add trusted local plugin directory',
              properties: ['openDirectory'],
            })
            return result.canceled
              ? plugins.catalog()
              : plugins.add(result.filePaths[0])
          }
        }
      })
    }
    ipcMain.handle(
      'session',
      async (
        event,
        method: ServiceMethod,
        identity?: SessionIdentity,
        params?: ServiceParams<ServiceMethod>,
      ) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('invalid_sender')
        if (!['session.status', 'memory.regions'].includes(method) && !identity)
          throw new Error('invalid_request')
        return sessions.request(method, identity, params)
      },
    )
    ipcMain.handle('agent.action', async (event, action: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('invalid_sender')
      const bundled = isBundledCliRuntime(appRoot, process.execPath)
      if (action === 'install') return installCliHelpers(appRoot, bundled, process.execPath)
      if (action === 'copy' || action === 'preview') {
        if (action === 'copy' && (!serviceHost.info || !serviceHost.metadataFile)) throw new Error('Enable MCP and CLI access first')
        const configuration = await mcpConfiguration(appRoot, bundled, process.execPath)
        const json = JSON.stringify(configuration, null, 2)
        if (action === 'preview') return json
        await clipboard.writeText(json)
        return 'MCP configuration copied'
      }
      throw new Error('invalid_request')
    })
    for (const operation of ['catalog', 'set', 'reset', 'chooseFile'] as const) {
      ipcMain.handle('preferences.' + operation, (event, ...args: unknown[]) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
          throw new Error('invalid_sender')
        if (operation === 'catalog' && args.length === 0) return preferences.catalog()
        if (operation === 'set' && args.length === 2 && typeof args[0] === 'string')
          return setPreference(args[0], args[1])
        if (operation === 'reset' && args.length === 1 && typeof args[0] === 'string')
          return setPreference(args[0], undefined, true)
        if (operation === 'chooseFile' && args.length === 1 && typeof args[0] === 'string')
          return choosePreferenceFile(args[0])
        throw new Error('invalid_request')
      })
    }
    ipcMain.handle('systems', async (event) => {
      if (event.sender !== window.webContents) return []
      return (await probe(['--systems'])).split('\n').filter(Boolean)
    })
    ipcMain.handle('settings', async (event) => {
      if (event.sender !== window.webContents) return
      const result = await dialog.showOpenDialog(window, {
        title: 'Use ares firmware and core settings',
        properties: ['openFile'],
        filters: [{ name: 'ares settings', extensions: ['bml'] }],
      })
      if (!result.canceled) {
        await setPreference('paths.importBml', result.filePaths[0])
        status('Selected ares settings; they will apply to the next ROM.')
      }
    })
    ipcMain.handle('open', async (event, options) => {
      if (event.sender !== window.webContents) return
      const result = await dialog.showOpenDialog(window, {
        title: 'Open ROM (additional selections supply companion media)',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'All ROMs and media', extensions: ['*'] }],
      })
      if (!result.canceled)
        await enqueue(() =>
          start({
            rom: result.filePaths[0],
            media: result.filePaths.slice(1),
            system: typeof options?.system === 'string' ? options.system : '',
          }),
        )
    })
    ipcMain.on('command', (event, data: NativeCommand) => {
      if (event.sender !== window.webContents || !data) return
      if (data.type === 'synthetic')
        enqueue(() => start({ hd: data.hd === true }))

      if (
        data.type === 'input' &&
        Number.isInteger(data.sequence) &&
        Number.isInteger(data.mask)
      ) {
        const axis = (value: number | undefined) =>
          typeof value === 'number' && Number.isFinite(value)
            ? Math.max(-32767, Math.min(32767, Math.round(value)))
            : 0
        command(
          `input ${data.sequence >>> 0} ${data.mask >>> 0} ${axis(data.x)} ${axis(data.y)} ${axis(data.rx)} ${axis(data.ry)}`,
        )
      }
      if (
        data.type === 'key' &&
        typeof data.name === 'string' &&
        /^[A-Za-z0-9]{1,32}$/.test(data.name)
      ) {
        command(`key ${data.name} ${data.value ? 1 : 0}`)
      }
      if (data.type === 'clear') command('clear')
      if (data.type === 'mouse') {
        const limit = (value: number | undefined) =>
          typeof value === 'number' && Number.isFinite(value)
            ? Math.max(-32767, Math.min(32767, Math.round(value)))
            : 0
        command(`mouse ${limit(data.x)} ${limit(data.y)} ${data.mask & 15}`)
      }
      if (data.type === 'report') {
        // Opt-in automated renderer smoke test; no general filesystem API is exposed.
        if (process.env.ARES_REPORT)
          fs.writeFileSync(
            process.env.ARES_REPORT,
            JSON.stringify(data.report, null, 2),
          )
        if (process.env.ARES_AUTOTEST === '1') app.quit()
      }
    })
    void window.loadFile(path.join(appRoot, 'index.html'), {
      query: {
        autotest: process.env.ARES_AUTOTEST || '',
        duration: process.env.ARES_TEST_SECONDS || '12',
      },
    }).catch((error: NodeJS.ErrnoException) => {
      // Closing the window during startup aborts its pending navigation.
      if (quitting && error.code === 'ERR_ABORTED') return
      fatal(error)
    })
  })
  .catch((error) => {
    console.error(error)
    app.quit()
  })
app.on('window-all-closed', () => app.quit())
let quitReady=false
app.on('before-quit', (event) => {
  if (quitReady) return
  event.preventDefault()
  if(quitting)return
  quitting = true
  void (async()=>{
    // Window closure or another signal can request quit again while these await.
    // Keep every request blocked until all owners and service claims are released.
    for(const close of [()=>enqueue(stop),()=>plugins.close(),()=>mainWatchdog.close(),()=>serviceHost.close()]){
      try{await close()}catch(error){appLogs.write('main','error',error)}
    }
    quitReady=true
    app.quit()
  })()
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())
