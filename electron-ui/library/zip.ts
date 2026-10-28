import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { crc32, createInflateRaw } from 'node:zlib';

/** Read directory metadata only; MIA decompresses the original archive on launch. */
export interface ZipEntry { name: string; crc32: string; size: number; compressedSize: number; method: number; offset: number }
export async function zipEntries(filename: string): Promise<ZipEntry[]> {
  const file = await fs.open(filename, 'r');
  try {
    const { size } = await file.stat();
    const read = async (offset: number, length: number) => {
      const bytes = Buffer.alloc(length);
      let count = 0;
      while (count < length) {
        const result = await file.read(bytes, count, length - count, offset + count);
        if (!result.bytesRead) throw new Error('Truncated ZIP archive');
        count += result.bytesRead;
      }
      return bytes;
    };
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = tail.length - 22;
    for (; end >= 0; --end) {
      if (tail.readUInt32LE(end) === 0x06054b50 && end + 22 + tail.readUInt16LE(end + 20) === tail.length) break;
    }
    if (end < 0) throw new Error('Invalid ZIP directory');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported by the library scanner');
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) throw new Error('Split ZIP archives are not supported');
    if (count > 10000 || length > 4 * 1024 * 1024) throw new Error('ZIP directory exceeds the scan limit');
    if (offset + length > size - tail.length + end) throw new Error('Invalid ZIP directory bounds');
    const directory = await read(offset, length), entries: ZipEntry[] = [];
    let position = 0;
    for (let index = 0; index < count; ++index) {
      if (position + 46 > directory.length || directory.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP entry');
      const flags = directory.readUInt16LE(position + 8), method = directory.readUInt16LE(position + 10);
      const nameLength = directory.readUInt16LE(position + 28);
      const next = position + 46 + nameLength + directory.readUInt16LE(position + 30) + directory.readUInt16LE(position + 32);
      if (next > directory.length) throw new Error('Truncated ZIP entry');
      if (flags & 1) throw new Error('Encrypted ZIP archives are not supported');
      if (method !== 0 && method !== 8) throw new Error('ZIP compression must be stored or deflate');
      entries.push({ name: directory.toString('utf8', position + 46, position + 46 + nameLength), crc32: directory.readUInt32LE(position + 16).toString(16).padStart(8, '0').toUpperCase(), size: directory.readUInt32LE(position + 24), compressedSize: directory.readUInt32LE(position + 20), method, offset: directory.readUInt32LE(position + 42) });
      position = next;
    }
    return entries;
  } finally { await file.close(); }
}
export async function zipMembers(filename: string): Promise<string[]> {
  return (await zipEntries(filename)).map(entry => entry.name);
}

/** Stream one member for content normalization, without writing extracted ROMs. */
export async function zipContentCrc(filename: string, entry: ZipEntry, skip: number): Promise<string> {
  if (entry.size > 512 * 1024 * 1024 || skip < 0 || skip >= entry.size || !entry.compressedSize) throw new Error('Invalid ZIP ROM size');
  const {input, output} = await zipStream(filename, entry);
  let total = 0, full = 0, normalized = 0;
  try {
    for await (const data of output) {
      const chunk = data as Buffer;
      if (total + chunk.length > entry.size) throw new Error('ZIP ROM exceeds declared size');
      full = crc32(chunk, full);
      const offset = Math.min(chunk.length, Math.max(0, skip - total));
      normalized = crc32(chunk.subarray(offset), normalized);
      total += chunk.length;
    }
    if (total !== entry.size || full.toString(16).padStart(8, '0').toUpperCase() !== entry.crc32) throw new Error('ZIP ROM checksum mismatch');
    return normalized.toString(16).padStart(8, '0').toUpperCase();
  } finally { input.destroy(); output.destroy(); }
}

/** Read only enough decompressed bytes to identify a validated cartridge header. */
export async function zipPrefix(filename: string, entry: ZipEntry, length: number): Promise<Buffer> {
  if (length <= 0 || length > 4096 || entry.size < length || entry.size > 512 * 1024 * 1024 || !entry.compressedSize) throw new Error('Invalid ZIP header size');
  const {input, output} = await zipStream(filename, entry);
  const chunks: Buffer[] = []; let total = 0;
  try {
    for await (const data of output) {
      const chunk = (data as Buffer).subarray(0, length - total);
      chunks.push(chunk); total += chunk.length;
      if (total === length) break;
    }
    if (total !== length) throw new Error('Truncated ROM header');
    return Buffer.concat(chunks);
  } finally { input.destroy(); output.destroy(); }
}

async function zipStream(filename: string, entry: ZipEntry) {
  const file = await fs.open(filename, 'r');
  let start: number;
  try {
    const header = Buffer.alloc(30);
    if ((await file.read(header, 0, 30, entry.offset)).bytesRead !== 30 || header.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    if (header.readUInt16LE(6) & 1 || header.readUInt16LE(8) !== entry.method || ![0, 8].includes(entry.method)) throw new Error('Invalid ZIP compression');
    start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (start + entry.compressedSize > (await file.stat()).size) throw new Error('Truncated ZIP ROM');
  } finally { await file.close(); }
  const input = createReadStream(filename, {start, end: start + entry.compressedSize - 1});
  const inflate = entry.method === 8 ? createInflateRaw() : undefined;
  const output = inflate ?? input;
  // Pipe errors must also reject the async iterator; pipe() alone does not forward them.
  if (inflate) { input.on('error', error => inflate.destroy(error)); input.pipe(inflate); }
  return {input, output};
}
