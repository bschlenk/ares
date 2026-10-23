import fs from 'node:fs/promises';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const marker = '# Ares Workbench CLI helper';
/** Electron's isPackaged can be false for our copied Electron-named executable.
 * Match the actual self-contained layout; never install from a disposable npm snapshot. */
export function isBundledCliRuntime(appRoot: string, executable: string): boolean {
  try {
    const contents = path.dirname(path.dirname(realpathSync(executable)));
    if (path.basename(contents) !== 'Contents' || path.basename(path.dirname(executable)) !== 'MacOS') return false;
    if (realpathSync(appRoot) !== realpathSync(path.join(contents, 'Resources/app'))) return false;
    return ['ares-mcp', 'ares-plugin', 'native/bin/ares-electron-host'].every(file => {
      const stat = statSync(path.join(contents, 'Resources', file));
      return stat.isFile() && !!(stat.mode & 0o111);
    });
  } catch { return false; }
}
const shellWord = (value: string) => {
  const home = os.homedir();
  const safe = (word: string) => /^[a-zA-Z0-9_./:-]+$/.test(word) ? word : quote(word);
  if (value === home) return '~';
  return value.startsWith(home + '/') ? '~/' + safe(value.slice(home.length + 1)) : safe(value);
};
export async function mcpConfiguration(appRoot: string, packaged: boolean, executable: string, connection: string, instance: string, name?: string, directory?: string) {
  const args = name ? ['--service-dir', directory!, '--instance-name', name] : ['--connection', connection, '--instance', instance];
  let command = path.join(appRoot, '../ares-mcp');
  if (packaged) {
    const helper = path.join(os.homedir(), '.local/bin/ares-mcp');
    try {
      const stat = await fs.lstat(helper);
      if (stat.isFile() && (stat.mode & 0o111) && (await fs.readFile(helper, 'utf8')).startsWith(`#!/bin/sh\n${marker}\n`)) command = helper;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const words = packaged ? [command, ...args] : [executable, path.join(appRoot, 'dist/mcp/server.js'), ...args];
  // MCP clients spawn commands directly. Explicitly use a shell to expand home
  // paths, quoting every argument so paths/names cannot become shell commands.
  return { mcpServers: { ares: {
    command: '/bin/sh', args: ['-c', 'exec ' + words.map(shellWord).join(' ')],
    ...(!packaged ? { env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', NODE_PATH: '' } } : {}),
  } } };
}
export async function installCliHelpers(appRoot: string, packaged: boolean, executable: string): Promise<string> {
  if (!packaged) throw new Error('Open the built Ares.app (for example build_macos/Ares.app) to install CLI helpers; temporary npm development launches cannot install them');
  const directory = path.join(os.homedir(), '.local/bin');
  const commands = {
    ares: executable,
    'ares-mcp': path.resolve(appRoot, '../ares-mcp'),
    'ares-plugin': path.resolve(appRoot, '../ares-plugin'),
  };
  await fs.mkdir(directory, { recursive: true });
  // Refuse to replace unrelated commands, including symlinks.
  for (const name of Object.keys(commands)) {
    const file = path.join(directory, name);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || !(await fs.readFile(file, 'utf8')).startsWith(`#!/bin/sh\n${marker}\n`)) throw new Error(`Existing command was not installed by Ares: ${file.startsWith(os.homedir() + '/') ? '~/' + file.slice(os.homedir().length + 1) : file}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const [name, command] of Object.entries(commands)) {
    const file = path.join(directory, name), temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `#!/bin/sh\n${marker}\nunset ELECTRON_RUN_AS_NODE NODE_OPTIONS NODE_PATH ELECTRON_ENABLE_LOGGING\nexec ${quote(command)} "$@"\n`, { flag: 'wx', mode: 0o755 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return `Installed ares, ares-mcp and ares-plugin in ~/.local/bin. Add this directory to PATH if needed. Reinstall helpers after moving Ares.app.`;
}
