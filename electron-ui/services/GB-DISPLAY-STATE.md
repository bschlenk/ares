# Game Boy display observations

Game Boy and Game Boy Color now provide a read-only debugger region with
`format: "ares.gb.ppu-display.v1"`, named `PPU Display State`. Discover its ID with
`memory.regions`; never retain region IDs across session changes. The format is
reported by the core's shared debugger-node interface, so the host does not
infer a system or memory layout from a region name. Other cores can publish their
own versioned formats through the same interface. Super Game Boy retains its
existing separate memory views; this standalone-screen format is not advertised.

## Capture through the existing generic contract

Use `memory.sample` with `scheduling: "boundary"` and one range covering the
region's entire 63,232 bytes. Native code freezes all registers, VRAM, OAM,
palettes and raw pixels synchronously at the same primary-screen submission,
before the video thread swaps/processes the new frame. It never pauses, resumes,
fast-forwards or serializes the emulator. The existing 5 ms copy budget, four
sample handles per owner, 30-second TTL and lifecycle cleanup apply.

```ts
const regions = await ctx.services.request('memory.regions');
const display = regions.result?.regions.find(r => r.format === 'ares.gb.ppu-display.v1');
if (!display) throw new Error('This core does not expose this display format');
const captured = await ctx.services.request('memory.sample', {
  reads: [{region: display.id, offset: 0, length: display.size}],
  scheduling: 'boundary',
});
```

Check every result envelope. Poll `memory.capture.status` until `pending` is
false, with a wall deadline and `ctx.signal` cancellation. Read sequence 0/range
0 using `memory.capture.read` in chunks of at most 16,384 bytes, or use
`memory.capture.page`. Every read includes the frozen `frame_reference` with
native session, epoch, frame and `frame_kind: "primary-screen-frame"`. Compare
that identity with video/observer frame references; renderer delivery may skip
frames. Release the handle in `finally` with `memory.capture.release`.

The same services are exposed to MCP/CLI as `memory_regions`, `memory_sample`,
`memory_capture_status`, `memory_capture_read` and `memory_capture_release`.
Separate CLI calls need a retained owner lease. Plugins need only `memory.read`.
`ctx.scope.onFrame` can sample smaller fields with `mem.region(...)` at the same
boundary; its existing serialized-result quota makes the paged sample path the
appropriate choice for the full display.

`memory.readMany` remains useful for one coherent current safe-point sample,
including CPU WRAM/HRAM alongside this region. It does not promise that an
in-progress render buffer corresponds to the last presented frame. For a complete
rendered frame, request a boundary capture while running. An already-paused
boundary request returns `paused_boundary_unavailable` without advancing the core.

## Binary layout, version 1

All multibyte fields are **little-endian**. Unlisted/reserved bytes are zero.
Validate both the format string and the header before interpreting the bytes.

| Offset | Length | Contents |
| --- | --- | --- |
| `0x0000` | 4 | ASCII `GBDS` |
| `0x0004` | 1 | Schema version, 1 |
| `0x0005` | 1 | Flags: bit 0 CGB hardware, bit 1 CGB execution mode |
| `0x0006` | 1 | Actual PPU mode: 0 HBlank, 1 VBlank, 2 OAM, 3 transfer |
| `0x0007` | 1 | LCD enabled, 0 or 1 |
| `0x0008` | 2 | Actual horizontal dot coordinate |
| `0x000a` | 1 | Actual LY |
| `0x000b` | 1 | Current pixel counter |
| `0x000c` | 2 | Valid VRAM bytes: 8192 DMG, 16384 CGB |
| `0x000e` | 2 | Width, 160 |
| `0x0010` | 2 | Height, 144 |
| `0x0012` | 1 | First-frame LCD blanking latch |
| `0x0013` | 1 | Window-enable latch |
| `0x0014` | 1 | Window X latch |
| `0x0015` | 1 | Window internal line latch |
| `0x0040` | 64 | CPU-readable PPU register range `FF40–FF7F`; unsupported addresses read `FF` |
| `0x0100` | 16384 | VRAM in physical bank order; DMG's unused second bank is zero |
| `0x4100` | 160 | OAM in hardware byte order |
| `0x41a0` | 4 | DMG BGP decoded shade entries |
| `0x41a4` | 8 | DMG OBP0 then OBP1 decoded shade entries |
| `0x41b0` | 64 | CGB BG palette RAM, 32 little-endian RGB555 entries; zero on DMG |
| `0x41f0` | 64 | CGB OBJ palette RAM; zero on DMG |
| `0x4300` | 46080 | 160×144 row-major raw pixel values, uint16 LE |

In the register range, LCDC is at `0x40`, STAT at `0x41`, SCY/SCX at `0x42/43`,
LY/LYC at `0x44/45`, DMA at `0x46`, BGP/OBP0/OBP1 at `0x47–49`, WY/WX at
`0x4a/4b`, VBK at `0x4f` and CGB palette selectors/data at `0x68–6b`.
Reads have no CPU-bus side effects and do not advance palette selectors.
STAT preserves upstream's delayed CPU-readable mode bits; byte `0x06` reports
the actual mode. On normal GB screen submission LY is already 144 while the
mode may still be HBlank, before the following PPU invocation enters VBlank.
Do not infer mode from the frame number.

Raw DMG pixels are final shade indices 0–3 after palette mapping. CGB pixels are
RGB555 values. They capture sprites and mid-frame raster effects that cannot be
reconstructed from a single final register state. They precede frontend palette
color emulation, blending, luminance/gamma, cropping and scaling. LCD-off frames
continue to submit, with blank raw pixels. The frame identity indicates native
submission, not a guarantee that every frame reached the UI.

No Pokémon addresses, text decoding or gameplay policy are included.

## Validation (2026-10-30)

The generated DMG fixture compares every pixel reconstructed from captured
scroll/window/sprite state against both the frozen raw pixels and the matching
presented frame. DMG/GBC tests exercise MCP discovery and boundary samples,
VRAM/OAM/palette compatibility, LCD-off transitions, input-driven window/scroll
changes, immutability, write rejection, owner isolation and reset invalidation.
The complete sequential suite passed 247 tests with zero failures and one
optional private-ROM test skipped. Native host/CPU/task/matrix fixtures, strict
TypeScript targets and SDK declarations were rebuilt. No private media was used.
