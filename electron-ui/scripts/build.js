import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildSync} from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const compiler = path.join(path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');
fs.rmSync(path.join(root, 'dist'), {recursive: true, force: true});
const run = args => execFileSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
for (const config of ['tsconfig.json', 'tsconfig.browser.json', 'tsconfig.preload.json']) run([compiler, '-p', config]);
// Electron's sandbox executes plain JS with a restricted require('electron').
// Author the preload as a module; bundle it into one compatible runtime script.
buildSync({
  entryPoints: [path.join(root, 'preload.ts')],
  outfile: path.join(root, 'dist/preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
run(['scripts/generate-sdk.js']);
run(['scripts/build-info.js']);
