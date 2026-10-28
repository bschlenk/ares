# ROM Library

Set **Settings → General → ROM Library → ROM directory**, or use **Choose ROM
folder…** in the browser. Scans include subfolders. Cmd/Ctrl+O, File → Open ROM
and the viewport's Open ROM button run the configured browser command. Fresh
profiles enable this plugin. For existing profiles, enable **ROM Library** in
Settings → Plugins; disabled/unavailable browsers fall back to the native picker.
The native picker also starts in the configured ROM directory.

All supported cartridge systems share one collection. Search title, filename or
system; sort by title or system, optionally filter a system, and switch between
cover flow and a grid using the icon radio control. The view choice is saved in
the profile. Enter in search focuses the selected game for arrow-key navigation.
Click selects, double-click or Enter launches, arrow keys
move the selection; Enter or double-click launches the selected game. The browser is a modal:
background interaction is blocked, search receives initial focus, and Escape or
the close button dismisses it and restores focus. Arrow keys navigate from anywhere
inside the modal except native text fields, dropdowns and other arrow-key controls.
The switcher has one tab stop: Tab or Shift+Tab enters on the selected ROM. Within
the switcher, focusing a ROM selects it, and arrow navigation moves actual focus
with selection. A subtle background marks selection without adding a second ring;
keyboard focus uses the shared 1px outline with a 1px offset.
Right-click a ROM for **Reveal in Finder** (or **Reveal in folder**) and
**Copy absolute path**. ZIP entries use the archive's path. Covers use the default
cursor and a hover tint; nonselected cover-flow cards lift slightly on hover.
Held arrows scroll immediately; individual presses animate (unless reduced motion
is enabled). Old browser window placements are removed automatically.

The first scanner recognizes unambiguous cartridge/disk extensions listed in
`../../library/systems.ts`. It skips hidden files, symbolic links, saves and
companion data. ZIP archives containing one supported ROM appear alongside loose
ROMs, including when the ROM is inside a subfolder. The scanner reads only archive
directory metadata; the native loader decompresses the original ZIP when launched.
Game titles and online artwork use the contained ROM's basename, while local
artwork sidecars use the ZIP's basename. Stored and deflated archives are supported;
encrypted, split, ZIP64 and multi-ROM archives produce a scan warning.
Ambiguous `.bin` dumps, disc images and multi-file games
remain available through **Open file…**, including companion media selections.
Unreadable folders and scan limits are reported in the browser.

## Artwork

Local PNGs beside a ROM take priority:

- `Game (USA).gba` → `Game (USA).box.png` (or `Game (USA).png`)
- `Game (USA).gba` → `Game (USA).cartridge.png`

Otherwise box art first tries the ROM basename against
[Libretro thumbnails](https://github.com/libretro-thumbnails/libretro-thumbnails)
`Named_Boxarts`. If it is missing, the library matches the ROM's CRC32 to a canonical
release name in [Libretro's No-Intro metadata](https://github.com/libretro/libretro-database/tree/master/metadat/no-intro).
ZIPs supply their uncompressed CRC from the archive directory; loose ROMs are
hashed locally on demand. For Super Famicom dumps with a 512-byte copier header,
the checksum excludes that header, matching MIA's loader and No-Intro's clean ROM
data. Headered ZIP members are streamed and verified in memory; no ROMs are
extracted to disk or rewritten. Normalized checksums are cached until file size or
modification time changes. This works even when a ROM or archive was renamed or
its name omits region tags. Reserved thumbnail filename characters become underscores.
Images preload several covers/rows beyond the visible area, with four requests per
view, visible covers prioritized, an eight-second timeout and a four-MiB PNG limit.
Closing the modal pauses queued preloads. Refresh retains card/image elements;
changed images are decoded before swapping, and unchanged images are never reset.
Successful downloads live
in `<profile>/artwork`. Missing art shows a title placeholder; there is no fuzzy
match that could silently select another release. **Download matching box art
from Libretro** can be disabled; local and cached art still work offline. Requests
send the system collection and artwork filename to GitHub, never ROM contents or
checksums. Downloaded per-system identity metadata is cached in
`<profile>/artwork/catalogs` and also works offline. CRC matches are exact;
GBA dumps without a checksum match can fall back to their cartridge game code
and revision, after validating the header checksum and fixed byte. This works
with loose ROMs and stored/deflated ZIPs, prefers retail releases over Virtual
Console variants, and never overrides a successful checksum match. Unknown dumps
without a validated identity keep their placeholder when filename matching fails.
For SNES and GBA, checksum identification also falls back to
[OpenGood's historical GoodTools catalogs](https://github.com/SnowflakePowered/opengood).
A matching variant CRC is grouped with the original release in that catalog;
the original's CRC must then match a No-Intro identity. Region and revision
annotations remain part of the group, and conflicting identities are rejected.
A checksum-identified beta/prototype/demo/sample with no direct canonical match
can use its unambiguous same-region retail sibling's box art; this is an artwork
association, not a claim that its ROM contents match the retail release.
This identifies known modified/overdumped ROMs even when renamed, without
changing their contents or matching the user's filename to a canonical title.
No-Intro checksums take priority, followed by historical checksums, then the GBA
header fallback. Historical metadata shares the bounded download, per-system
request coalescing, offline setting, and persistent catalog cache described above.

Some upstream thumbnail files are symlink aliases containing a target filename.
The downloader follows up to four such aliases within the same collection directory
and caches the resolved PNG; arbitrary URLs and path traversal are rejected.

Box and cartridge art are separate API slots. The browser currently displays box
art; the cartridge slot accepts local sidecars and has no online provider yet.
The GBA implementation in `~/Developer/bschlenk.com/scripts/cart-art.ts` is a useful
next step for cartridge scans: join the existing CRC32/header-code identities
and normalized titles/regions to LaunchBox `Cart - Front` scans.
Extending that metadata import with `Box - Front` would supply both image kinds
for one identified release, including renamed ROMs. Keep original cartridge scans
separate from platform-specific label crops so a later SVG cartridge renderer can
position the label without changing game identity or the mixed-system library.

## Plugin opening flow

`library.browser` is `ares.library:open` by default. Set it to `native` for the
file picker or another enabled plugin's `plugin-id:command` to replace the opening
flow. Commands must be declared in the manifest. The host uses the current active
lease and falls back to the picker when the command is unavailable, including
plugin recovery mode. A failing command reports its error without opening a
second picker.

`context.library` exposes `scan`, `artwork(id, 'box' | 'cartridge')`, `launch(id)`,
`chooseDirectory` and `openFile`. Declare `library.read` for scans/artwork and
`library.launch` for opening/launching; choosing the directory additionally needs
`settings.write`. Operations require an active plugin lease, recheck authorization
after asynchronous reads and before queued launches, and accept opaque scanned
IDs rather than paths/URLs. Launch paths and local artwork must remain inside the
configured real directory. Directory changes invalidate old IDs.

`"placement": "modal"` declares a host-owned modal contribution using the regular
panel lifecycle. `ui.openPanel(id, {width, height})` opens it at the requested size;
`ui.closePanel(id)` dismisses it. Modal contributions do not appear in workspace
panel pickers, and their mounted contents are retained while closed.

Run `npm run test:library --prefix electron-ui` for the Electron integration test;
`tests/library.test.js` covers the filesystem and artwork service without network.

The host scans the configured directory during app startup. On opening, the modal
uses that ready in-memory snapshot immediately and checks for changes in the
background, retaining current cards/art while scanning. Scan results replace the
host index atomically so displayed games remain usable during refresh. The folder
setup button is hidden until settings confirm no directory is configured; ordinary
refreshes keep the game count rather than replacing it with scanning text.
