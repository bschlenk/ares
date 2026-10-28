import fs from 'node:fs';
import path from 'node:path';

// Exclude dependencies/output rather than enumerating application source folders.
// Native binaries are copied separately; bundled plugins have their own live watcher.
const excluded = new Set(['node_modules', 'artifacts', 'dist', 'native', 'tests', 'bundled-plugins']);

export function discoverDevSources(root) {
  const files = new Set(), directories = new Set();
  function walk(relative) {
    directories.add(relative);
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.add(name);
    }
  }
  walk('');
  return { files, directories };
}

export function copyDevSources(root, snapshot) {
  const sources = discoverDevSources(root);
  for (const directory of sources.directories) fs.mkdirSync(path.join(snapshot, directory), { recursive: true });
  for (const file of sources.files) fs.copyFileSync(path.join(root, file), path.join(snapshot, file), fs.constants.COPYFILE_FICLONE);
}
