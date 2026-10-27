import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Publish only successful renderer builds into the launch's private snapshot.
// Main/preload changes require a restart; the native host survives UI reloads.
function watchUI(root, snapshot, reload) {
  const pending = new Set(), watchers = []
  let timer, compiling, running = false, closed = false, revision = 0
  const directories = ['plugins', 'services', 'settings', 'workspace']
  const changed = relative => {
    if (!relative || !/\.(ts|tsx|cts|css|html)$/.test(relative)) return
    if (['main.ts', 'preload.ts', 'profile.ts'].includes(relative)) {
      console.error(`[dev] ${relative} changed; restart npm run dev to apply main/preload changes.`)
      return
    }
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
    try {
      for (const relative of batch) {
        const source = path.join(root, relative), destination = path.join(snapshot, relative)
        if (fs.existsSync(source)) {
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          // HTML/CSS are published alongside the successful JS build below.
          if (/\.tsx?$/.test(relative)) fs.copyFileSync(source, destination)
        } else fs.rmSync(destination, { force: true })
      }
      fs.rmSync(next, { recursive: true, force: true })
      console.error('[dev] Building renderer…')
      const code = await new Promise((resolve, reject) => {
        compiling = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc'), '-p', 'tsconfig.browser.json', '--outDir', next, '--noEmitOnError'], { cwd: snapshot, stdio: 'inherit' })
        compiling.once('error', reject)
        compiling.once('close', resolve)
      })
      compiling = undefined
      if (closed) return
      if (code !== 0) {
        console.error('[dev] Build failed; keeping the previous UI. Save a correction to retry.')
        // Keep pending HTML/CSS changes for the next successful build.
        for (const relative of batch.filter(file => /\.(html|css)$/.test(file))) pending.add(relative)
        return
      }
      const browser = path.join(snapshot, 'dist/browser'), previous = path.join(snapshot, '.browser-previous')
      fs.rmSync(previous, { recursive: true, force: true })
      fs.renameSync(browser, previous)
      fs.renameSync(next, browser)
      fs.rmSync(previous, { recursive: true, force: true })
      for (const relative of batch.filter(file => /\.(html|css)$/.test(file))) {
        const source = path.join(root, relative)
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(snapshot, relative))
      }
      console.error('[dev] Reloading UI (emulator session preserved).')
      succeeded = true
      reload()
    } catch (error) {
      if (!closed) console.error('[dev]', error)
    } finally {
      running = false
      // Changes arriving during compilation get their own build. A failed build
      // waits for the next save instead of retrying indefinitely.
      if (!closed && pending.size && (succeeded || revision !== buildRevision)) timer = setTimeout(build, 120)
    }
  }
  watchers.push(fs.watch(root, (_event, file) => changed(file?.toString())))
  for (const directory of directories) watchers.push(fs.watch(path.join(root, directory), { recursive: true }, (_event, file) => {
    if (file) changed(path.join(directory, file.toString()))
  }))
  console.error('[dev] Watching UI sources; main/preload and C++ edits require a restart/rebuild.')
  return () => {
    closed = true; clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
    compiling?.kill()
  }
}
export { watchUI }
