import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { systems } from './systems.js';
import { zipEntries, zipContentCrc, zipPrefix, type ZipEntry } from './zip.js';
import { RomNameCatalog } from './catalog.js';
import type { ArtworkKind, LibraryGame, LibrarySnapshot } from './contracts.js';

const MAX_IMAGE = 4 * 1024 * 1024;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
interface Entry extends LibraryGame { path: string; stem: string; artworkName: string; collection: string; crc?: string; archiveMember?: ZipEntry; identity?: Promise<string | undefined> }
const copierHeader = (system: string, size: number) => system === 'Super Famicom' && size % 32768 === 512;

/** Reads only the configured tree. IDs are opaque; plugins cannot supply paths or URLs. */
export class RomLibrary {
  private entries = new Map<string, Entry>();
  private root = '';
  private scanning?: Promise<LibrarySnapshot>;
  private scanningDirectory = '';
  private snapshot?: LibrarySnapshot;
  private images = new Map<string, Promise<string | null>>();
  private catalog: RomNameCatalog;
  private normalizedCrcs = new Map<string, Promise<string | undefined>>();
  constructor(private directory: () => string, private cache: string,
    private download: () => boolean, private fetchImage: typeof fetch = fetch) {
    this.catalog = new RomNameCatalog(cache, download, fetchImage);
  }

  cached(): LibrarySnapshot | null {
    return this.snapshot?.directory === this.directory() ? structuredClone(this.snapshot) : null;
  }
  scan(): Promise<LibrarySnapshot> {
    if (this.scanning) {
      if (this.scanningDirectory === this.directory()) return this.scanning;
      return this.scanning.catch(() => {}).then(() => this.scan());
    }
    this.scanningDirectory = this.directory();
    this.scanning = this.readTree().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }
  private async readTree(): Promise<LibrarySnapshot> {
    const directory = this.directory();
    if (this.root !== directory) { this.entries.clear(); this.images.clear(); this.snapshot = undefined; }
    this.root = directory;
    const warnings: string[] = [], next = new Map<string, Entry>();
    if (!directory) return this.snapshot = { directory, games: [], warnings };
    if (!path.isAbsolute(directory)) throw new Error('ROM directory must be an absolute path');
    let visited = 0, truncated = false;
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (depth > 32 || visited >= 100000 || next.size >= 20000) { truncated = true; return; }
      let children;
      try { children = await fs.readdir(folder, { withFileTypes: true }); }
      catch (error) { warnings.push(`Cannot read ${path.relative(directory, folder) || directory}: ${(error as NodeJS.ErrnoException).code}`); return; }
      for (const child of children) {
        if (++visited > 100000 || next.size >= 20000) { truncated = true; break; }
        if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
        const file = path.join(folder, child.name);
        if (child.isDirectory()) { await walk(file, depth + 1); continue; }
        if (!child.isFile()) continue;
        const extension = path.extname(child.name).slice(1).toLowerCase();
        let system = systems[extension], artworkName = child.name.slice(0, -(extension.length + 1));
        let crc: string | undefined;
        let archiveMember: ZipEntry | undefined;
        if (extension === 'zip') {
          try {
            const members = (await zipEntries(file)).filter(entry => systems[path.posix.extname(entry.name).slice(1).toLowerCase()]);
            if (members.length !== 1) {
              warnings.push(`${path.relative(directory, file)}: ${members.length ? 'Contains multiple ROMs; store one game per ZIP' : 'No supported ROM found in ZIP'}`);
              continue;
            }
            const member = path.posix.basename(members[0]!.name), memberExtension = path.posix.extname(member);
            crc = members[0]!.crc32;
            archiveMember = members[0];
            system = systems[memberExtension.slice(1).toLowerCase()];
            artworkName = member.slice(0, -memberExtension.length);
          } catch (error) { warnings.push(`${path.relative(directory, file)}: ${(error as Error).message}`); continue; }
        }
        if (!system) continue;
        const stem = child.name.slice(0, -(extension.length + 1));
        const id = createHash('sha256').update(file).digest('hex');
        next.set(id, { id, path: file, filename: path.relative(directory, file), stem, artworkName, crc, archiveMember,
          title: artworkName.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || artworkName,
          system: system.name, collection: system.collection });
      }
    };
    await walk(directory, 0);
    if (truncated) warnings.push('Library scan limit reached (20,000 games, 100,000 entries or 32 folders deep).');
    if (directory !== this.directory()) throw new Error('ROM directory changed; refresh the library');
    this.entries = next; this.images.clear();
    return this.snapshot = { directory, games: [...next.values()].map(({ id, title, filename, system }) => ({ id, title, filename, system })), warnings };
  }
  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || this.root !== this.directory()) throw new Error('Unknown game; refresh the library');
    return entry;
  }
  private async checkedPath(file: string): Promise<string> {
    const root = await fs.realpath(this.root), actual = await fs.realpath(file);
    const relative = path.relative(root, actual);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('File outside ROM directory');
    return actual;
  }
  async launchInfo(id: string): Promise<{ rom: string; system: string }> {
    const entry = this.entry(id), rom = await this.checkedPath(entry.path);
    this.entry(id);
    if (!(await fs.stat(rom)).isFile()) throw new Error('ROM is no longer a file');
    return { rom, system: entry.system };
  }
  artwork(id: string, kind: ArtworkKind): Promise<string | null> {
    const entry = this.entry(id);
    if (kind !== 'box' && kind !== 'cartridge') throw new Error('Invalid artwork kind');
    const key = `${id}:${kind}:${this.download()}`;
    let result = this.images.get(key);
    if (!result) { result = this.readArtwork(entry, kind); this.images.set(key, result); }
    return result;
  }
  private image(bytes: Buffer): string | null {
    return bytes.length <= MAX_IMAGE && bytes.subarray(0, 8).equals(pngSignature)
      ? `data:image/png;base64,${bytes.toString('base64')}` : null;
  }
  private async localImage(file: string, contained = false): Promise<string | null> {
    try {
      if (contained) file = await this.checkedPath(file);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_IMAGE) return null;
      return this.image(await fs.readFile(file));
    } catch { return null; }
  }
  private async readArtwork(entry: Entry, kind: ArtworkKind): Promise<string | null> {
    const base = path.join(path.dirname(entry.path), entry.stem);
    for (const candidate of [base + `.${kind}.png`, ...(kind === 'box' ? [base + '.png'] : [])]) {
      const local = await this.localImage(candidate, true);
      if (local) return local;
    }
    // Cartridge scans will use a separate provider; never substitute box art for a label.
    if (kind !== 'box') return null;
    const cachedExact = await this.boxImage(entry, entry.artworkName, false);
    if (cachedExact) return cachedExact;
    const exactFirst = /\([^)]*\)/.test(entry.artworkName);
    if (exactFirst) {
      const exact = await this.boxImage(entry, entry.artworkName);
      if (exact) return exact;
    }
    const headeredZip = entry.archiveMember && copierHeader(entry.system, entry.archiveMember.size);
    const crc = !headeredZip && entry.crc ? entry.crc : await (entry.identity ??= this.romCrc(entry));
    for (const canonical of (crc ? await this.catalog.names(entry.collection, crc) : []).slice(0, 8)) {
      if (exactFirst && canonical === entry.artworkName) continue;
      const image = await this.boxImage(entry, canonical);
      if (image) return image;
    }
    for (const canonical of (crc ? await this.catalog.variantNames(entry.collection, crc) : []).slice(0, 8)) {
      const image = await this.boxImage(entry, canonical);
      if (image) return image;
    }
    if (entry.system === 'Game Boy Advance') {
      const identity = await this.gbaIdentity(entry);
      if (identity) for (const name of (await this.catalog.serialNames(entry.collection, identity.code, identity.revision)).slice(0, 8)) {
        const image = await this.boxImage(entry, name);
        if (image) return image;
      }
    }
    return exactFirst ? null : this.boxImage(entry, entry.artworkName);
  }
  private async gbaIdentity(entry: Entry): Promise<{code: string; revision: number} | undefined> {
    try {
      const file = await this.checkedPath(entry.path);
      let header: Buffer;
      if (entry.archiveMember) header = await zipPrefix(file, entry.archiveMember, 192);
      else {
        const handle = await fs.open(file, 'r');
        try {
          header = Buffer.alloc(192);
          if ((await handle.read(header, 0, 192, 0)).bytesRead !== 192) return;
        } finally { await handle.close(); }
      }
      const code = header.toString('ascii', 0xac, 0xb0);
      let checksum = -0x19;
      for (let i = 0xa0; i < 0xbd; ++i) checksum -= header[i]!;
      if (header[0xb2] !== 0x96 || (checksum & 255) !== header[0xbd] || !/^[A-Z0-9]{4}$/.test(code)) return;
      return {code, revision: header[0xbc]!};
    } catch { return; }
  }
  private async romCrc(entry: Entry): Promise<string | undefined> {
    try {
      const file = await this.checkedPath(entry.path);
      const stat = await fs.stat(file);
      const key = `${entry.system}:${file}:${stat.size}:${stat.mtimeMs}:${entry.archiveMember?.crc32 ?? ''}`;
      let result = this.normalizedCrcs.get(key);
      if (!result) {
        result = (async () => {
          if (entry.archiveMember) return zipContentCrc(file, entry.archiveMember, 512);
          if (stat.size > 512 * 1024 * 1024) return;
          let crc = 0;
          const start = copierHeader(entry.system, stat.size) ? 512 : 0;
          for await (const chunk of createReadStream(file, {start})) crc = crc32(chunk, crc);
          return crc.toString(16).padStart(8, '0').toUpperCase();
        })();
        this.normalizedCrcs.set(key, result);
      }
      return await result;
    } catch { return; }
  }
  private async boxImage(entry: Entry, title: string, network = true): Promise<string | null> {
    const name = title.replace(/[&*/:`<>?\\|]/g, '_');
    const url = `https://raw.githubusercontent.com/libretro-thumbnails/${encodeURIComponent(entry.collection.replaceAll(' ', '_'))}/master/Named_Boxarts/${encodeURIComponent(name)}.png`;
    const cacheFile = path.join(this.cache, createHash('sha256').update(url).digest('hex') + '.png');
    const cached = await this.localImage(cacheFile);
    if (cached) return cached;
    if (!network || !this.download()) return null;
    try {
      const bytes = await this.downloadBoxImage(url);
      if (!bytes) return null;
      const image = this.image(bytes);
      if (image) { await fs.mkdir(this.cache, { recursive: true }); await fs.writeFile(cacheFile, bytes); }
      return image;
    } catch { return null; }
  }
  private async downloadBoxImage(url: string): Promise<Buffer | null> {
    const visited = new Set<string>();
    // GitHub serves thumbnail symlinks as small text files, not HTTP redirects.
    for (let hop = 0; hop <= 4; ++hop) {
      if (visited.has(url)) return null;
      visited.add(url);
      const response = await this.fetchImage(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_IMAGE) { await response.body.cancel().catch(() => {}); return null; }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.subarray(0, 8).equals(pngSignature)) return bytes;
      if (bytes.length > 512) return null;
      const target = bytes.toString('utf8').trim();
      if (!target.endsWith('.png') || !target.length || /[/\\\u0000-\u001f\u007f]/.test(target)) return null;
      // Only filenames in the existing Named_Boxarts directory are allowed.
      url = new URL(encodeURIComponent(target), url).href;
    }
    return null;
  }
}
