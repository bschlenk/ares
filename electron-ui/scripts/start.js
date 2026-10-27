import {watchUI} from './watch-ui.js';
import electron from 'electron';
// Each launch owns its compiled JS and native executable.
// Bundled plugin sources stay live so their existing watchers support authoring.
// Tests/package builds can clean dist and rebuild C++ while this app is running.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..')
const launches = path.join(root, 'artifacts', 'runs')
fs.mkdirSync(launches, { recursive: true })
const snapshot = fs.mkdtempSync(path.join(launches, 'launch-'))
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, mode: fs.constants.COPYFILE_FICLONE })
let child
let stopWatching
const watch = process.argv.includes('--watch')
try {
  for (const entry of fs.readdirSync(root)) {
    if (/\.(?:ts|cts|json|html|css)$/.test(entry) || ['plugins', 'services', 'settings', 'workspace', 'scripts', 'mcp', 'templates', 'tools'].includes(entry))
      copy(path.join(root, entry), path.join(snapshot, entry))
  }
  fs.symlinkSync(path.join(root, 'bundled-plugins'), path.join(snapshot, 'bundled-plugins'), 'dir')
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir')
  execFileSync(process.execPath, ['scripts/build.js'], { cwd: snapshot, stdio: 'inherit', env: process.env })
  const nativeBuild = process.env.ARES_NATIVE_BUILD_DIR || 'build_macos/workbench'
  const workbenchHost = path.resolve(root, '..', nativeBuild, 'bin/ares-electron-host')
  const sourceHost = path.resolve(process.env.ARES_HOST || (fs.existsSync(workbenchHost) ? workbenchHost : path.join(root, '../build-electron-make/bin/ares-electron-host')))
  if (!fs.existsSync(sourceHost)) throw new Error('Native host not found. Run npm run build:mac first, or set ARES_HOST.')
  const native = path.join(snapshot, 'native')
  fs.mkdirSync(path.join(native, 'bin'), { recursive: true })
  const host = path.join(native, 'bin', 'ares-electron-host')
  copy(sourceHost, host)
  // Match both nall CLI resource lookup and executable-adjacent lookup.
  for (const destination of [path.join(native, 'Database'), path.join(native, 'bin', 'Database')])
    copy(path.join(process.env.ARES_RESOURCE_DIR || path.join(root, '../mia'), 'Database'), destination)
  const env = { ...process.env, ARES_HOST: host, ARES_PROFILE: process.env.ARES_PROFILE || 'development', ARES_RESOURCE_DIR: path.join(native, 'bin') }
  if (watch) env.ARES_DEV_RELOAD = '1'
  for (const key of ['ARES_ROM', 'ARES_SETTINGS', 'ARES_SAVE_DIR', 'ARES_REPORT', 'ARES_SERVICE_DIR', 'ARES_PROFILE_DIR'])
    if (env[key]) env[key] = path.resolve(env[key])
  if (env.ARES_PLUGIN_DIRS)
    env.ARES_PLUGIN_DIRS = env.ARES_PLUGIN_DIRS.split(path.delimiter).map(directory => path.resolve(directory)).join(path.delimiter)
  console.error(`Development runtime: ${snapshot}`)
  child = spawn(electron, [snapshot, ...process.argv.slice(2).filter(arg => arg !== '--watch')], { cwd: root, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] })
  if (watch) stopWatching = watchUI(root, snapshot, () => {
    if (child.connected) child.send({ type: 'ares-dev-reload' })
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('close', (code, signal) => {
    stopWatching?.()
    fs.rmSync(snapshot, { recursive: true, force: true })
    process.exitCode = code ?? (signal ? 1 : 0)
  })
} catch (error) {
  stopWatching?.()
  child?.kill()
  fs.rmSync(snapshot, { recursive: true, force: true })
  console.error(error)
  process.exitCode = 1
}
