import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

/** Disposable CLI output, separated by canonical plugin source directory. */
export function pluginBuildCache(source: string, options: {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const absolute = (value: string | undefined) => value && path.isAbsolute(value) ? value : undefined;
  const root = platform === 'darwin'
    ? path.join(home, 'Library', 'Caches', 'Ares Workbench')
    : platform === 'win32'
      ? path.join(absolute(env.LOCALAPPDATA) ?? path.join(home, 'AppData', 'Local'), 'Ares Workbench', 'Cache')
      : path.join(absolute(env.XDG_CACHE_HOME) ?? path.join(home, '.cache'), 'ares-workbench');
  const sourceKey = createHash('sha256').update(source).digest('hex');
  return path.join(root, 'plugin-builds', sourceKey);
}
