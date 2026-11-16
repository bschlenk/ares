import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function privateDirectory(directory: string): string {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || stat.mode & 0o077)
    throw new Error('insecure_session_directory');
  return directory;
}

export function readJson<T>(filename: string, limit = 1024 * 1024, privateMetadata = false): T {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('invalid_metadata_file');
    if (privateMetadata && ((process.getuid && stat.uid !== process.getuid()) || stat.mode & 0o077)) throw new Error('insecure_metadata_file');
    const text = fs.readFileSync(fd, 'utf8');
    if (Buffer.byteLength(text) > limit) throw new Error('invalid_metadata_file');
    return JSON.parse(text) as T;
  } finally { fs.closeSync(fd); }
}

/** Publish a complete, durable file, then sync its directory before returning. */
export function publish(filename: string, content: string | Buffer): void {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filename);
    syncDirectory(path.dirname(filename));
  } finally { fs.rmSync(temporary, {force: true}); }
}
export function publishJson(filename: string, value: unknown): void {
  publish(filename, JSON.stringify(value, null, 2) + '\n');
}
export function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
