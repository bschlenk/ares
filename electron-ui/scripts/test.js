import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, ['scripts/build.js'], {cwd: root, stdio: 'inherit'});
const tests = fs.readdirSync(path.join(root, 'tests')).filter(file => /\.test\.(?:cjs|js)$/.test(file)).sort().map(file => `tests/${file}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2), 'protocol.test.cjs', ...tests], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
