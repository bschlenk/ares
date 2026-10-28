import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {discoverDevSources} from './dev-sources.js';
import {compiler, runtimeSources, stageRuntime, publishRuntime} from './dev-build.js';

// Publish only successful renderer builds into the launch's private snapshot.
// Host changes are staged separately and restart Electron only after a good build.
function watchUI(root, snapshot, reload, {restart} = {}) {
  const pending = new Set(), watchers = new Map()
  let timer, discoveryTimer, compiling, running = false, closed = false, revision = 0
  let runtimePending = false, dependencies = runtimeSources(root)
  let sources = { files: new Set(), directories: new Set() }
  const changed = relative => {
    if (!relative || !/\.(?:[cm]?[jt]sx?|json|css|html|png|jpg|jpeg|svg|webp|icns)$/.test(relative)) return
    revision++
    pending.add(relative)
    clearTimeout(timer)
    timer = setTimeout(build, 120)
  }
  async function build() {
    if (running || closed || !pending.size) return
    running = true
    const buildRevision = revision
    let succeeded = false
    const batch = [...pending]; pending.clear()
    const next = path.join(snapshot, '.browser-next')
    let stage
    try {
      const host = runtimeSources(root)
      const full = runtimePending || batch.some(file => host.has(file) || dependencies.has(file) || /\.(?:json|[cm]?js)$/.test(file))
      if (full) {
        runtimePending = true
        stage = stageRuntime(root, snapshot)
        console.error('[dev] Building application…')
        const code = await new Promise((resolve, reject) => {
          compiling = spawn(process.execPath, ['scripts/build.js'], {cwd: stage, stdio: 'inherit'})
          compiling.once('error', reject); compiling.once('close', resolve)
        })
        compiling = undefined
        if (closed) return
        if (code !== 0) throw new Error('Application build failed; keeping the running app. Save a correction to retry.')
        if (!restart) throw new Error('Application restart handler is unavailable')
        console.error('[dev] Restarting application (current ROM will reload).')
        await restart(() => publishRuntime(stage, snapshot))
        runtimePending = false; dependencies = host
        succeeded = true
        return
      }
      // Watch events trigger builds; derive their inputs from the current tree.
      // Editors and directory creation can coalesce or reorder notifications.
      const currentSources = discoverDevSources(root).files
      const typescript = file => /\.(?:ts|tsx|cts)$/.test(file)
      for (const relative of currentSources) if (typescript(relative)) {
        const destination = path.join(snapshot, relative)
        fs.mkdirSync(path.dirname(destination), {recursive:true})
        fs.copyFileSync(path.join(root, relative), destination)
      }
      for (const relative of discoverDevSources(snapshot).files) {
        if (typescript(relative) && !currentSources.has(relative)) fs.rmSync(path.join(snapshot, relative), {force:true})
      }
      for (const relative of batch) {
        if (!currentSources.has(relative)) fs.rmSync(path.join(snapshot, relative), {force:true})
      }
      fs.rmSync(next, { recursive: true, force: true })
      console.error('[dev] Building renderer…')
      const code = await new Promise((resolve, reject) => {
        compiling = spawn(process.execPath, [compiler, '-p', 'tsconfig.browser.json', '--outDir', next, '--noEmitOnError'], { cwd: snapshot, stdio: 'inherit' })
        compiling.once('error', reject)
        compiling.once('close', resolve)
      })
      compiling = undefined
      if (closed) return
      if (code !== 0) {
        console.error('[dev] Build failed; keeping the previous UI. Save a correction to retry.')
        // Keep pending HTML/CSS changes for the next successful build.
        for (const relative of batch.filter(file => !/\.(?:ts|tsx|cts)$/.test(file))) pending.add(relative)
        return
      }
      const browser = path.join(snapshot, 'dist/browser'), previous = path.join(snapshot, '.browser-previous')
      fs.rmSync(previous, { recursive: true, force: true })
      fs.renameSync(browser, previous)
      fs.renameSync(next, browser)
      fs.rmSync(previous, { recursive: true, force: true })
      for (const relative of batch.filter(file => !/\.(?:ts|tsx|cts)$/.test(file))) {
        const source = path.join(root, relative)
        if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(path.join(snapshot, relative)), {recursive:true}); fs.copyFileSync(source, path.join(snapshot, relative)) }
      }
      console.error('[dev] Reloading UI (emulator session preserved).')
      succeeded = true
      dependencies = host
      reload()
    } catch (error) {
      if (!closed) console.error('[dev]', error)
      // A later successful build must include assets from a failed attempt.
      for (const relative of batch.filter(file => !/\.(?:ts|tsx|cts)$/.test(file))) pending.add(relative)
    } finally {
      if (stage) fs.rmSync(stage, {recursive:true,force:true})
      running = false
      // Changes arriving during compilation get their own build. A failed build
      // waits for the next save instead of retrying indefinitely.
      if (!closed && pending.size && (succeeded || revision !== buildRevision)) timer = setTimeout(build, 120)
    }
  }
  function discover(initial = false) {
    if (closed) return
    const next = discoverDevSources(root)
    for (const [directory, watcher] of watchers) if (!next.directories.has(directory)) {
      watcher.close(); watchers.delete(directory)
    }
    for (const directory of next.directories) if (!watchers.has(directory)) {
      // Watch only discovered directories, so dependencies and snapshots are never
      // traversed by a recursive OS watcher. Rescan to discover new directories.
      watchers.set(directory, fs.watch(path.join(root, directory), (_event, file) => {
        const relative = file && path.join(directory, file.toString())
        if (relative && sources.files.has(relative)) changed(relative)
        clearTimeout(discoveryTimer)
        discoveryTimer = setTimeout(() => {
          try { discover() } catch (error) { if (!closed) console.error('[dev]', error) }
        }, 25)
      }))
    }
    if (!initial) {
      for (const file of next.files) if (!sources.files.has(file)) changed(file)
      for (const file of sources.files) if (!next.files.has(file)) changed(file)
    }
    sources = next
  }
  discover(true)
  console.error('[dev] Watching sources: UI reloads, host/preload changes restart automatically; C++ needs a native rebuild.')
  return () => {
    closed = true; clearTimeout(timer); clearTimeout(discoveryTimer)
    for (const watcher of watchers.values()) watcher.close()
    compiling?.kill()
  }
}
export { watchUI }
