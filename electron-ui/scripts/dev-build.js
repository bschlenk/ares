import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyDevSources, discoverDevSources} from './dev-sources.js';

export const compiler = path.join(path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');

/** Ask the compiler for transitive dependencies, including newly imported files. */
export function runtimeSources(root) {
  root = fs.realpathSync(root);
  const files = new Set();
  for (const config of ['tsconfig.json', 'tsconfig.preload.json']) {
    if (!fs.existsSync(path.join(root, config))) continue;
    const output = execFileSync(process.execPath, [compiler, '-p', config, '--listFilesOnly'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    for (const filename of output.split(/\r?\n/)) {
      const relative = path.relative(root, filename.trim());
      if (relative && !relative.startsWith('..') && !relative.split(path.sep).includes('node_modules')) files.add(relative);
    }
  }
  return files;
}

export function stageRuntime(root, snapshot) {
  const stage = path.join(snapshot, '.runtime-next');
  fs.rmSync(stage, {recursive: true, force: true});
  copyDevSources(root, stage);
  for (const name of ['node_modules', 'bundled-plugins']) {
    if (fs.existsSync(path.join(root, name))) fs.symlinkSync(fs.realpathSync(path.join(root, name)), path.join(stage, name), 'dir');
  }
  return stage;
}

export function publishRuntime(stage, snapshot) {
  const previous = path.join(snapshot, '.runtime-previous');
  fs.rmSync(previous, {recursive: true, force: true});
  fs.renameSync(path.join(snapshot, 'dist'), previous);
  try { fs.renameSync(path.join(stage, 'dist'), path.join(snapshot, 'dist')); }
  catch (error) { fs.renameSync(previous, path.join(snapshot, 'dist')); throw error; }
  const next = discoverDevSources(stage), current = discoverDevSources(snapshot);
  for (const file of current.files) if (!next.files.has(file)) fs.rmSync(path.join(snapshot, file), {force: true});
  copyDevSources(stage, snapshot);
  fs.rmSync(previous, {recursive: true, force: true});
}
