import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function parseRomNames(dat: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const block of dat.split(/^game\s*\(/m).slice(1)) {
    const name = /^\s*name\s+"([^"]+)"/m.exec(block)?.[1];
    if (!name) continue;
    for (const match of block.matchAll(/\bcrc\s+([a-f0-9]{8})\b/gi)) {
      const crc = match[1]!.toUpperCase(), existing = names.get(crc) ?? [];
      if (!existing.includes(name)) existing.push(name);
      names.set(crc, existing);
    }
  }
  return names;
}

interface Catalog { names: Map<string, string[]>; serials: Map<string, string[]> }
function parseCatalog(dat: string): Catalog {
  const serials = new Map<string, string[]>();
  for (const block of dat.split(/^game\s*\(/m).slice(1)) {
    const name = /^\s*name\s+"([^"]+)"/m.exec(block)?.[1];
    if (!name) continue;
    for (const match of block.matchAll(/\bserial\s+"([^"]+)"/g)) {
      const code = match[1]!.toUpperCase(), names = serials.get(code) ?? [];
      if (!names.includes(name)) names.push(name);
      serials.set(code, names);
    }
  }
  return {names: parseRomNames(dat), serials};
}

const historicalFiles: Record<string, string> = {
  'Nintendo - Super Nintendo Entertainment System': 'OpenSNES.dat',
  'Nintendo - Game Boy Advance': 'OpenGBA.GBA.dat',
};
interface HistoricalRom { crc: string; group: string }
function xmlAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&(amp|quot|apos|lt|gt);/g,
    (_, entity: string) => ({amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'}[entity]!));
}
/** Join catalogued variants to an original sibling, then to No-Intro by CRC.
 * The user's filename is never involved in this identity mapping. */
export function historicalNames(dat: string, canonical: Map<string, string[]>): Map<string, string[]> {
  const entries: HistoricalRom[] = [], originals = new Map<string, Set<string>>();
  for (const block of dat.matchAll(/<game\b([^>]*)>([\s\S]*?)<\/game>/g)) {
    const name = xmlAttribute(block[1]!, 'name');
    if (!name) continue;
    const group = name.replace(/\s*\[[^\]]*\]/g, '').trim();
    const original = !/\[(?!\!\])/.test(name);
    for (const rom of block[2]!.matchAll(/<rom\b([^>]*)\/?>/g)) {
      const crc = xmlAttribute(rom[1]!, 'crc')?.toUpperCase();
      if (!crc || !/^[A-F0-9]{8}$/.test(crc)) continue;
      entries.push({crc, group});
      if (original) {
        const names = originals.get(group) ?? new Set<string>();
        for (const title of canonical.get(crc) ?? []) names.add(title);
        originals.set(group, names);
      }
    }
  }
  const result = new Map<string, string[]>();
  for (const entry of entries) {
    // Prereleases have no retail packaging of their own. Their catalogued
    // same-region retail sibling can supply artwork without changing identity.
    const retailGroup = entry.group.replace(/\s*\((?:Beta|Proto(?:type)?|Sample|Demo)(?: [^)]*)?\)/gi, '').trim();
    const names = originals.get(entry.group)?.size ? originals.get(entry.group) : originals.get(retailGroup);
    // Conflicting originals must not silently choose another game/revision.
    if (!names || names.size !== 1) continue;
    const existing = result.get(entry.crc) ?? [];
    for (const name of names) if (!existing.includes(name)) existing.push(name);
    result.set(entry.crc, existing);
  }
  for (const [crc, names] of result) if (names.length !== 1) result.delete(crc);
  return result;
}

/** Shared per-system identity metadata; no ROM contents are uploaded. */
export class RomNameCatalog {
  private historical = new Map<string, Promise<Map<string, string[]>>>();
  private catalogs = new Map<string, Promise<Catalog>>();
  constructor(private cache: string, private download: () => boolean, private fetchData: typeof fetch) {}
  async names(collection: string, crc: string): Promise<string[]> {
    return (await this.get(collection)).names.get(crc.toUpperCase()) ?? [];
  }
  async variantNames(collection: string, crc: string): Promise<string[]> {
    const filename = historicalFiles[collection];
    if (!filename) return [];
    const key = `${collection}:${this.download()}`;
    let names = this.historical.get(key);
    if (!names) {
      names = (async () => {
        const canonical = (await this.get(collection)).names;
        if (!canonical.size) return new Map<string, string[]>();
        const dat = await this.text(`opengood:${filename}`,
          `https://raw.githubusercontent.com/SnowflakePowered/opengood/master/dats/${filename}`);
        return historicalNames(dat, canonical);
      })();
      this.historical.set(key, names);
    }
    return (await names).get(crc.toUpperCase()) ?? [];
  }
  async serialNames(collection: string, code: string, revision: number): Promise<string[]> {
    return ((await this.get(collection)).serials.get(code) ?? []).filter(name =>
      !/\((?:Virtual Console|Beta|Proto|Demo|Sample|Kiosk)[^)]*\)/i.test(name) &&
      Number(/\(Rev (\d+)\)/.exec(name)?.[1] ?? 0) === revision);
  }
  private async get(collection: string): Promise<Catalog> {
    const key = `${collection}:${this.download()}`;
    let catalog = this.catalogs.get(key);
    if (!catalog) { catalog = this.load(collection); this.catalogs.set(key, catalog); }
    return catalog;
  }
  private async load(collection: string): Promise<Catalog> {
    const url = `https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/${encodeURIComponent(collection)}.dat`;
    return parseCatalog(await this.text(collection, url));
  }
  private async text(key: string, url: string): Promise<string> {
    const file = path.join(this.cache, 'catalogs', createHash('sha256').update(key).digest('hex') + '.dat');
    try {
      if ((await fs.stat(file)).size <= 16 * 1024 * 1024) return await fs.readFile(file, 'utf8');
    } catch {}
    if (!this.download()) return '';
    try {
      const response = await this.fetchData(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok || !response.body) { await response.body?.cancel(); return ''; }
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) return '';
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
      }
      return text;
    } catch { return ''; }
  }
}
