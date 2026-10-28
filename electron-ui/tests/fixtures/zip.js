import {crc32, deflateRawSync} from 'node:zlib';

/** Original test data in a standard single-disk ZIP, with real CRCs and compression. */
export function makeZip(entries, {stored = false, comment = ''} = {}) {
  const locals = [], directory = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    const compressed = stored ? data : deflateRawSync(data), method = stored ? 0 : 8;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22), note = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(note.length, 20);
  return Buffer.concat([...locals, central, end, note]);
}
