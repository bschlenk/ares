# MCP adapter (tasks 3–9, partial)

The Node stdio entry point is `dist/mcp/server.js`, compiled as native ESM from `server.ts`.
It connects to your running Ares app through the private local service. If Ares
is closed, the adapter launches it automatically and waits for readiness. The app
continues running after the MCP connection closes. `emu_status.adapter_launched_app`
reports whether this adapter launched the connected app.

## Connect to Ares

In the packaged app, use **Settings → Agent Integration → Install CLI helpers…**,
then **Copy MCP configuration**. No session name or service-directory configuration is needed. After installing
helpers, the normal configuration is:

```json
{
  "mcpServers": {
    "ares": {
      "command": "/Users/YOUR_USER/.local/bin/ares-mcp",
      "args": []
    }
  }
}
```

The preview and copied JSON contain the same full absolute executable path, with no tilde expansion or shell wrapper.

MCP and CLI access is enabled by default. Settings can disable it; `--services`
and `--no-services` override the saved setting for a launch. Automatic startup uses
`--services`. If an existing app has disabled service access and holds the profile
lock, the adapter reports `profile_in_use`; enable access in that app. It does not
open another window or quit an existing app.

The adapter discovers the single live app in the private service directory
(`/tmp/ares-services-UID` on macOS). `--service-dir /absolute/path` or
`ARES_SERVICE_DIR` selects another directory. Stale records are ignored; multiple
live apps produce `multiple_apps_running`. Advanced scripts may still use
`--instance-name NAME` for a specific named app, or
`--connection /absolute/instance.json --instance UUID` for a specific launch.
Explicit connection-file targeting attaches only and does not launch a replacement.
Copied configuration uses automatic discovery even if the app has a name.

Development clients can run `node electron-ui/dist/mcp/server.js` after building.
The development adapter launches the checkout's Electron runtime. The packaged
launcher supplies its bundled runtime. Diagnostics go to stderr; stdout carries
MCP JSON-RPC only.

`load_rom(path, system?)` opens a ROM using the app's normal loading path and leaves
it paused. If identical ROM content is already loaded (including another path or symlink), it preserves the current game state and running/paused state and returns `already_loaded: true`. A new load returns `already_loaded: false`. Paths must be absolute. Missing/unsupported files fail before closing
the current game. Ambiguous identification returns the system choices instead of
opening a dialog; supply `system` to choose. `close_rom()` returns to the empty
synthetic display. Both invalidate old native sessions, memory regions and captures.
Refresh `emu_status` and `memory_regions` after loading; stale writes are never replayed.

DMA provenance remains separately opt-in. Enable it before loading a ROM to
capture boot transfers. CLI helpers preserve unrelated commands and should be
reinstalled after moving the app.

## Compatibility and current bounds

The initial memory/session tools retain the reference parameter names/types and defaults:
`verbose=false`, `keep_overrides=false`, and `read_memory.length=64`.
`region` accepts an exact debugger name or an opaque ID returned by
`memory_regions`; ambiguous names fail. Addresses accept unsigned integers or
hex/decimal strings (also binary/octal and underscore separators), as region
offsets, with no VA/cache interpretation. Read/write results retain reference
`region`, `addr` (`0x` uppercase hex), `len`/`written`, and `hex` fields, and add
session/epoch plus `region_id`. Region descriptors add IDs and access metadata.

This is incremental compatibility, not full reference-result parity:

- `emu_status` includes system/paused/session/epoch/service capabilities, native
  VI coordinates, frame kind, boundary state, configured executor and active
  operation ID. CPU registers, hit snapshots and input ownership remain pending. `verbose=true` includes an explicit limits list. The
  capabilities field describes native services; `tools/list` is the available
  MCP tool inventory, not the legacy telemetry inventory.
- `run_frames(n, max_seconds=60)` and `run_until_frame(k, max_seconds=60)`
  support N64 and the explicitly labelled synthetic fixture. `step()` is one VI
  boundary. Relative runs cap at one million frames; deadlines are 0.001–600
  seconds. Zero frames advances nothing; past absolute targets reject. These
  calls poll internally while permitting concurrent status/cancel requests.
  N64 FPR/COP0/verbose options format immutable completion registers; screenshot_after uses the stopped operation identity. Non-N64 register options return unavailable.
- `operation_status(operation_id)` returns live progress or an immutable final
  result (last 16 retained). `cancel_operation(operation_id=null)` cancels this
  connection’s operation; UI pause can interrupt any owner. Recent handles keep
  their original session/epoch. Disconnect finishes owned work; renderer reload
  preserves it. Competing starts/resume/writes/cancellation return `busy`.
- Transfers are limited to 1–1024 bytes per request. Oversized requests fail;
  the adapter does not silently truncate or split a mutation. `hex_bytes` must
  be even-length hex (outer whitespace accepted); its input string is bounded.
- Raw N64 `RDRAM` region writes and `DCache` region access remain unavailable.
  Explicit VA tools now provide CPU/physical views. Raw region reads do not add
  renderer flush/cache guarantees. Other read/write support follows
  debugger-node metadata and native bounds checks.
- `resume(keep_overrides=true)` preserves N64 input leases. Default resume
  releases the caller's holds; UI resume releases all. keep_overrides remains
  unavailable on other systems.
- Error results have `isError=true` with structured JSON text containing an error
  code. Native stale/range/unavailable codes are retained. No fabricated frames,
  register values or legacy telemetry-protocol compatibility are advertised.

`parity-ledger.json` still tracks all 68 tools and the remaining differences.
The other 37 tools are not registered. No tool was removed from the target.

## Bundled runtime and distribution

```sh
npm run package:mac --prefix electron-ui
```

This produces an ad-hoc-signed development bundle at
`artifacts/distribution/Ares.app`, including the native host, databases, SDL3,
MoltenVK, built JS, runtime dependencies and licenses. It refuses to overwrite an
existing destination. An alternative unused destination can follow `--`.
This is a local development artifact, not a notarized release or a Windows/Linux
package. Keep ordinary release signing/entitlements and per-platform checks as
separate gates.

`Contents/Resources/ares-mcp` invokes the copied Electron executable in
`ELECTRON_RUN_AS_NODE=1` mode, using relative bundle paths and clearing inherited
Node module/options overrides. Packaging verifies the runtime (Electron 44.9.0,
Node 24.22.0 in the tested artifact); no user-installed Node or Python is required
to launch it. The `RunAsNode` fuse must remain enabled for this launch mechanism.
See [Electron's documented Node mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)
and [fuse behavior](https://www.electronjs.org/docs/latest/tutorial/fuses).

The server uses the official SDK's factory-based stdio transport; see
[official stdio guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md).
The pinned lockfile contains SDK 2.3.1. A real legacy MCP `initialize` exchange
negotiating `2025-06-18` is tested, separately from internal service protocol v1.

## Verification

```sh
npm test --prefix electron-ui
npm run test:mcp --prefix electron-ui
npm run test:package --prefix electron-ui
```

Run native/app tests sequentially, using disposable profiles and copied/generated
fixtures. `test:mcp` exercises actual stdio initialization, schemas/defaults, tool
calls, shared inspector bytes, reload and stale/disconnected instances against
one real GB core, using an original generated ROM. Transport fault checks cover fragmented handshakes,
duplicate requests, authentication, connection generations, timeout/disconnect
and reconnect with no mutation replay.

`test:package` copies the distribution outside the repository, launches it with a
disposable profile and a generated GB ROM, and uses its bundled stdio launcher.
The native-loader preflight and MCP Node process are additionally run with
checkout reads denied. The GUI retains Chromium's normal sandbox (nesting an
outer Seatbelt sandbox prevents Chromium initializing its own sandbox). The
packaged app writes/restores fixture bytes and quits normally; its connection
metadata is removed. No old fork binary or active user emulator is a fixture.


## N64 debugging bounds

Instruction steps use the interpreter and count branch delay slots separately.
Breakpoints stop before fetch; CPU data watchpoints stop after the accessing
instruction. Step operations share frame-run ownership, timeout, cancellation,
disconnect and immutable results. Removing all instrumentation restores the
configured recompiler. Main observes stopped state independently of video.

Addresses can be decimal/hex strings through 64 bits; unsafe numeric JS values
reject. Predicates support unsigned masked PC/HI/LO/GPR/value comparisons and
`all` groups of up to eight. Compact CPU snapshots return `gpr_named`; verbose
adds the `gpr` array and all optional groups. FPR rows retain raw bits plus FR=0/1
architectural single/double views and IEEE classes; nonfinite values are JSON null
with an explicit class. COP0 uses named registers and decoded Status/Cause;
Random is null. `stack` and `disassemble` provide bounded separate diagnostics
rather than embedding mutable code/unwind reads into an immutable old hit.
Completed runs retain register snapshots for later `operation_status` formatting.

VA memory transfers are bounded to 1024 bytes within installed RDRAM. Physical,
KSEG0/KSEG1 and sign-extended spellings work; TLB/MMIO/wrapped ranges reject.
CPU view observes or patches resident D-cache without allocating misses; KSEG1
bypasses cache. Writes synchronize Vulkan and invalidate JIT, preserve I-cache,
and report cache hazards. They reject before RDRAM initialization completes.
`verify_after_frames` (0..100000) optionally runs under native execution ownership
with a 0.001..600 second deadline. The result includes the immediate write results,
`immediate_verification` and `operation`; its final `memory_verification` contains
readbacks and per-write matches frozen at the actual stop (including debug hits,
timeout, pause or cancellation). Later writes cannot change retained results.

`write_memory_many(writes, verify_after_frames=0, max_seconds=60)` accepts 1..32
strict `{addr, hex, view="cpu"}` objects, at most 1024 bytes total. It validates
all payloads, address ranges and execution availability at one native safe point
before writing. Writes apply in order; readbacks follow the complete set, so
later overlaps can make earlier matches false. No rollback is promised. This is
a narrower bound than the reference's 256 writes/8 MiB, matching the 4 KiB native
request protocol. A restored machine prepares deferred video/hidden-RDRAM backing
without executing CPU instructions before mutation; unavailable backing rejects
with `renderer_unavailable`.


## Input ownership slice

`controller_set` replaces the full pending state of one N64 port. Four ports can
have separate connection owners; a foreign owner cannot overwrite or revoke a
specific held port. Null `controller_release` releases only the caller's holds.
Inputs latch at VI boundaries or operation start. Frame leases use native VI
coordinates; wall leases use 1 ms precision and expire even while paused. Socket
closure revokes the departed connection's holds without touching other owners.

New host keyboard/gamepad/button events can take back ordinary play. Automated
coverage uses real ares controller nodes and generated host keyboard events;
physical device acceptance is still pending. `controller_tap` and the three profiler tools are implemented as bounded native services.


## Bounded traces

`trace_pc` and `trace_calls` use an owned interpreter run over a half-open native
VI interval. PC entries are sorted by frame/PC. Calls record JAL/JALR/taken
branch-link targets before execution, including JALR with the same source/link
register. Selected GPRs and raw f12/FR are optional. Operation timeout, cancellation,
human takeover and disconnect share the existing cleanup path.

The requested record ceiling is additionally limited to 262144 PC records or
65536 calls and returned as `record_capacity`. Truncation and overflow observations
are explicit; observed-instruction counters remain available. Source inline/page
defaults are accepted, with an effective MCP response ceiling of 1024 entries and
`next_offset` for continuation. Native replies page 64 PCs or 32 calls to stay
inside the control transport bound. Captures are immutable after completion;
starting another trace supersedes the stored pages. A non-null file path requests atomic bounded JSON export through Electron main.


## PI provenance

MCP `provenance_control` with `{"enabled":true}` enables recording immediately
and for subsequent ROM loads. Enable it before opening/resetting a ROM to record
boot transfers. Use `{"enabled":false}` to stop and free the history; omit
`enabled` to query. This controls the same profile setting as the checkbox.
Recording defaults off. The response includes `enabled`, `requested`, `pending`
and `error` so a saved-but-not-applied preference is explicit.

`overlay_log` returns PI cartridge-to-RDRAM transfers with initiating PC, ROM
address/offset and observed write-loop ranges. Enable **Record N64 DMA provenance**
in Settings to start recording explicitly; reading the log never enables it.
The raw native host also accepts `--debug-provenance` to record from boot, or
`runtime.provenance` to switch recording at a safe point. `enabled` reports the
current state. Disabling clears the history and frees its storage. `recording_from_epoch_start`
distinguishes recording start; `history_complete` also becomes false after ring
overwrite. The 4096-record ring reports dropped records, and each record reports
range truncation at 64 ranges.

Initialized linear RDRAM writes are clipped to installed storage and confirmed;
nonidentity mappings return attempted ranges with writes_confirmed=false and
bytes_written=null. Code candidates are only confirmed ROM-address transfers
overlapping the requested physical code range, not proof of overlays or generated
code. Native replies page 16 records; the MCP effective limit is 128 with
next_since_id/more for continuation. No GPU, decompression or general DMA source
is inferred from PI history.

CPU profiling adds `profiler_control(enable=true)`, `profiler_clear()` and
`cpu_profiler_top(window="continuous", limit=32)`. Effective top limit is 64,
reported in the result. Cycle fields use 187.5 MHz master ticks. Frame windows
are observed VI-origin swaps. Addresses and synthetic exception labels are
available; symbol names and wait classification are explicitly unavailable.
Capture ownership, bounded storage and disconnect/reset cleanup apply.

`controller_tap(button, port=1, frames=2, max_seconds=60, keep_override=false)`
is an owned native VI operation. Button names accept case/whitespace/hyphen
normalization. Timeout/cancel/hits also release the button; keep_override retains
neutral isolation, while disconnect/reset/shutdown/human takeover revoke it.

Task 7 trace export: supplying `path` exports all retained entries independently
of inline_limit. `overwrite=false` refuses an existing file atomically. The
result contains path and artifact byte count/SHA-256, or file_error if export
fails after capture. Relative paths use the app working directory. Output caps
at 64 MiB / 25 seconds; owner disconnect, stale epochs or replacement cancel
unfinished publication. Existing output survives failures. This does not add a
new MCP tool; bounded AVI recording is also implemented.

`screenshot(path=null, source="framebuffer", region=null, scale=1, inline=false,
overwrite=false)` now returns native PNG output. Framebuffer reads are N64-only;
presented output supports other cores and synthetic fixtures independently of
canvas readback. Region is [x,y,width,height] in source pixels; scale is nearest
neighbor after cropping. Bounds: 4194304 pixels / 8 MiB PNG / scale 0.125..8.
Inline mode returns image/png MCP content and text metadata; optional path writes
the same bytes atomically. Default non-inline output uses a unique host temporary
path. No fresh post-reset frame returns no_frame, not a stale image. The tool
does not advance emulation. Screenshot-after-run, audio and recording remain
pending.

`run_frames` also accepts `screenshot_after` with the screenshot file options
(`inline: true` is rejected before running). Capture failure returns
`screenshot_error` alongside the completed run and `emulation_already_advanced`.
A competing resume/frame advance or epoch change causes an explicit capture
failure. Presented captures report their actual native submitted-frame coordinate.

### Audio capture

`audio_capture(seconds=3)` starts a connection-owned post-mix stereo capture at
48000 Hz. Requests accept 0..3600 seconds and use at most four seconds (192000
sample frames). Effective `cap`, `seconds` and `rate` are returned. The tap precedes
host-output muting, including controlled-run muting. Cores without attached audio
streams return `unavailable`; `audio_status` reports `available: false`.

`audio_status()` reports `active`, `count`, `cap`, `rate`, `done` and `available`.
`done` does not consume the capture: samples freeze at the limit until saved or
replaced by the same owner. Other connections may read status but cannot replace
or save it. Disconnect and reset revoke capture and pinned data.

`audio_save(path)` atomically **replaces** an existing file, matching the reference
API (which has no overwrite flag). It exports the current samples, including a
partial or empty capture, as 16-bit little-endian stereo PCM WAV. Success consumes
capture; failure retains it for retry. The returned path, frame count, duration,
epoch, bytes and SHA-256 describe the saved snapshot. A late cleanup failure is
reported as `cleanup_error` alongside the successful file metadata. Maximum WAV
size is 768044 bytes, with one native immutable save pin (30-second lease) and a
25-second main export deadline. The bounded buffer freezes instead of wrapping;
this deliberately avoids losing the beginning of a late-saved capture.

### Video recording

`video_start(max_frames=600, max_seconds=60, max_bytes=134217728, fps=60,
discard_previous=false, source="presented")` begins connection-owned native capture;
it does not advance emulation. Bounds are: 1..36000 frames,
0.001..3600 seconds, 1 MiB..2 GiB and 1..120 fps. Playback fps does not resample or
drive emulation. Raw frames use bottom-up BGR24 with four-byte row padding. AVI
has one uncompressed video stream and no audio. Capture shares the native
screenshot tap's 4194304-source-pixel limit and works without canvas credits.

`video_status()` reports activity, availability, frame count, dimensions, byte
budget, actual native frame tags and stop reason. Generic cores explicitly return
`frame_kind: unavailable`; N64 and synthetic VI tags remain distinct. Captures
stop at time/frame/byte limits or dimension changes. Reset/disconnect discard
owned data. An active recording cannot be replaced; stopped, unexported data
requires `discard_previous: true` to replace. Other owners may read status.

`video_stop(path, overwrite=false)` freezes and exports the recording atomically.
No frames returns `no_frames`; failed export retains stopped frames for retry.
Successful export consumes frames and returns path, size/bytes, SHA-256, duration
and captured coordinates. Native pins expire after 360 seconds; main exports have
a 300-second deadline and stream bounded pages without assembling the entire AVI
in memory. Maximum artifact size is 2150000000 bytes including headers/index.
Late cleanup errors retain successful file metadata as `cleanup_error`.

### Native states (task 8)

`state_save(path, overwrite=false, metadata=true)` pauses and snapshots a loaded
N64 at a native safe point. An active execution operation/GDB session or existing
state pin returns `busy`. Main streams the immutable native bytes to atomic file
publication (64 MiB bound). A separate atomic `.json` sidecar records file hash,
ROM hash, serializer version, capture epoch/frame and the saved RDRAM layout.
These are two publications: `metadata_error` preserves a successfully saved state
when the sidecar cannot be published. Native pins have 30-second leases; exports
have a 25-second deadline. Reset/disconnect revoke them. Saved-state field order
and version remain `v153`; save support alone does not establish compatibility for every hardware configuration.

`state_info(path)` reads only the 533-byte header of a bounded regular file. Its
`header_supported_configuration_unverified` result deliberately does not approve
restoration. Capture coordinates remain unknown and sidecar status unchecked.
`state_list(directory=null, offset=0, limit=100)` scans at most 4096 regular
entries, non-recursively, or resolves configured slots 1–9 without creating save
directories. Requested pages may contain up to 1000 entries, but actual responses
are capped near 48 KiB with `next_offset`. Sidecar validation has a shared 64 MiB
content budget per request. Directory-entry symlinks are excluded; an explicit
file path may resolve through a symlink to a regular file.

`state_peek(path, addr, length=64, view="rdram",
assume_current_configuration=false)` reads 1–1024 saved guest-order RDRAM bytes.
It validates the state hash and layout sidecar, or uses an explicitly requested
observation of the currently loaded N64's serializer prefix. That observation
never serializes/restores the CPU or runs the machine. Physical and KSEG aliases
are supported; CPU-cache view and wrapped/outside ranges reject. Inspections never
pause or load the live emulator. File inputs are bounded to 64 MiB; nonregular
inputs reject. Inspections allow two global jobs/one per owner and a 25-second
deadline, with reset/disconnect revocation.

Safe loading, multiwrite prevalidation, delayed verification and bounded batch experiments are implemented. The original disposable N64 fixture passes a baseline-load/write/active-VI-run/crop sweep through real MCP stdio.

`state_load(path, resume=false, keep_overrides=false)` starts an owned, bounded
upload while the emulator is paused. Native dispatch reserves mutations for that
transfer; read-only tools remain usable. UI pause/resume/reset, disconnect and
keyboard/gamepad takeover revoke it. Chunks are 1800 bytes, four in flight, within
the existing native line/write budgets. Paused dispatch wakes on requests rather
than adding a polling sleep to each batch. File work has a 25-second deadline and
the native upload lease is 30 seconds.

Before changing guest state, native commit checks signature/version and exact
serialized size for current hardware; available sidecar layout and ROM identity
must also match. A present but stale/invalid sidecar rejects instead of falling
back to unchecked legacy loading. Files with no sidecar still receive native
header/version/size checks. Preflight failure leaves guest registers/RAM and epoch
unchanged and stays paused. A successful restore starts a new epoch at frame 0,
clears old captures/operation history, and is paused unless `resume` is true.
`keep_overrides` retains only this connection's neutral input leases; other holds
are released. The restored VI phase is not assumed to be an observed boundary:
`at_frame_boundary` is false until an actual VI boundary is reached.

A restore failure after core mutation attempts backup restoration, invalidates the
epoch and remains paused; its error distinguishes successful backup restoration
from failed recovery. This recovery branch has not been fault-injected. Mutations
are never automatically replayed after a lost reply.

The optional cross-binary gate uses an isolated reference process with writes
sandboxed to its disposable directory and verifies ownership of its private debug
port before connecting:

```sh
ARES_REFERENCE_HOST=/absolute/reference/ares npm run test:state-reference
```

Both directions pass for the tested default 8 MiB N64 configuration and `v153`;
a real 4 MiB configuration rejects that state without guest mutation. This does
not claim every peripheral configuration or cross-platform state compatibility.
The reference executable's hash and measurements are written to
`artifacts/state-reference.json`.

### Bounded batch experiments

`batch(steps, max_seconds=60, stop_on_error=true)` accepts ordered strict steps:

```json
{
  "steps": [
    {"kind":"state_load", "path":"/tmp/baseline.bs"},
    {"kind":"write", "addr":"0x80002000", "hex":"f801f801", "view":"rdram"},
    {"kind":"run", "n":2},
    {"kind":"screenshot", "path":"/tmp/candidate.png", "region":[1,0,2,2], "scale":2},
    {"kind":"read", "addr":"0x2000", "length":4}
  ]
}
```

State loads always stay paused and clear overrides. Write uses `hex` and defaults
to CPU view; read defaults to 64 bytes and RDRAM view. Screenshots use the normal
source/crop/scale/overwrite parameters, require a file path and forbid inline
output. The address, geometry and installed configuration must suit the baseline.
Reload a baseline explicitly for every sweep candidate.

A native reservation spans all steps, including file reads and PNG work; existing
native run operations drive emulation. Status exposes `batch_id` separately from
a running child's `operation_id`. Competing mutations return busy; observations
remain available. The authenticated parent can pause its batch or cancel an
active child with the existing tools. UI pause/reset, UI resume during an idle gap, simulated human
input, native/main deadline or disconnect revoke the reservation. Late child
mutations stay rejected even after reservation removal. Human takeover resumes
ordinary play; subsequent batch steps do not run. Physical input acceptance is
still a separate task 6 gate.

The call returns a final `state:done`, `stopped:true`, `stop_reason`, start/last known
batch epoch and last completed-step frame, per-step results and separate
`steps_attempted`/`steps_completed` counts. A run's data includes its actual native
stop reason and elapsed frames, even on early interruption. `stop_on_error=false`
continues ordinary step errors, but execution interruptions stop the sequence.
An explicit successful load updates only this batch's internal identity; external
reset/ROM changes interrupt it. Committed files/loads are reported if cancellation
arrives just after their commit. Earlier effects are retained:
`side_effects_rolled_back:false`. A transport loss can prevent delivery of the
final report; mutations are never replayed. The reservation ID is not a retained
parent execution-operation handle; child runs retain the normal native results.

Bounds are 1–32 steps, 1M total requested VI frames, 16 KiB read/write bytes,
8 screenshots, 600 seconds and 48 KiB final result (48,000-byte request parameters).
The smaller deadline/default keeps the call within the 30-second local transport
deadline; reference defaults/limits are 60 seconds, 256 steps, 16 MiB and 64
artifacts. Syntax/aggregate bounds validate before acquiring the reservation;
native memory ranges and file compatibility validate at each step. No nesting or
parallel execution. Result-space exhaustion stops before another step; an
unexpected oversized step result is explicitly summarized with `result_omitted`,
preserving a committed path/operation handle, and the batch stops with result_limit.

### Machine services (task 9, in progress)

`cpu_set_registers(gpr=null, pc=null, hi=null, lo=null, llbit=null, status=null)`
validates the whole request at one native safe point before any architectural
change. It requires paused, operation-free N64 execution and excludes GDB,
state uploads and another owner's batch reservation. GPR keys accept exact ABI
names, `fp` or numeric strings 0..31; zero is read-only, and duplicate aliases
reject rather than choosing an ordering. Architectural values are lossless
unsigned 64-bit strings or safe JS integers. LLbit is 0/1; Status is unsigned
32-bit and uses the CPU's architectural setter, preserving its context effects.

An aligned PC accepts full 64-bit spellings and canonicalizes 32-bit KSEG
spellings. Changing PC resets the pipeline/next PC/delay slot, releases a halted
CPU debug gate and clears stale stop/suppression context; the frontend remains
paused. Non-PC edits preserve the previous immutable stop snapshot. Every valid
set drops old-state JIT translations. `changed` reports normalized ABI names and
hex values, plus PC/epoch/frame and `jit_invalidated`. Empty sets are permitted
but still require a pause and invalidate translations. No CPU instruction runs
inside the mutation. Completed execution results remain immutable.

`disassemble(addr, count=32, view="cpu")` accepts 1..128 instructions (reference:
up to 1024). It validates the entire aligned installed-RDRAM range, rejects
TLB/MMIO/wraps, and accepts physical/KSEG aliases. Physical input uses a canonical
KSEG0 display PC. CPU view reads resident D-cache without filling misses or
changing cache counters; KSEG1 and `view="rdram"` bypass it. This deliberately
observes data-cache code bytes, not resident instruction-cache fetch state.
Rows contain addr/word/mnemonic/operands and branch targets. Indirect targets
explicitly identify current_register_context and the source register. Colors
and value hints are disabled on a local disassembler instance.

`rsp_registers`, `rdp_state` and `peripheral_registers` copy direct fields at a
native safe point. They do not read MMIO, advance emulation, consume a semaphore,
promote DMA or change DPC counters. RSP includes 32 scalar registers, 32x8 raw
16-bit vectors, three 8-lane accumulator portions, hardware status/signals, DMA
state/origin and the instruction at PC with text. DMA clock is a signed decimal
string to preserve 64-bit precision (reference uses a JSON number). DMA origin PC
also preserves all 64 bits rather than truncating to 32. The debug
object reports the implemented cooperative debugger’s ownership, grants and stopped state. RDP reports DPC registers/flags/source;
peripherals expose the reference VI/AI/PI/SI/RI fields. These observations remain
available during other owned operations/uploads. They are not command captures.

All five tools are N64-only; other cores return unavailable. Cooperative RSP debugging, command/task/submission capture, exact RDP intervals and experimental bounded calls/recovery are implemented and validated below. Task 6 physical-device acceptance remains a separate manual gate.


### RSP debugger

`rsp_debug(enable=true)` acquires an exclusive native RSP gate and pauses. It never
clears hardware HALT. `rsp_break` manages 16 aligned IMEM PCs (0..0xFFC).
`rsp_step(count=1)` grants 1..1000000 actual single-issued RSP instructions;
`rsp_run()` runs to a breakpoint or hardware HALT/BREAK. Both acknowledge with an
`operation` handle immediately; use `operation_status` for the immutable final
`rsp` counts/PC/reason. Ordinary operation `executed` remains CPU instructions.
`rsp_registers.debug` observes the gate, and `rsp_stop` ends the grant while
retaining the debugger and breakpoint table. Starting-PC breakpoints are skipped
once per grant. An already hardware-halted RSP waits for the emulated CPU to start
it; a grant has a five-second wall deadline.

The normal scheduler advances CPU/devices; no transport runs inside the core.
CPU and RSP select the interpreter while the debugger is enabled, without changing
configured JIT flags. Debug DMA synchronously drains up to two 256-row slots to
prevent SP_DMA_FULL waits. The owning connection may edit memory while frozen;
competing mutations, CPU operations, state upload and batches return busy. Each
owner observation/control renews a 30-second session lease. Disable, owner release,
disconnect, UI/owner pause or resume, reset, human takeover, lease expiry and GDB
attachment release the gate; timeout/cancel/stop retain a frozen session. Full
reference schema/result equality and real-game/physical acceptance remain pending.


### Exact RDP interval capture

`rdp_capture(next_frame=true)` requires an observed native VI boundary. It owns
one VI interval through the existing operation coordinator; early break/cancel/
timeout returns `complete:false`. RDP submissions are copied before software or
Vulkan dispatch. RSP HALT-clear snapshots the 64-byte task header and XXH64 hashes
of both memories, plus optional DMEM. This preserves data before buffer reuse.

`max_commands` defaults to the reference 1000000 but effective word storage caps
at 65536, with at most 512 batches and 64 tasks. Drops/truncation are explicit;
a dropped task cannot be attributed to an older retained task. XBUS submissions
follow the reference 4 KiB clamp. Words retain full 64-bit values, source addresses
and batch IDs; batches include DPC registers, CPU/RSP PCs and task association.
Decoded command grouping is not implemented. `limit` caps inline words at 1024;
use `path` for all retained words, batches and task bytes in atomic
`ares-rdp-capture-v1` JSON. File failures preserve an existing destination and
return `file_error` alongside the completed capture. Export is bounded to 64 MiB,
25 seconds, two jobs globally and one per owner. Reset/disconnect revoke jobs;
newer captures invalidate old pages instead of mixing them. Legacy `next_frame=false` reads the last origin-swap viewer buffer; its snapshot
is separate from exact capture and preserves word0 only.


### Inspection and memory dumps

`stack(function_start=null)` inspects current CPU state without execution. It
scans at most 256 instructions per frame, up to eight frames, and returns a
256-byte raw stack window, candidate frame sizes/return slots/callsites, confidence,
assumptions and stop reason. Only RDRAM-backed KSEG code/stack addresses are read,
using CPU D-cache bytes with KSEG1 bypass. The optional hint must be aligned and
within 1024 bytes before PC. This is heuristic analysis without symbols or unwind
metadata; a candidate frame is not proof of a call stack.

`render_probe()` reports native VI active/origin, DPC clock and VI frame. Each
connection has its own baseline; first observation/epoch change returns null
deltas. `rendering` requires active VI plus changed origin, DPC clock and VI frame;
that heuristic is not proof of visible pixels. Legacy `presented_frame` and `vps`
are explicitly null. Baselines are bounded to 16 owners and removed on release.

`dump_rdram(path,overwrite=false,expect_size=null)` snapshots all installed RDRAM,
up to 8 MiB. `dump_range(addr,length,path,view='rdram',overwrite=false)` snapshots
1..1048576 bytes through physical/KSEG aliases; `cpu` includes resident dirty
D-cache bytes while KSEG1 bypasses. Snapshots contain guest big-endian bytes with
no header. Complete ranges/expected size are validated first, renderer writes are
flushed, and all bytes copy at one safe point without guest execution or pause
change. Active operations, upload, batch, RSP gate and GDB conflicts return busy.

One owner-scoped native pin has a fixed 30-second lease. Main streams 16 KiB pages
(four in flight) through the shared atomic writer, capped at 25 seconds and two
jobs globally/one per owner. Results include SHA-256, size, physical/source
address, view and snapshot epoch/frame. Reset/state load/disconnect revoke pins
and jobs. Every success/failure releases the pin; failed publication preserves an
existing destination. Native snapshot bytes remain immutable if play resumes or
RAM changes while the file is written.


### Experimental bounded calls

`call_function(addr,args=null,max_instructions=100000,max_frames=60,max_seconds=5)`
requires a paused, operation-free CPU with no delay/EXL/ERL context and an aligned
RDRAM-backed stack. Entry accepts physical/KSEG aliases; up to four raw integer
arguments go in a0..a3 and t9 is set to entry. Bounds are 1M instructions, 10000
VI and 600 seconds. This executes guest code with memory/device side effects.

The native coordinator owns execution. A private return address at the last
installed RDRAM word uses no code patch and stops before fetch. Only a JR or
JALR rd=0 to that address, with completed delay slot and original SP, is accepted.
Success returns v0/v1 and restores caller GPR/HI/LO/PC, Status, raw FPR bank and
FCR31, then clears LLbit. Memory/device/time and other COP0 effects remain.

Exceptions (including interrupt/NMI), limits, breakpoint/watchpoint, pause/cancel
and disconnect keep the actual callee stop and one caller snapshot. A watchpoint
in the return delay slot wins over automatic return. `call_recover(restore=true)`
explicitly restores that CPU subset; false discards the context and leaves the
callee state intact. Recovery requires pause/no operation/same epoch. The live
owner or UI may recover; after disconnect a new authenticated connection may
claim it. New calls reject `recovery_pending` until restore/discard. Reset/state
load invalidate the context. Recovery never rolls back memory, device, interrupt
or time effects; completed operation snapshots remain immutable. These tools are
experimental and real-game/fault acceptance remains pending.


### Bounded command viewers (partial parity)

`capture_control(rsp=null,rdp=null)` queries or controls two native viewer channels,
both off by default. Changes require idle execution and channel ownership (or UI);
both requested owners validate before either flag changes. Disconnect disables
owned channels; reset/state load clear data. No guest instruction runs and no
configured JIT flag changes.

`rsp_capture(limit=4096)` reads completed F3DEX2 command/dispatch segments from the
last nonzero VI-origin-swap buffer. A validated signature locates the live loop
and dispatch PCs. Words are copied from the dispatcher registers before handler
reuse, with cycle deltas, shared ordering and open-segment DMA byte counts. Both
interpreter and traced JIT use the actual hooks; unknown microcode cannot emit
fabricated command rows. `configured` reports currently detected microcode; `rspq_supported:true`
reports the available RSPQ implementation. Unknown or replaced microcode produces
no fabricated command rows. A companion ELF is found at the ROM's `.elf`,
`<rom-base>/build/<name>.elf` or `<rom-directory>/build/<name>.elf`. RSPQ requires
file-backed `rsp_queue_text_start`: every configured hook's instruction signature
must match live IMEM. `rspq-libdragon.json` next to that ELF overrides the embedded
bounded libdragon descriptors. `f3dex2.json` next to the ELF (or ROM) can override
the display-list signature, offsets, register layout, names and argument fields.

RSPQ copies up to 16 command words from live DMEM, bounded by the dispatcher size
and command-buffer end. Truncated words are explicit. Loop/load/fetch overhead is
coalesced by segment type. Runtime overlays resolve through ELF ucode data ranges
and the live table/idmap, including multi-ID command offsets; unregistered IDs
cannot retain stale labels. Names and arguments are frozen into each captured row.
Semantic fields support bit ranges, signed values, integer/floating transforms,
enums, decimal/hex formats, DWARF shared-DMEM labels and nested RDP descriptions.
Missing words remain visible as `<missing>`. Descriptors, ELF/DWARF work, strings,
rows and native reply bytes are bounded. No blocking debugger pump is imported.


`rdp_capture(next_frame=false)` reads legacy word0 snapshots from the software or
Vulkan command decoder, including complete buffered commands. It does not run
or write a file; `next_frame=true` remains the separate exact-VI/full-word export.
Viewer buffers commit on changed nonzero VI origin, matching the reference's
origin-swap bookkeeping; this is not proof of a presented canvas image or one VI.
Double buffers preserve immutable committed records while new commands arrive.
Each channel stores at most 4096 rows per frame; native pages cap at 64 and MCP
inline output at 1024. Drops/truncation are explicit. A newer committed generation
returns stale_capture during pagination, never mixed-frame output. Long RSP
segments are emitted on the next dispatch/halt, as in the reference.

### Request cancellation and compatibility evidence

MCP request cancellation aborts only the native operation started by that tool
call, retaining its exact ID/session/epoch. Cancelling an operation-status read
cannot cancel the polled operation. Batches use a private per-call cancellation
token so a late cancellation cannot pause another job. Cancellation/timeout and
disconnect retain completed effects; they do not roll back guest memory/files.

All 68 preserved names have successful actual stdio runtime evidence in
`tests/reference/task-9-tool-coverage.json`. The generated FastMCP comparison
verifies all 68 parameter signatures/defaults/nullability. Intentional adapter
changes include scoped identity/region/operation handles, explicit native error
codes, bounded pages/resource limits and separate diagnostic tools; strict input
validation and result contracts are tested. This is the new internal protocol v1,
not the fork’s TCP telemetry protocol. The Python bridge is a reference only.

### Plugin authoring commands

Task 12 exposes plugin management through the same authenticated private local
endpoint, with a separate `ares-plugin` CLI rather than extra MCP tool names.
The 68-tool reference inventory is unchanged. See
[scaffold/build/open/reload and explicit command examples](../plugins/README.md#bundled-tools-and-agent-commands).
The stop/register panel consumes the same native immutable stop used by
`last_stop`; it does not reconstruct a hit from later live register reads.

The visible MCP configuration preview and Copy button use `/bin/sh` to expand
`~/.local/bin/ares-mcp` at launch
when an executable Ares-managed helper is installed, so reinstalling helpers
from a moved app preserves the configured command. Before helper installation,
it falls back to the current bundle path. Install helpers before copying the
configuration for a stable setup. Automatic app discovery keeps
the connection selection valid across app restarts.

The Agent Integration page shows the exact JSON before copying, including while
access is disabled. It refreshes after settings changes or helper installation.
Copy is available when access is enabled. Home paths use tilde notation through
an explicit shell launch, because direct process launching does not reliably
expand a tilde in a command path. All shell arguments are individually quoted.

## Input timelines and memory recording in a batch

`input` accepts the same complete controller state as `controller_set`, including
port (default 1), buttons, axes and optional leases. An empty input step holds
neutral input. Changes latch at the next VI or run start. The batch owns each port
it changes and releases its holds on completion, error, timeout, cancellation,
human takeover or disconnect. Existing holds from another owner return `busy`.

Start a recorder after `state_load`, since loading invalidates old capture handles.
Recorder names are local to the batch; returned native handles belong to the MCP
connection and remain readable afterward. Every recorder started by the batch
stops when the batch exits, including an interrupted exit. Use a capacity large
enough for the timeline to avoid overwriting early samples.

```json
{
  "steps": [
    {"kind":"state_load", "path":"/absolute/baseline.bs1"},
    {"kind":"memory_record_start", "name":"timeline", "reads":[{"region":"RDRAM", "offset":0, "length":64}], "capacity":256},
    {"kind":"input", "right":true},
    {"kind":"run", "n":30},
    {"kind":"input", "right":true, "b":true},
    {"kind":"run", "n":4},
    {"kind":"input"},
    {"kind":"run", "n":166},
    {"kind":"memory_record_stop", "name":"timeline"}
  ]
}
```

Recorder reads accept current region IDs or exact region names, resolved after
the state load. Read the handle in the start/stop step result with
`memory_capture_status` and `memory_capture_read`; release it with
`memory_capture_release` when finished. Duplicate recorder names reject.

### Direct CLI and capture export

The installed `ares` helper preserves normal app launch. `ares tools` lists the
same schemas as MCP without opening the app. `ares call TOOL --json params.json`
(or `--name VALUE` pairs, with JSON values for arrays/objects/booleans) calls the
shared handler directly through automatic app discovery. JSON results go to
stdout; argument/connection errors go to stderr. SIGINT cancels only work started
by that call, using the original operation identity; mutations are never retried.

`batch` returns its ordered array once in `results`. The deprecated `steps`
alias is available with `legacy_results: true` during migration.

`memory_capture_export {handle,path,overwrite?}` writes every retained sample of
a stopped recorder or immutable snapshot atomically. Stop a running recorder
first. The `ares-memory-capture-v1` file contains capture metadata and ordered
`chunks` with sequence, frame, range, byte offset and hex. Adjacent chunks may
split a large range; concatenate by sequence/range/offset. `first_sequence`,
`next_sequence` and `dropped` make ring wrap explicit. Export preserves the native
handle, rejects stale epochs/disconnects, and limits JSON output to 64 MiB.

### Native JavaScript / TypeScript jobs

`run_script` accepts exactly one of `path` and `source`, JSON `args`,
`max_seconds` (1 ms–600 s), `max_frames` (0–1,000,000), and `wait_ms` (0–1000).
It returns an operation handle immediately by default. Poll `operation_status`,
cancel with `cancel_operation`, and page `script_result` using the returned
`result_handle`. Completed immutable JSON remains available to a fresh authorized
local CLI for 15 minutes, until `script_result_release`, or until app exit.
The store admits 16 results / 16 MiB, reserves up to 4 MiB before each run, and
returns `script_result_backpressure` rather than overwriting an unacknowledged
result. `operation_id: 0` (also the default) selects the latest completed result
in the currently loaded native session; an explicit handle works across reconnects
and ROM replacement. No eligible result returns `no_script_result`.
`operation_status.script_result` distinguishes pending transfer from committed
results. Native completion tickets have a separate four-ticket / 60-second bound. `output_path` streams JSON to a
new file in main; `operation_status.script_output` reports pending, committed
(path/bytes/SHA-256), or failed. Runtime completion and file publication are
reported separately. A failure or cancellation retains earlier guest effects.

```ts
export default async function ({args, emu, mem, input, frames, cpu, log}) {
  await emu.loadState(args.state);
  mem.writeHex(0x80002000, '12345678', 'cpu');
  input.set(1, {right: true});
  await frames(200);
  return {frame: emu.frame, value: mem.u32(0x80002000, 'cpu')};
}
```

File capabilities are explicit: `state_paths` grants specific state inputs;
`output_paths` grants specific destinations for `emu.saveState(path)` and
`emu.screenshot(path)`. These functions return promises. Undeclared destinations
reject, existing files are preserved, and main revalidates native ownership
before publication. Loads update the job epoch and invalidate memory captures
and hooks. Other callers' reset, pause, takeover and disconnect interrupt jobs.
`emu.info()` includes frame, epoch, executor, ROM hash and N64-memory availability.
The initial handle includes source/module, argument and configuration hashes.

Memory methods use big-endian guest order. `u8/i8/s8`, `u16/i16/s16`,
`u32/i32/s32`, `u64/i64/s64`, `f32/f64` read typed values; `writeU32`,
`writeI32`, etc. write them. `bytes`, `hex`, `writeBytes`, `writeHex` transfer
copies. Typed operations reject unaligned addresses; all operations validate
ranges and CPU/RDRAM views through the native memory service. N64 addresses
accept 32-bit numbers or lossless strings/BigInts, including canonical KSEG
aliases. `mem.region(nameOrId, offset, length)` reads supported debugger regions
on other systems; pure region-reading jobs work there, while positive VI waits
and live observation report `frame_boundary_unavailable`. `u64/i64` return BigInt; convert to strings before returning
JSON. JSON nonfinite floats become null; unsupported/cyclic/BigInt results fail.

`frames(0)` advances nothing; positive waits count completed VI boundaries,
including a partial initial frame. Concurrent advances reject. Input replaces
the whole port and latches at run start/next VI. Completion releases all script
input and hooks and leaves execution paused.

Modules are bundled once, with TypeScript stripping. Imports must be local and
remain within the entry file's directory (or the granted plugin root) after realpath resolution. No Node,
remote imports, build configuration or project plugins execute. Inline MCP source
cannot import files; plugin source can import only within its granted root. Scripts have no filesystem, process, network, `std` or `os`
APIs. Date is disabled and Math.random uses a fixed seed. Determinism still
requires identical ROM/state, configuration, build, module graph and input.

Bounds: 128 KiB module inputs, 64 modules, 256 KiB prepared source, 16 MiB JS
heap, 512 KiB stack, 25 ms per resumption, 4096 promise jobs per resumption,
64 KiB/read, 1024 bytes/write, 16 KiB logs and 4 MiB JSON result. There are at
most 64 sequential host requests and 8 file artifacts per job. Unsupported
pending promises, recursion, promise storms and limit failures tear down the
runtime and release native ownership.

`cpu.onExecute(address, callback)` installs up to 64 aligned physical-address
matches (KSEG aliases match the same instruction). Callbacks run synchronously
before execution, including delay slots, in registration order. Stopping breakpoint
gates run first; an instruction stopped before execution does not invoke a hook. Registers are
immutable copies; 64-bit fields are hex strings in `gpr`, `pc`, `hi`, `lo`, etc.
The returned function disposes that hook outside callbacks. Awaiting, queued
promise jobs, guest writes, input, file work and frame advances are forbidden
inside callbacks. Limits are 4096 hits and 25 ms aggregate callback time per VI.
The interpreter is selected for the entire hook lifetime and the configured
executor is restored afterward. Sparse JIT instrumentation is not implemented.

`ares run FILE --args scenario.json --output result.json` waits for completion.
CLI file capabilities resolve against the caller directory, including relative paths used
inside `emu.loadState/saveState/screenshot`; user argument strings stay unchanged.
Successful CLI consumption acknowledges the result: fresh clients may still retrieve it,
but it becomes evictable under retention pressure. Use `--retain-result` to pin it for
the normal 15-minute retention window. Failed CLI runs release their results unless `--retain-result` is set.
Unconsumed MCP results remain pinned until release or expiry.
Use repeated `--state FILE` / `--artifact FILE` for script file capabilities.
JSON goes to stdout; logs/errors go to stderr. SIGINT cancels only that job and
exits 130. `examples/scripts/record.ts` and `observe.ts` share a decoder and take
all address/type/clip tables through arguments.

Plugins can call `ctx.scripts.run(params)` and
`ctx.scripts.observe(params, value => ...)`. Relative paths resolve inside the
plugin root; source can also be supplied. Runs require session.control,
memory.read, memory.write and debug.read. Observation requires memory.read and
cannot mutate or advance the guest. File capabilities are unavailable to plugins.
Up to eight observers globally / four per owner have independent native handles.
The compatibility `scripts.observe` interface defaults to every fourth VI and
renderer polling. New `scope.onFrame` subscriptions default to every VI and push
frozen samples through a bounded acknowledged channel. Each native callback has
a 2 ms runtime / 64 KiB read budget and an 8 KiB JSON result limit, with a rotating
6 ms aggregate scheduler budget. Observers suspend during exclusive runs and are
disposed on plugin unload/reset. Native callbacks must return synchronously;
renderer callbacks may be asynchronous and coalesce with explicit skipped counts.
See `plugins/README.md` and `examples/overlay` for host-sized DPR canvas layers.


Both controller spellings replace the entire selected port: `input({port:1,right:true,x:20,y:0})`
and `input.set(1,{right:true},{x:20,y:0})` have identical behavior. Port defaults to 1
in the callable form; valid ports are 1–4. Omitted buttons and axes are neutral,
axes use signed controller units (-128..127), and the state latches at the next VI.
The lease remains held until replaced or the job completes/cancels/disconnects;
reset/load revokes it. Examples use `.set` as the canonical spelling.

`ares --help`, `ares call --help`, `ares tools --help`, and `ares run --help` do not
start an app. Unknown commands/options fail; positional ROM launch paths are not
accepted by the helper (use `ares call load_rom --path /absolute/game.z64`).
GUI launches detach and write bounded launch diagnostics under the selected
profile's `logs` directory. `app_logs` exposes bounded main/native/renderer history,
generation-aware cursors, loss counts and that directory; JSONL files remain after
exit. `app_health` reports cached native response times, pending request identities
and recent errors, without requiring a ROM/native response. It cannot diagnose a
stalled main event loop independently. `build_info` identifies the adapter build;
`build_info --app true` also identifies the connected app.

`memory_sample` freezes up to 256 explicit debugger-region ranges / 1 MiB at one
safe point or the next native boundary. Existing `readMany` limits remain 64 ranges /
64 KiB. New sample handles expire after 30 seconds; each owner may retain four.
A 5 ms copy deadline fails with `sample_copy_budget_exhausted` and publishes no
partial data. Page with `memory_capture_read` or `memory.capture.page`, then release.
The frozen `frame_reference` carries session/epoch/VI and sampled origin where
available. `origin_commit` identifies actual VI-origin writes, including repeated values.
Native samples leave video sequence and presentation acknowledgement null; the
overlay host joins them to immutable video-packet identity and explicitly labels
renderer-submit acknowledgement separately from compositor presentation.
Plugins with `debug.read` can request `n64.peripheral.registers`; this does not grant
other N64 methods. Region samples describe debugger-region views, not dirty CPU
cache snapshots.

`rsp_last_task` returns bounded native SP-dispatch provenance without enabling
interpreter mode. Its conventional descriptor and address-matched scanout task
lists are explicitly candidates; they do not prove displayed-pixel contribution
or verified yield/resume. `matrix_state.available` reports retained verified
states for the selected task. `matrix_capture(generation=null,offset=0,limit=4)`
pages actual RSP matrix, viewport, segment and observed stack data for full-hash
verified F3DEX2 FIFO 2.04H. Join state IDs from `rsp_capture`, including cached
vertices whose transform predates the current matrix. Unknown microcode and
unobserved stack levels remain unavailable; overflow is explicit. See the plugin
README for bounds and provenance. Gated RSP capture rows also contain immutable
consumed matrix DMA bytes, labeled
`consumed_dma_operand_only`, with no reconstructed stack presented as RSP state.

`plugin_exports` inspects paged host-mediated plugin export status and committed
artifact hashes. Recording originates in a real plugin user gesture and the host
save picker. It records frozen native samples before renderer coalescing; loss
or overflow fails publication. `app_health.user_interaction_waits` identifies
pending export save dialogs. See `plugins/README.md` for SDK limits and lifecycle.

`app_health.watchdog` describes an independent process, not the event loop it
observes. `main` is responsive/unresponsive/disconnected/unknown; `observer`
reports whether the watchdog itself has recent progress. Main responsiveness
means heartbeat progress within two seconds, not a proof that every native
operation is healthy. Native/error snapshots remain cached during a stall.
A fresh client falls back within 500 ms if a previously healthy main stops
answering; known missing-heartbeat snapshots require no main IPC. The private
snapshot is bounded to 64 KiB and is tied to the selected connection instance.
Transition history is retained in `logs_directory/watchdog.jsonl` and `.1`,
separate from main's bounded app-log journal, so a killed main cannot erase the
only observation of its stall. No automatic process kill or mutating retry is
performed by the watchdog.

Resources normally end when their local connection closes. For separate CLI
start/run/stop commands, explicitly create a durable owner lease:

```sh
ares call owner_lease --action create --name capture --seconds 300
# Copy lease_id from the reply into the environment for subsequent processes:
export ARES_OWNER_LEASE=THE_LEASE_ID
ares call video_start
ares run scenario.ts
ares call video_stop --path /tmp/capture.avi
ares call owner_lease --action release --lease_id "$ARES_OWNER_LEASE"
unset ARES_OWNER_LEASE
```

MCP clients use `owner_lease` with `action: "use"` on each new connection.
`action: "list"` discovers live leases and deadlines. Up to eight leases live for
1–600 seconds from creation; use/poll does not renew them. Release, timeout, app
exit or native-session replacement invalidates their resources. Ordinary clients
retain disconnect cleanup. CLI refuses known persistent starts without a lease.

Local adapters negotiate a schema digest before sending requests. Missing or
incompatible schemas return `adapter_stale` with app/adapter provenance and
instructions to restart the MCP adapter from the rebuilt app. Different builds
with the same schema may reconnect; pending mutations are never replayed.
Adapter-only `build_info` remains usable without contacting the app.

`ares run scenario.ts --video capture.avi` (MCP `run_script.video_path`) owns a
bounded raw BGR24 AVI capture for the script. One image is sampled from the N64
framebuffer at each advanced VI boundary; synthetic runs capture their generated
frame. This is independent of presentation credits and the eight script artifact
limit. The capture is limited to 36,000 frames, 1 GiB of disk storage and the script deadline;
a limit, blank/invalid framebuffer or frame gap stops capture and retains the
usable prefix, which a successful script publishes with a separate warning.
Cancellation or script failure discards its current unsaved recording.
A successful script atomically publishes a new AVI, with metadata in
`operation_status.script_output.video`. No audio is captured; playback is 60 fps.
An intentional same-owner `emu.loadState` preserves pre-load pictures and begins
a new epoch segment in the same AVI. Other-owner loads and resets invalidate it.

### Human controller demonstrations

`demonstration_request` arms a job and pauses the game. The in-app nonmodal banner
shows its prompt and Start/Stop/Cancel buttons; requesting does not start the
recorded interval. `demonstration_start` begins and resumes; `demonstration_stop`
completes it at the current VI boundary, or requests the next boundary before
pausing when called mid-frame. Poll until status is `ready` before export.
Status polling is nonblocking. Cancellation, timeout,
reset/load, owner release and replay takeover invalidate the active interval.
A lease bounds abandonment even after the requesting CLI exits.

```sh
ares call owner_lease --action create --name attack-demo --seconds 300
export ARES_OWNER_LEASE=THE_RETURNED_LEASE_ID
ares call demonstration_request --prompt 'Show Kirby attacking once' --state_path /tmp/attack.state
# Human clicks Start, performs the action, and clicks Stop in the app.
ares call demonstration_status
ares call demonstration_export --path /tmp/attack.input.json
# Later: load the associated state, import the clip, and replay.
ares call state_load --path /tmp/attack.state
ares call demonstration_import --path /tmp/attack.input.json
ares call demonstration_replay
ares call demonstration_status
ares call owner_lease --action release --lease_id "$ARES_OWNER_LEASE"
```

The version-1 `ares-input-clip` records the actual standard N64 Gamepad data
returned at each SI read: port, sequence, relative VI, raw 32-bit controller word,
button bits (N64 wire order), and signed 8-bit axes **after** shaping/deadzone/gate.
Several reads in one VI remain separate ordered events; VIs with no reads remain
empty. This is the `n64_si_gamepad_read` boundary and
`vi_relative_variable_latches` rate convention. It records one selected port.
Other controller types are outside this version's scope.

Human source rejects injected controller mutations/controlled runs while recording.
Merged source includes injected input. Replay bypasses axis shaping using the saved
wire values and owns a neutral override on its selected port. Different latch
counts, port order or relative VI timing fail as `replay_diverged`; completion,
cancel, failure and human takeover release the override. Replay is an owned native
frame operation (or participates in the owning JS script's frame advances).
`demonstration_status` exposes replay cursor, completion and stop reason.

Jobs default to 600 VIs and 300 seconds and permit at most 36,000 VIs, 600 seconds,
120,000 latches and a 24 MiB JSON artifact. Exceeding a recording bound marks
overflow/incomplete and prevents export. Export publishes atomically; import validates
event order, wire/decoded values and ROM identity before admitting playback.
Optional `state_path` saves the paused pre-demonstration state; its path and SHA-256
are associated with the clip. Restore that state explicitly before replay. Exact
inputs alone cannot guarantee the same outcome from an arbitrary starting state.

Native JS uses `input.demonstration.request({prompt,port,source,maxFrames,timeoutMs})`,
`status()`, `start()`, `stop()`, `cancel()`, `replay()`, `export(path)` and
`import(path)`. The two file methods are promises and require script output/state
capabilities respectively. Scripts advance playback with `await frames(duration_frames)`.
A request may return from its script to await the human's later Start interaction.

Physical keyboard and physical gamepad demonstration/replay are manual acceptance
gates; automated synthetic traces and UI button tests do not establish them.

`script_results` lists retained handles in pages of eight with consumption state,
expiry, pending reservations and byte/slot limits. On backpressure, explicitly
release an unneeded unconsumed handle or wait for its reported expiry. CLI
cancellation also discards a pending result before transfer, so a late completion
cannot silently retain it. Script output failures include the publication reason.


### Prepared human recording (October 28)

Use `demonstration_prepare(initial_state_path, output_directory, prompt, setup=[],
video=false, max_frames=3600, max_seconds=300, waiting_seconds=300)` for the new
required-state contract. The output directory must not exist. Legacy
`demonstration_request(state_path=...)` retains its old meaning: save the current
paused state to that path. It does not load a starting state.

Preparation checks ownership and the source file, loads paused, applies the
bounded `{address, hex}` RAM write list, saves and hashes `initial.state`, then
arms. Errors leave emulation paused. The returned numeric job survives the
requesting script/CLI connection. `demonstration_status` reports publication
separately from input completion. Waiting expiry has its own budget; capture
gets a fresh max_seconds budget when it starts.

Mapped physical port-one input can start capture while paused, after held
controls return to neutral. Unmapped keys, consumed UI input and injected MCP
input do not trigger this path. Mapped stick movement must pass the mapping's
deadzone and the native deliberate-motion threshold. Start recording permits
intentional neutral frames. The initiating press is held through the first
eligible native SI latch; subsequent physical transitions are queued in order
(up to 128, then explicit cancellation). Other selected ports support explicit
Start/MCP start; this frontend currently maps physical controls to port one.
`started_by` identifies controller_input, ui_button or mcp. Stop pauses at a VI
boundary and automatically publishes `input.json`, `initial.state`, optional
`video.avi`, and a provenance/hash manifest. Failed saves retain input and expose
Retry saving in the toolbar or `demonstration_retry`. Limits produce an explicit
partial clip; partial clips export for inspection and cannot be imported as
complete replays. Friendly `held` names are additive version-1 fields; `raw`
remains authoritative and importers ignore derived names.

Scripts use `await input.demonstration.prepare({initialStatePath,
outputDirectory,prompt,setup,video,maxFrames,timeoutMs,waitingMs})`; grant the
initial state through `--state` and the new output directory through `--artifact`.
The script can return the receipt and poll status without advancing an armed
job. Its state load is recorded in the script epoch lineage.

Both video APIs accept `source: "framebuffer" | "presented"`. `video_start`
defaults to presented renderer output; `run_script`/`ares run --video` defaults
to exact VI framebuffer capture (`--video-source` overrides). Dimensions come
from the selected source: the reported Kirby example is 320×237 framebuffer
versus 640×240 presented, not universal fixed dimensions. Presented capture
can omit/repeat emulated coordinates and does not promise exact VI coverage.
Framebuffer capture starts at the next completed VI boundary. fps affects AVI
playback only; neither source adds audio.

Raw BGR24 frames spool to private anonymous disk storage behind a 16 MiB native
producer queue. Backpressure stops capture with a readable prefix instead of
silently dropping frames. Disk/open/write/read errors are explicit; reset,
cancellation, owner release and shutdown remove the spool. At 320×237 each frame
is 227,520 bytes; the 1 GiB script budget permits 4,719 complete frames, subject
to the frame/time limits and actual source dimensions. Artifact failure no longer
throws away script JSON; CLI emits the result and an independent warning.
State loads preserve the current script video across epochs. Scripts can also
save separate sequential clips; see “Multiple videos from one script” below.

The microtask storm guard allows 4,096 jobs without successful host progress;
reads/writes or actual frame completion renew that budget, scheduling yields do
not. The script deadline, memory and frame limits still apply. Limit errors
include executed jobs, host-progress events, reads and frames.

### Multiple videos from one script

Use the sequential script video API with pregranted output paths:

```js
export default async ({emu, frames, args}) => {
  await emu.loadState(args.state);
  await emu.video.start({source: 'framebuffer'});
  await frames(120);
  await emu.loadState(args.state); // Keeps the first 120 captured frames.
  await frames(180);
  const first = await emu.video.stop(args.firstVideo); // Saves 300 frames.

  await emu.video.start();
  await frames(60);
  const second = await emu.video.stop(args.secondVideo);
  return {first, second};
};
```

Grant the state using `--state` and each AVI using `--artifact`. `stop(path)`
returns the published video metadata and releases that recording before the next
`start()`. Output overwrite is disabled. A failed save retains the stopped clip:
fix the destination or choose another granted path and retry `stop(path)`.
`status()` inspects the current recording; `cancel()` discards it. These are all
awaited operations. Only one recording can exist at a time; a second start fails
with `recording_exists` until the clip is saved or cancelled. Automatic `--video`
capture cannot be combined with explicit start/stop/cancel in the same script.

`start` defaults are source `framebuffer`, maxFrames 36000, maxBytes 1073741824,
fps 60 and timeoutMs equal to the script's configured timeout. Those five fields
may be overridden within the public recording bounds. Frame/byte/time budgets
apply to the whole clip and do not reset on state loads. Source dimensions must
remain consistent: a dimension change stops capture with a usable prefix and
`dimensions_changed`; start a new clip for a different resolution.

Same-owner state loads preserve captured pixels in explicit recordings,
`ares run --video`, and lease-owned `video_start` recordings. Frames are appended in capture order at the selected playback
fps, with a visual cut at each load. Emulated frame advancement remains paused while the script
waits for state loading or AVI publication. `segments` metadata records each
captured epoch's native start/end frame, its zero-based AVI `first_frame` offset,
and its frame count. Top-level epoch/start_frame/end_frame describe the current
native epoch (zero frame coordinates after a load until its first capture); a multi-epoch video is not one uninterrupted native VI interval.
Exact framebuffer coverage applies within each captured segment; presented-frame
capture retains its existing timing limitations. A clip allows up to 64 captured
epoch segments, and exceeding that bound retains the prefix with `segments_limit`.

The existing script quotas allow eight published artifacts and 64 host requests
per run. Video start/status/cancel do not consume artifact slots; successful video
stops do. Script termination cancels any unsaved current recording. Videos already
published remain intact if a later operation fails or the script is cancelled.


### Compact human-recording controls and prepared-state preview

An armed human recording adds two icon buttons to the playback toolbar: a red
circle to start and an X to cancel. The same red button becomes a rounded stop
square while recording. The prompt and neutral-input guidance remain available
in the tooltip and accessible description. The toolbar stays reachable during
an active job even when its normal pointer-idle timer expires. Save failures
expose a retry icon; successful automatic publication gives a brief saved notice.

Paused N64 state loads and demonstration arming present the restored framebuffer
immediately. This is a read-only preview of saved RAM, without GPU synchronization
or core execution. It does not advance a VI, sample a controller, feed the video
recording tap, or claim a matched gameplay-frame/origin reference. Blank/invalid
VI data shows a black preview instead of retaining an unrelated old scene. Normal
renderer frame credits still apply, so the preview also survives a temporarily
unavailable or reloading renderer.
