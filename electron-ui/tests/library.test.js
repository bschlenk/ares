import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RomLibrary } from '../dist/library/service.js';
import { zipMembers, zipEntries, zipContentCrc } from '../dist/library/zip.js';
import { makeZip } from './fixtures/zip.js';
import { crc32 } from 'node:zlib';
import { parseRomNames } from '../dist/library/catalog.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function setup(t, fetchImage) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ares-library-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  let directory = path.join(temp, 'roms'), download = true;
  await fs.mkdir(directory);
  const library = new RomLibrary(() => directory, path.join(temp, 'cache'), () => download, fetchImage);
  return { library, temp, directory, setDirectory: value => { directory = value; }, disable: () => { download = false; } };
}
test('recursive mixed-system scan ignores hidden files, symlinks and companion data; IDs expire on folder change', async t => {
  const s = await setup(t);
  await fs.mkdir(path.join(s.directory, 'nested'));
  for (const name of ['Zelda (USA).gba', 'nested/Mario.gb', 'nested/Mario.gbc', '.hidden.nes', 'track.bin', 'save.sav']) await fs.writeFile(path.join(s.directory, name), 'fixture');
  await fs.symlink(s.temp, path.join(s.directory, 'loop'));
  await fs.symlink(path.join(s.directory, 'Zelda (USA).gba'), path.join(s.directory, 'alias.gba'));
  const result = await s.library.scan();
  assert.equal(result.games.length, 3);
  assert.deepEqual(result.games.map(g => g.system).sort(), ['Game Boy', 'Game Boy Advance', 'Game Boy Color']);
  const zelda = result.games.find(g => g.title === 'Zelda');
  assert.deepEqual(await s.library.launchInfo(zelda.id), { rom: await fs.realpath(path.join(s.directory, 'Zelda (USA).gba')), system: 'Game Boy Advance' });
  await assert.rejects(s.library.launchInfo('../outside'), /Unknown game/);
  s.setDirectory(s.temp);
  await assert.rejects(s.library.launchInfo(zelda.id), /refresh/);
});
test('launch and sidecars reject a ROM replaced by a symlink outside the configured tree', async t => {
  const s = await setup(t);
  const file = path.join(s.directory, 'Game.gb'); await fs.writeFile(file, 'fixture');
  const { games: [game] } = await s.library.scan();
  const outside = path.join(s.temp, 'outside.gb'); await fs.writeFile(outside, 'outside');
  await fs.unlink(file); await fs.symlink(outside, file);
  await assert.rejects(s.library.launchInfo(game.id), /outside/);
});
test('local box and cartridge art stay distinct and work offline', async t => {
  const s = await setup(t, () => { throw new Error('unexpected download'); }); s.disable();
  await fs.writeFile(path.join(s.directory, 'Game.gba'), 'fixture');
  await fs.writeFile(path.join(s.directory, 'Game.box.png'), png);
  await fs.writeFile(path.join(s.directory, 'Game.cartridge.png'), png);
  const { games: [game] } = await s.library.scan();
  assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
  assert.match(await s.library.artwork(game.id, 'cartridge'), /^data:image\/png;base64,/);
  assert.throws(() => s.library.artwork(game.id, 'screenshot'), /Invalid artwork/);
});
test('exact canonical names are encoded, requests coalesce and cached box art works offline', async t => {
  let calls = 0;
  const s = await setup(t, async url => {
    ++calls;
    assert.equal(url, 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/Named_Boxarts/Game%20(USA).png');
    return new Response(png);
  });
  await fs.writeFile(path.join(s.directory, 'Game (USA).gba'), 'fixture');
  const { games: [game] } = await s.library.scan();
  const values = await Promise.all([s.library.artwork(game.id, 'box'), s.library.artwork(game.id, 'box')]);
  assert.equal(values[0], values[1]); assert.equal(calls, 1);
  assert.equal(await s.library.artwork(game.id, 'cartridge'), null);
  s.disable(); await s.library.scan();
  assert.equal(await s.library.artwork(game.id, 'box'), values[0]); assert.equal(calls, 1);
});
test('missing, invalid, oversized and offline artwork return placeholders', async t => {
  for (const response of [() => new Response('', { status: 404 }), () => new Response('not png'), () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1)), () => { throw new Error('offline'); }]) {
    const s = await setup(t, async () => response());
    await fs.writeFile(path.join(s.directory, 'Game.nes'), 'fixture');
    const { games: [game] } = await s.library.scan();
    assert.equal(await s.library.artwork(game.id, 'box'), null);
  }
});
test('unconfigured, relative and unreadable directories have useful outcomes', async t => {
  const s = await setup(t); s.setDirectory('');
  assert.deepEqual(await s.library.scan(), { directory: '', games: [], warnings: [] });
  s.setDirectory('relative'); await assert.rejects(s.library.scan(), /absolute/);
  s.setDirectory(path.join(s.temp, 'missing')); assert.match((await s.library.scan()).warnings[0], /ENOENT/);
});

test('ZIPs identify the contained ROM and use its canonical artwork name without extracting', async t => {
  const s = await setup(t, async url => {
    assert.match(url, /Nintendo_-_Game_Boy_Advance\/master\/Named_Boxarts\/Game%20\(USA\)\.png$/);
    return new Response(png);
  });
  for (const stored of [false, true]) {
    const file = path.join(s.directory, stored ? 'stored.ZIP' : 'renamed.zip');
    const bytes = makeZip([['readme.txt', 'Notes'], ['folder/Game (USA).GBA', 'original fixture']], {stored, comment: 'Archive comment'});
    await fs.writeFile(file, bytes);
    assert.deepEqual(await zipMembers(file), ['readme.txt', 'folder/Game (USA).GBA']);
    const snapshot = await s.library.scan(), game = snapshot.games.find(game => game.filename === path.basename(file));
    assert.equal(snapshot.warnings.length, 0);
    assert.equal(game.title, 'Game'); assert.equal(game.system, 'Game Boy Advance');
    assert.deepEqual(await s.library.launchInfo(game.id), {rom: await fs.realpath(file), system: 'Game Boy Advance'});
    assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
    assert.deepEqual(await fs.readFile(file), bytes);
  }
  assert.deepEqual((await fs.readdir(s.directory)).sort(), ['renamed.zip', 'stored.ZIP']);
});

test('ZIP scan warns about malformed, encrypted, empty and multi-game archives', async t => {
  const s = await setup(t);
  const encrypted = makeZip([['Game.gb', 'fixture']]);
  encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from('504b0102', 'hex')) + 8);
  for (const [name, bytes] of [
    ['broken.zip', Buffer.from('not a zip')], ['encrypted.zip', encrypted],
    ['notes.zip', makeZip([['notes.txt', 'no ROM']])],
    ['multiple.zip', makeZip([['First.gb', 'first'], ['Second.nes', 'second']])],
  ]) await fs.writeFile(path.join(s.directory, name), bytes);
  const snapshot = await s.library.scan();
  assert.equal(snapshot.games.length, 0); assert.equal(snapshot.warnings.length, 4);
  assert.ok(snapshot.warnings.some(warning => warning.includes('Invalid ZIP')));
  assert.ok(snapshot.warnings.some(warning => warning.includes('Encrypted')));
  assert.ok(snapshot.warnings.some(warning => warning.includes('No supported ROM')));
  assert.ok(snapshot.warnings.some(warning => warning.includes('multiple ROMs')));
});

test('renamed loose and ZIP ROMs share checksum identification and cached covers offline', async t => {
  const data = Buffer.from('original, identified ROM fixture'), crc = crc32(data).toString(16).padStart(8, '0').toUpperCase();
  const requests = [];
  const dat = `clrmamepro ( name "Test" )\ngame (\n name "Canonical Game (USA)"\n rom ( name "Canonical Game (USA).gba" size ${data.length} crc ${crc} )\n)\n`;
  const s = await setup(t, async url => {
    requests.push(url);
    if (url.endsWith('.dat')) return new Response(dat);
    if (url.endsWith('/Canonical%20Game%20(USA).png')) return new Response(png);
    return new Response('', {status: 404});
  });
  await fs.writeFile(path.join(s.directory, 'Renamed.gba'), data);
  await fs.writeFile(path.join(s.directory, 'Archive.zip'), makeZip([['folder/Another name.gba', data]]));
  const snapshot = await s.library.scan();
  for (const game of snapshot.games) assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
  assert.equal(requests.filter(url => url.endsWith('.dat')).length, 1, 'metadata is shared per system');
  assert.equal(requests.filter(url => url.endsWith('/Canonical%20Game%20(USA).png')).length, 1, 'identical releases share a cover file');
  const before = requests.length;
  const offline = new RomLibrary(() => s.directory, path.join(s.temp, 'cache'), () => false, () => { throw new Error('offline download'); });
  for (const game of (await offline.scan()).games) assert.match(await offline.artwork(game.id, 'box'), /^data:image\/png;base64,/);
  assert.equal(requests.length, before);
  const localNames = parseRomNames(dat);
  assert.deepEqual(localNames.get(crc), ['Canonical Game (USA)']);
  assert.equal(localNames.has('00000000'), false);
});

test('Super Famicom copier headers are normalized for loose, stored and deflated ROM artwork', async t => {
  const rom = Buffer.alloc(65536, 0x42), headered = Buffer.concat([Buffer.alloc(512, 0x55), rom]);
  const crc = crc32(rom).toString(16).padStart(8, '0').toUpperCase();
  const wholeCrc = crc32(headered).toString(16).padStart(8, '0').toUpperCase();
  assert.notEqual(crc, wholeCrc);
  const s = await setup(t, async url => {
    if (url.endsWith('.dat')) return new Response(`game (\n name "Canonical SNES Game (USA)"\n rom ( crc ${crc} )\n)\n`);
    if (url.endsWith('/Canonical%20SNES%20Game%20(USA).png')) return new Response(png);
    return new Response('', {status:404});
  });
  await fs.writeFile(path.join(s.directory, 'Headered.smc'), headered);
  await fs.writeFile(path.join(s.directory, 'Unheadered.sfc'), rom);
  for (const stored of [false, true]) {
    const file = path.join(s.directory, stored ? 'Stored.zip' : 'Deflated.zip');
    const bytes = makeZip([['Headered.smc', headered]], {stored});
    await fs.writeFile(file, bytes);
    const [entry] = await zipEntries(file);
    assert.equal(entry.size, headered.length); assert.equal(entry.crc32, wholeCrc);
    assert.equal(await zipContentCrc(file, entry, 512), crc);
    assert.equal(await zipContentCrc(file, entry, 0), wholeCrc);
  }
  const originals = new Map(await Promise.all((await fs.readdir(s.directory)).map(async name => [name, await fs.readFile(path.join(s.directory, name))])));
  const snapshot = await s.library.scan();
  assert.equal(snapshot.games.length, 4);
  for (const game of snapshot.games) assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
  for (const [name, bytes] of originals) assert.deepEqual(await fs.readFile(path.join(s.directory, name)), bytes);
  assert.deepEqual((await fs.readdir(s.directory)).sort(), [...originals.keys()].sort(), 'normalization never extracts or rewrites ROM files');
});

test('ZIP normalization rejects truncated data, oversized declarations and checksum mismatches', async t => {
  const s = await setup(t), file = path.join(s.directory, 'Game.zip');
  await fs.writeFile(file, makeZip([['Game.smc', Buffer.alloc(65536 + 512, 0x33)]]));
  const [entry] = await zipEntries(file);
  await assert.rejects(zipContentCrc(file, {...entry, crc32:'00000000'}, 512), /checksum mismatch/);
  await assert.rejects(zipContentCrc(file, {...entry, size:1024 * 1024 * 1024}, 512), /Invalid ZIP ROM size/);
  await assert.rejects(zipContentCrc(file, {...entry, compressedSize:1000000}, 512), /Truncated ZIP ROM/);
  await assert.rejects(zipContentCrc(file, {...entry, size:1024}, 512), /exceeds declared size/);
});

test('thumbnail symlink aliases resolve within the same collection and cache the image offline', async t => {
  const requests = [];
  const s = await setup(t, async url => {
    requests.push(url);
    return new Response(url.endsWith('/Game%20(USA)%20(Rev%201).png') ? 'Game (USA).png' : png);
  });
  await fs.writeFile(path.join(s.directory, 'Game (USA) (Rev 1).sfc'), 'fixture');
  const {games:[game]} = await s.library.scan();
  const cover = await s.library.artwork(game.id, 'box');
  assert.match(cover, /^data:image\/png;base64,/);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].endsWith('/Named_Boxarts/Game%20(USA).png'));
  s.disable(); await s.library.scan();
  assert.equal(await s.library.artwork(game.id, 'box'), cover);
  assert.equal(requests.length, 2);
});

test('thumbnail aliases cannot escape the directory, fetch arbitrary URLs, or loop indefinitely', async t => {
  for (const target of ['../escape.png','https://example.com/escape.png','/escape.png','invalid image','Loop (USA).png']) {
    let requests = 0;
    const s = await setup(t, async () => { ++requests; return new Response(target); });
    await fs.writeFile(path.join(s.directory, 'Loop (USA).sfc'), 'fixture');
    const {games:[game]} = await s.library.scan();
    assert.equal(await s.library.artwork(game.id, 'box'), null);
    assert.ok(requests <= 2, 'invalid aliases and self-cycles stop immediately');
  }
});

test('GBA validated header identifies unknown dumps in loose, stored and deflated ROMs', async t => {
  const rom = Buffer.alloc(1024, 7);
  rom.write('A3AE', 0xac); rom[0xb2] = 0x96; rom[0xbc] = 0;
  let checksum = -0x19;
  for (let i = 0xa0; i < 0xbd; ++i) checksum -= rom[i];
  rom[0xbd] = checksum & 255;
  const requests = [];
  const dat = ['Game (USA) (Virtual Console)', 'Game (USA) (Rev 1)', 'Game (USA)'].map(name =>
    `game (\n name "${name}"\n serial "A3AE"\n rom ( crc 12345678 )\n)`).join('\n');
  const s = await setup(t, async url => {
    requests.push(url);
    if (url.endsWith('.dat')) return new Response(dat);
    return url.endsWith('/Game%20(USA).png') ? new Response(png) : new Response('', {status:404});
  });
  await fs.writeFile(path.join(s.directory, 'Loose.gba'), rom);
  for (const stored of [true, false]) await fs.writeFile(path.join(s.directory, `${stored}.zip`), makeZip([['Unknown.gba', rom]], {stored}));
  const invalid = Buffer.from(rom); invalid[0xbd] ^= 1;
  await fs.writeFile(path.join(s.directory, 'Invalid.gba'), invalid);
  for (const game of (await s.library.scan()).games) {
    const art = await s.library.artwork(game.id, 'box');
    if (game.title === 'Invalid') assert.equal(art, null);
    else assert.match(art, /^data:image\/png;base64,/);
  }
  assert.equal(requests.some(url => /Virtual|Rev%20/.test(url)), false);
});


test('unknown checksums never select a canonical cover by title alone', async t => {
  const requests = [];
  const s = await setup(t, async url => {
    requests.push(url);
    if (url.endsWith('.dat')) return new Response('game (\n name "Unique (USA)"\n rom ( crc 12345678 )\n)');
    return url.endsWith('/Unique%20(USA).png') ? new Response(png) : new Response('', {status:404});
  });
  await fs.writeFile(path.join(s.directory, 'Unique.zip'), makeZip([['Unique.smc', Buffer.alloc(1024)]]));
  const [game] = (await s.library.scan()).games;
  assert.equal(await s.library.artwork(game.id, 'box'), null);
  assert.equal(requests.some(url => url.endsWith('/Unique%20(USA).png')), false);
});

test('historical checksums bridge renamed variants to No-Intro originals and work offline', async t => {
  const data = Buffer.from('catalogued historical variant'), crc = crc32(data).toString(16).padStart(8, '0');
  const dat = 'game (\n name "Canonical & Different Title (USA)"\n rom ( crc 12345678 )\n)';
  const good = `<datafile><game name="Old &amp; Title (U) [!] "><rom crc="12345678"/></game><game name="Old &amp; Title (U) [o1+1C]"><rom crc="${crc}"/></game></datafile>`;
  const requests = [];
  const s = await setup(t, async url => {
    requests.push(url);
    if (url.includes('/opengood/')) return new Response(good);
    if (url.endsWith('.dat')) return new Response(dat);
    return url.endsWith('/Canonical%20_%20Different%20Title%20(USA).png') ? new Response(png) : new Response('', {status:404});
  });
  await fs.writeFile(path.join(s.directory, 'Arbitrary name.sfc'), data);
  for (const stored of [true, false]) await fs.writeFile(path.join(s.directory, `${stored}.zip`), makeZip([['Unrelated.sfc', data]], {stored}));
  for (const game of (await s.library.scan()).games) assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
  assert.equal(requests.filter(url => url.includes('/opengood/')).length, 1);
  const offline = new RomLibrary(() => s.directory, path.join(s.temp, 'cache'), () => false, () => {throw Error('offline');});
  for (const game of (await offline.scan()).games) assert.match(await offline.artwork(game.id, 'box'), /^data:image\/png;base64,/);
});

test('historical identity rejects unmatched originals, conflicting groups, and region changes', async () => {
  const {historicalNames} = await import('../dist/library/catalog.js');
  const canonical = new Map([['12345678', ['First (USA)']], ['87654321', ['Other (USA)']]]);
  const xml = `<datafile>
    <game name="Game (U) [!]"><rom crc="12345678"/></game>
    <game name="Game (U)"><rom crc="87654321"/></game>
    <game name="Game (U) [h1]"><rom crc="11111111"/></game>
    <game name="Missing (U) [h1]"><rom crc="22222222"/></game>
    <game name="Regional (U) [!]"><rom crc="12345678"/></game>
    <game name="Regional (E) [h1]"><rom crc="33333333"/></game>
  </datafile>`;
  const names = historicalNames(xml, canonical);
  for (const crc of ['11111111', '22222222', '33333333']) assert.equal(names.has(crc), false);
});

test('checksum-identified prereleases use only an unambiguous same-region retail sibling for art', async t => {
  const data = Buffer.from('known beta ROM'), crc = crc32(data).toString(16).padStart(8, '0');
  const good = `<datafile>
    <game name="Catalog Title (U) [!]"><rom crc="12345678"/></game>
    <game name="Catalog Title (U) (Beta)"><rom crc="${crc}"/></game>
    <game name="Catalog Title (E) (Beta)"><rom crc="11111111"/></game>
  </datafile>`;
  const {historicalNames} = await import('../dist/library/catalog.js');
  const names = historicalNames(good, new Map([['12345678', ['Retail Title (USA)']]]));
  assert.deepEqual(names.get(crc.toUpperCase()), ['Retail Title (USA)']);
  assert.equal(names.has('11111111'), false);
  const s = await setup(t, async url => {
    if (url.includes('/opengood/')) return new Response(good);
    if (url.endsWith('.dat')) return new Response('game (\n name "Retail Title (USA)"\n rom ( crc 12345678 )\n)');
    return url.endsWith('/Retail%20Title%20(USA).png') ? new Response(png) : new Response('', {status:404});
  });
  await fs.writeFile(path.join(s.directory, 'Completely renamed.zip'), makeZip([['Unknown.smc', data]]));
  const [game] = (await s.library.scan()).games;
  assert.match(await s.library.artwork(game.id, 'box'), /^data:image\/png;base64,/);
});

test('ready snapshots are isolated and remain available atomically while refreshing', async t => {
  const s = await setup(t);s.disable();
  await fs.writeFile(path.join(s.directory, 'First.gb'), 'fixture');
  assert.equal(s.library.cached(), null);
  const initial=await s.library.scan(), id=initial.games[0].id;
  const cached=s.library.cached();cached.games.length=0;
  assert.equal(s.library.cached().games.length,1,'callers cannot change host snapshot');
  await fs.writeFile(path.join(s.directory, 'Second.gb'), 'fixture');
  const refreshing=s.library.scan();
  assert.equal(s.library.cached().games.length,1,'previous complete snapshot stays available');
  assert.equal((await s.library.launchInfo(id)).system,'Game Boy','existing IDs remain usable during scan');
  assert.equal((await refreshing).games.length,2);
  assert.equal(s.library.cached().games.length,2);
  s.setDirectory(path.join(s.temp,'another'));await fs.mkdir(path.join(s.temp,'another'));
  assert.equal(s.library.cached(),null,'old directory never leaks into new library');
  assert.equal((await s.library.scan()).games.length,0);
});

test('changing directories during a scan queues a scan for the new directory', async t => {
  const s = await setup(t);await fs.writeFile(path.join(s.directory,'Old.gb'),'fixture');
  const next=path.join(s.temp,'next');await fs.mkdir(next);await fs.writeFile(path.join(next,'New.gba'),'fixture');
  const old=s.library.scan();s.setDirectory(next);
  const fresh=s.library.scan();await assert.rejects(old,/directory changed/);
  assert.deepEqual((await fresh).games.map(game=>game.title),['New']);
});
