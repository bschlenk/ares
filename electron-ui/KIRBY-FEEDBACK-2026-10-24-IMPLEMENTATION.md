# Implementation and acceptance record

This is an incomplete implementation of KIRBY-FEEDBACK-2026-10-24-PLAN.md.
It must not be represented as acceptance of all slices A–H.

## Implemented

- A: explicit installed-helper dispatch; help/invalid command handling; detached
  GUI launches; durable profile launch logs; bounded asynchronous JSONL diagnostics
  with rotation, source/generation cursors, truncation/loss/repetition controls;
  main/native/renderer error capture; early stdio/fatal handlers; `app_logs` and
  cached `app_health` management tools independent of native responsiveness.
- B: shared CLI/MCP script polling with explicit refresh and main-recorded owned
  load lineage; overall deadline; owned cancellation; result/file publication
  states; immutable main results with opaque handles, SHA-256, 15-minute TTL,
  16-result/16-MiB quotas and explicit release/backpressure. Native completion
  transfers retain four bounded owner-scoped tickets for 60 seconds and require
  acknowledgement after transfer. Fresh authorized local connections retrieve
  completed results, including default/zero selection in the current native
  session. Adapter/app build diagnostics include source identity and native hash.
  CLI input schemas use Zod input mode; the MCP SDK already exports input schemas.
  Both controller spellings remain supported and documented.
- C foundation: `memory_sample` freezes up to 256 region ranges / 1 MiB with a
  5-ms copy limit, four handles per owner and 30-second expiry. Existing readMany
  limits remain unchanged. Frozen pages include native session/epoch/VI, safe-point
  or boundary kind and current VI origin where available. Origin writes now have independent identities. Native sample video/presentation
  linkage remains null until joined to a submitted packet in the overlay host.
- E first step: plugins can read `n64.peripheral.registers` with `debug.read`;
  no blanket N64 permission is granted. Replies include epoch/frame.

## Observed acceptance

- Full regression run: 138 tests, 137 passed, one private-media test skipped.
  The suite includes real native instruction/state/frame fixtures, actual MCP
  stdio schema inventory and local IPC. Unix sockets require execution outside
  the filesystem sandbox on this machine.
- Generated N64 fixture: 128 ranges / 128 KiB sampled, source RAM changed, frozen
  pages unchanged. Provenance explicitly reports no presentation match.
- Generated N64 fixture: CLI script performs two owned state loads, uses both
  controller spellings, advances frames and exits with JSON identical to its file.
- Fresh CLI processes retrieve a previous result by default and explicit handle.
- `tests/diagnostic-fatal.cjs`: EPIPE remains serviceable; no-native health/log
  calls work; injected fatal main error exits with code 1 and a durable stack.
- `tests/feedback-packaged.cjs`: packaged app runs the actual Kirby recorder,
  including its own state load, 10 settling VIs and 80 recorded VIs. It emits
  complete JSON, writes matching output, and a second process fetches identical
  results. App and adapter build IDs match. Inputs are copied into a disposable
  profile and original ROM/state hashes remain unchanged. Results and summary
  live in `artifacts/feedback-packaged`.
- Schema fixture changes record only the five intentional tool additions:
  app_health, app_logs, build_info, memory_sample and script_result_release.
  Existing reference signature differences remain unchanged.

## Outstanding work and acceptance

A now has slow/full-disk tests, bounded restart history, timeout component/request
metadata and tracked export picker waits. Independently responsive main-stall
reporting still needs an external watchdog; current observations remain cached
or explicitly no-response. B has simultaneous reservation, expiry and concurrent
CLI/external-reset acceptance below; native completion-transfer stress remains. The result store is process-local, not persistent across app exit.

C now includes app/native identity on renderer deliveries, independent origin-write
identity, packet/renderer-submit linkage, and a shared 5 ms copy deadline for new
boundary samples. CPU-cache-view larger samples and VI-origin callbacks are delivered below.
Complete crop transforms and project-script sample handles remain.

D now has a supported host div/layer, scoped activation and ownership, ordering,
visibility, input pass-through, disposal, DPR geometry, explicit native observer
handles, frozen push callbacks and renderer-submit matching. See the continued
acceptance below. Actual detached OS viewport windows and complete crop-transform
provenance remain outstanding; VI-origin callbacks are delivered below.

E now has bounded dispatch and consumed-RDP submission provenance with both RSP
executors tested, as recorded below. Verified yield/resume and displayed-pixel
contribution remain. F has signature-gated consumed DMA operands, but verified
per-draw matrix state remains unavailable. G now has scoped gesture-authorized
clipboard/file export and bounded sequence recording, as recorded below.

H is partial acceptance of the implemented portions, not whole-plan completion.
The skeleton overlay, graphics fixtures, full performance/cost report and all
remaining slice acceptance are still required.

## Installed handoff

The rebuilt bundle replaces `build_macos/Ares.app`; the original pre-task bundle
is backed up at `artifacts/feedback-previous-1792865329/Ares.app` (relative to
`electron-ui`). Existing Ares-managed helpers in `~/.local/bin` were refreshed.
Their destination remains the normal app path. Installed help/subcommand help
and invalid-command checks passed without GUI launch. The copied-package test
passed for bundled Node 24.22.0, native loader, MCP stdio, and plugin
scaffold/build/add/enable/open/reload/command without checkout read access.

A final focused regression also verifies that failed file publication preserves
an already committed immutable script result; it passed together with the other
script-artifact tests. Build-info's `node` records the build-time Node version;
packaged runtime details remain in `Contents/Resources/runtime.json`.

Useful commands after launch:

```
ares --help
ares call build_info --app true
ares call app_health
ares call app_logs
ares call script_result
ares call script_result --result_handle UUID
```

The initial delivery did not complete D/F/G or the remaining C/E work; subsequent overlay progress is recorded below.


## Continued overlay delivery

- `ui.registerOverlay` provides a host-owned div exactly over the displayed screen.
  Resize snapshots expose CSS size, DPR backing-store size, logical picture size
  and native source-pixel size. Plugins append canvases to this div, without
  discovering `#screen` or appending body layers. The complete example is in
  `examples/overlay`; the SDK contract and drawing example are in `plugins/README.md`.
- Overlay manifest mode is supported. Multiple layers have ordering, visibility,
  default input pass-through, explicit interaction and lease-scoped disposal.
  DOM Settings stays above the layers; native OS dialogs are not composited through.
- The single viewport may move into a floating workspace popup. It keeps its
  overlay DOM and alignment; the existing workspace regression passes.
- `scope.onFrame` starts after plugin publication. Eight native observer runtimes
  / four per owner use explicit read/stop handles. Starts are serialized in main
  with bounded admission. Each callback has a 2 ms runtime and 64 KiB read limit;
  rotating aggregate native work is bounded to 6 ms. A bad callback is stopped
  independently. Existing low-rate observation remains available.
- Native notifications coalesce by observer. Main allows one acknowledged delivery
  and one latest replacement per observer; renderer callbacks acknowledge only
  after settling. Frozen samples carry native/session/epoch/VI, current origin
  and an identity incremented at every VI-origin write, including repeated values.
  Skipped counts include source scheduling and delivery coalescing. These are live
  samples, not a lossless recording stream.
- AEF3 video packets carry immutable epoch/VI/origin-write identity and logical
  dimensions from submission; the parser also accepts AEF2. `overlay.present`
  matches frozen data to these packets and hides unmatched data. Renderer metadata
  explicitly labels acknowledgement as `renderer_submit`, not compositor timing.
- `ui_screenshot` captures the supported DOM composition and reports its frame
  reference only if the renderer's submitted frame is stable across capture.
- New native tests cover multiple concurrent observers, owner denial, ambiguous
  legacy reads, immutable values, independent disposal and an infinite-loop
  offender alongside a healthy observer. Delivery tests cover slow consumers and
  wrong-owner acknowledgements. Mixed AEF2/AEF3 fragmentation preserves identity.
- Full regression: 143 tests, 142 passed, one skipped. The isolated Electron overlay
  test passes with resize/zoom, DPR canvas sizing, Settings, floating viewport,
  matched/stale samples, slow callbacks, screenshot pixels and cleanup.
- The same overlay test against copied Kirby ROM/state inputs passes with actual
  320×240 logical / 640×240 source geometry. Its active VI height is 237 lines;
  this is kept distinct from the nominal submitted picture height. Arbitrary VI
  active-region crop/offset transforms still require additional provenance.

Remaining work includes independently
responsive stall reporting, complete graphics-task contribution/resume proof,
verified F3DEX2 matrix state and the remaining stress/acceptance cases. This is still not whole-plan completion.


An additional generated MIPS fixture verifies two writes of the same VI origin
address produce distinct native write identities. It passes independently of the
143-test suite recorded above. The overlay example builds successfully through
the real plugin artifact builder. Packaged runtime/MCP/plugin tests also pass.


The normal `build_macos/Ares.app` was replaced with overlay build
`ef18398ab85ae1b6`; installed helper → packaged CLI → main → native Kirby recording
and fresh-process result retrieval passed again. Previous delivery is backed up
at `artifacts/feedback-before-overlay-1792867458/Ares.app` relative to electron-ui.
No second permanent app path was introduced. Diagnostic fatal/EPIPE checks pass
with the observer plumbing in place.


## Continued task provenance, consumed inputs and exports

- E: actual SP HALT-clear freezes the conventional DMEM 0xfc0 descriptor candidate,
  observed PC, dispatch VI/origin identity and IMEM hash. IMEM DMA rows add bounded
  revisions. RSP-submitted DPC ranges tag consumed software/Vulkan RDP words;
  partial Vulkan commands preserve their original tags and mixed submitters become
  unknown. CPU submissions are never attributed to the last RSP task. SetColorImage
  and draws retain target transitions. `rsp_last_task` / `n64.rsp.lastTask` expose
  this under read-only debug permission, without forcing interpreter execution.
- Retention: 64 tasks, eight code revisions / 16 targets per task, eight scanouts
  and eight candidates per scanout; truncation is explicit. IDs do not alias after
  reset. Byte-identical descriptor reuse is a link, not verified yield/resume.
  Address-matched scanouts and boundary task lists are explicitly candidate-only,
  never claims of displayed-pixel contribution. Conventional descriptor contents
  remain candidates for arbitrary microcode. Timing scope covers only descriptor
  and IMEM snapshots, not all graphics provenance work.
- Generated native fixture exercises actual SP dispatch, IMEM DMA, RSP-submitted
  DPC commands and BREAK in interpreter and JIT modes, including actual generated
  JIT blocks. Late descriptor rewrites, bounded retention, reset and task reuse
  pass. Native service / MCP validation and stale task IDs pass.
- F first stage: explicitly signature-gated F3DEX2 dispatch records freeze the
  first actual 64-byte matrix DMA input when RDRAM is read. Subsequent RAM/DMEM
  rewrites leave the capture unchanged. Multiple candidate transfers are marked
  ambiguous. Raw fixed-point bytes remain raw, with task/VI identity. Unsupported
  signatures/transfer forms report unavailable data. Both executors pass the
  generated DMA fixture and the transported viewer contract validates it.
- This does not verify real F3DEX2 arithmetic, stack operations, segmented-pointer
  interpretation, projection/viewport or per-draw transforms. The fixture is a
  controlled compatible dispatch/DMA program, not Nintendo microcode execution.
  `matrix_stack_available` remains false and `rsp_matrix_stack` null. Kirby's
  plugin must not replace its transform logic with a fabricated authoritative stack.
- G: `clipboard.write` and `files.export` capabilities, trusted user-event
  consumption in isolated preload, host picker grants and post-dialog lease /
  session / epoch validation. Text and bounded native frame-sequence APIs publish
  atomically with SHA-256. Existing destinations require explicit overwrite and
  changed destinations are preserved. Reset/unload/cancel revoke publication.
- Frame sequence limits are 3,600 frames / 16 MiB / 600 seconds maximum; one per
  plugin / two globally, bounded queue 32 records / 1 MiB. Samples reach the main
  writer before renderer coalescing. Native loss, overflow and byte exhaustion
  discard temporary output; bounded frame/time/stop prefixes have complete JSONL
  summaries. CLI/MCP `plugin_exports` pages statuses; health exposes picker waits.
- Export unit coverage passes gesture/capability denial, cancelled/stale pickers,
  preservation/overwrite races, frozen ordered records, queue/byte/native loss,
  reset and cancellation. Isolated Electron tests pass real versus synthetic
  clicks, clipboard, text save, picker cancellation, a 12-VI sequence and reset
  during a picker. A concurrent UI stress attempt timed out waiting for sequence
  publication; isolated rerun passed. Export failure remains explicit rather than
  publishing an incomplete recording.
- Full regression: 157 tests, 156 passed, one private-media test skipped. Focused
  rebuilt native task / export tests also pass. The copied Kirby overlay test
  passes with the new task metadata. Schema inventory now has 98 tools, adding
  `rsp_last_task` and `plugin_exports` intentionally; existing reference signature
  drift remains limited to the previously recorded batch difference.
- User-supplied controller artwork is preserved in `assets/app-icon.png`, with a
  complete generated macOS `assets/Ares.icns`. Packaging installs this resource
  and sets CFBundleIconFile. The generator is `scripts/build-icon.cjs`; resource
  header/resolution checks pass. No artwork redesign was made.

Remaining whole-plan requirements still include complete C/D crop provenance and
actual detached-window work listed above, verified E yield/resume / contribution,
F authoritative transforms and their real-microcode fixtures, remaining A/B stress
cases, independent stall responsiveness and final whole-plan acceptance. This
record does not mark those requirements complete.

## Additional boundary and reliability completion

- `memory_sample` now supports `view: cpu` for physical N64 RDRAM ranges.
  Resident dirty DCache bytes override backing RAM without cache fill, writeback,
  guest timing or degraded-RDRAM RNG effects. Unsupported regions reject CPU view.
  Defaults stay physical. The generated MIPS fixture samples 128 ranges / 128 KiB,
  observes a dirty cached store, changes it with another actual CPU store, verifies
  frozen pages, and confirms raw backing RAM never changed. Copies retain view,
  TTL and per-owner bounded-sample admission rather than escaping those limits.
- `scope.onFrame` and native observer starts support `boundary: vi_origin` on N64.
  The callback runs at the actual VI register write, after origin/identity commit
  and before later CPU stores. Repeated origin values remain distinct. Default
  VI observers and legacy native start forms remain supported. Both boundary modes
  share a rotating 6-ms aggregate budget per VI / epoch. Exclusive scripts suspend
  them. The generated fixture observes bytes 0x11 and 0x22 at two identical origin
  writes in one VI, then confirms live DMEM is 0x33 while the samples stay frozen.
  Origin references are labeled vi_origin and remain unmatched, not guessed to be
  future displayed packets. Sequence exports accept the same boundary selection.
- Durable app-log tails now reload across restart from at most four bounded regular
  files, retaining original instance IDs under a new cursor generation. Malformed
  tails are ignored and the next append resumes on a new line. Tests cover rotated
  history, stale generations, a stalled sink / full queue, ENOSPC and recovery.
  The request path stays serviceable during sink failure.
- Result-store stress verifies four simultaneous maximum-size reservations,
  16 retained results, explicit backpressure, release, expiry, session selection
  and reused-operation-ID ambiguity.
- Native and app transport deadlines now carry bounded component, method, request
  ID, reason and no-response observation through the authenticated local endpoint
  and human-readable CLI/MCP errors. Error codes remain stable. No response is
  not diagnosed as a particular dialog or current main-loop state. Transport
  tests verify metadata and nonreplay.
- The expanded full regression before the timeout-context addition passed 162
  tests: 161 passed, one private-media skip. The focused timeout/reliability run
  passed all 26 checks. Final integrated acceptance is recorded below when done.

The prior task/export delivery was installed at the normal app path with build
b7c333f22acbda7c. Installed helper → packaged CLI → main → native Kirby recording,
result retrieval, task provenance and export-status inspection passed; copied
package tooling/icon and fatal/EPIPE diagnostics passed. Its predecessor backup
is artifacts/feedback-before-tasks-1792880950/Ares.app relative to electron-ui.
The additional boundary/reliability code above requires the next packaged build.


The final expanded regression passed 163 tests: 162 passed and one private-media
skip. A separate real CLI test also verifies a competing client receives busy,
the original operation remains running, and an external reset terminates its
waiter with an explicit epoch/interruption error. Kirby overlay acceptance now
includes the supported vi_origin SDK subscription alongside live VI overlays;
DPR/resize, Settings, floating layout, screenshots, coalescing and unload pass.
Isolated export UI and fatal/EPIPE diagnostics pass again.

Final boundary/reliability build is 5d6f285e12441b3f, installed at
build_macos/Ares.app. Its predecessor is backed up at
artifacts/feedback-before-boundaries-1792881736/Ares.app relative to electron-ui.
The source identity now includes PNG/ICNS artwork as well as code. The full plan
remains incomplete where verified transforms, contribution/resume proof and
remaining platform/acceptance gaps above are explicitly unavailable.

The exact installed helper passed final Kirby acceptance against build
5d6f285e12441b3f: 80 recorded VIs, matching file/JSON, fresh default/explicit result
retrieval, equal app/adapter build IDs, native task provenance and export status.
Copied-package native loader, real MCP stdio and plugin scaffold/build/add/enable/
open/reload/command passed without checkout reads. Original private media hashes
remain unchanged. Detailed task IDs, epochs and scoped snapshot timings are in
artifacts/feedback-packaged/summary.json; this is not a complete graphics-cost or
per-draw transform acceptance report.

## Native screen crop/rotation provenance

- Native AEF4 video packets carry screen-canvas dimensions, the actual final crop
  origin and rotation, captured synchronously during the core's video callback
  after refresh. The parser still accepts AEF2 and AEF3, including fragmented and
  mixed-version streams. Unsupported/missing geometry is null; invalid bounded
  geometry is rejected before pixel allocation. Frame/screenshot packet offsets
  account for the expanded header.
- Overlay resize snapshots expose frozen `geometry`, `canvasToCss` and
  `canvasToPixels`. They map pixel-edge coordinates from the pre-rotation core
  screen canvas through its real final crop into the host div and DPR backing
  store. They follow resize, aspect correction, letterboxing and floating layouts.
  Native/session resets clear the old geometry. Nominal logical-picture dimensions
  remain separate, including Kirby's 320×240 logical / 640×240 packet geometry.
- `ui_screenshot` returns overlay-local matrices and a separately labeled
  window-CSS screen rectangle. Frame and geometry must both stay stable across
  capture; otherwise provenance is null. This is renderer-submit provenance.
- The generated native fixture draws uniquely numbered pixels through the actual
  Screen refresh pipeline at 0/90/180/270 degrees with a nonzero crop. Tests use
  those output pixels to verify transforms at native, fractional CSS and DPR sizes.
  Malformed/unavailable geometry and mixed protocol fragmentation tests pass.
- Full regression: 166 tests, 165 passed, one private-media skip. Real Kirby overlay
  acceptance passes the new geometry and screenshot metadata along with resize,
  zoom/DPR, floating viewport, origin/VI delivery, stale matching and cleanup.
  Synthetic overlay and scoped export UI tests also pass.
- This closes the generic core screen-canvas crop/rotation mapping gap. It does
  not reconstruct N64 VI filtering, source-RDRAM/subpixel coordinates, interlace
  history or authoritative RSP matrix state. Those remain distinct capabilities.

Build 567c4dc3dedd9191 replaces the normal build_macos/Ares.app. Its predecessor
is backed up at artifacts/feedback-before-geometry-1792887328/Ares.app relative
to electron-ui. The supplied icon remains installed. Remaining plan requirements,
including verified F3DEX2 transforms and task contribution/resume proof, are not
marked complete by this delivery.

Packaged acceptance additionally exposed a pre-existing reentrant-quit race:
second quit / window-close / signal requests could pass the `quitting` guard
before asynchronous cleanup removed the named-instance claim. The guard now blocks
all quit requests until cleanup is finished; individual cleanup errors are logged
without skipping later service cleanup. The new isolated `electron-shutdown.mjs`
fixture deliberately delays final cleanup and repeats quit/SIGTERM, verifies the
app waits, then verifies metadata removal. It is included in the acceptance runner.
Real SIGTERM/SIGINT/SIGKILL, named restarts, fresh credentials and nonreplay checks
pass with the fix. This is a focused addition after the 166-test regression above.

The final geometry/shutdown build is 0e6552583cea3057, superseding the intermediate
567c4dc3dedd9191 build at the same normal app path. The intermediate bundle backup
is artifacts/feedback-before-geometry-final-1792887542/Ares.app relative to
electron-ui. No helper destination or app-icon change was introduced by this fix.

Final copied-package checks pass, including the previously failing named-claim
shutdown case, real MCP stdio and plugin tooling without checkout reads. The exact
installed helper passes the real Kirby 80-VI recorder, file/JSON agreement,
fresh-process default/explicit results, matching app/adapter build IDs and native
task/export inspection. Original media hashes remain unchanged. Fatal/EPIPE and
no-ROM diagnostics also pass with the final quit guard.

## Zero-skip local lane and actual microcode consumption

The previously skipped test was `plugins-game-live.test.cjs`: verified Kirby
profile identity after ROM renaming and byte-order normalization, plus rejection
of a different identity. It needs ARES_PLUGIN_TEST_ROM. Providing the existing
private ROM ran it successfully, and the full Node suite passed all 166 tests with
zero failures and zero skips. No test was removed to achieve that result.

`npm run test:all -- --rom /path/to/Kirby.z64` now rebuilds native host/fixtures and
TypeScript, selects every Node test including the private identity test, and
requires an explicit zero-failure/zero-skip TAP summary. Missing media fails before
execution. ARES_NATIVE_BUILD selects an already configured CMake build directory.
The ordinary fixture-only acceptance lane still explicitly excludes private media.

Next matrix-capture work found and repaired two actual execution issues:

- A task boots before loading graphics microcode. Dispatch detection now runs after
  IMEM DMA, so actual Kirby graphics commands are discovered rather than only the
  preloaded synthetic dispatch fixture. Handler overlays preserve an open command
  when its dispatch signature is unchanged; replaced signatures are rediscovered.
- Cached RSP JIT blocks copied their compile-time `clocksTotal` into each later
  execution. Preserving the live elapsed counter removes backwards jumps and
  wrapped command-cycle results. This is elapsed-counter correctness, not a claim
  of exact interpreter/JIT timing equivalence.

Generated fixtures cover actual late IMEM DMA, a mid-command handler overlay,
immutable matrix DMA bytes and elapsed-clock preservation under both RSP executors.
The private `test:matrix` gate executes actual game microcode: the saved-state JIT
run captured 104 matrix operands and a fresh-boot interpreter run captured 20.
Both verify retained native records after overwriting their source RAM, task IDs,
IMEM revisions, reset invalidation and original ROM/state hashes. Capture overflow
is explicit: three JIT generations reached the 4,096-record cap; no claim of a
complete draw sequence is made. Wall time and transport counts are recorded in
artifacts/kirby-matrix-acceptance.json.

An exploratory attempt to run this JIT-authored private save under whole-system
ForceInterpreter (and the interpreter debug gate) did not submit new graphics
tasks. Cross-executor saved-state compatibility is therefore not verified here.
The interpreter acceptance starts from power-on with its matching configuration;
it is not represented as same-frame saved-state parity. This remains separate
from the generated interpreter/JIT fixture coverage.

Consumed input capture is now exercised with actual microcode, but
`rsp_matrix_stack` remains null. Verified post-operation stack, multiplication,
projection/viewport state and per-draw transform proof are still unfinished.

Final zero-skip run after the fixes: 166 tests selected, 166 passed, zero failed,
zero skipped. The packaged native binary also passed both actual-microcode paths:
104 operands through VI 8 in the saved-state JIT run; 20 operands through VI 34
in the fresh-boot interpreter run. These are different starts, not same-frame
arithmetic parity. Copied-package runtime/MCP/plugin/signal/icon checks pass.

Build f844b748f35a39ce replaces the normal build_macos/Ares.app; its predecessor
is backed up at artifacts/feedback-before-microcode-1792888751/Ares.app relative
to electron-ui. The app icon and existing installed-helper destination remain.

## Verified matrix stack — October 25

Supersedes the consumed-input-only limitation above for the explicitly supported
F3DEX2 FIFO 2.04H profile. The native capture now freezes actual pre/post-command
DMEM modelview, projection, valid combined matrix, viewport, segment table and
stack pointer. Full 4 KiB IMEM hashes plus static dispatch/vertex tables gate the
layout. Matching assembly and generated public fixture are pinned to
Mr-Wiseguy/f3dex2 bd31393fd02b89e024b043c8c50c9a5a10143fb6 (CC0).

Observed stack DMA writes preserve historical saved values; unknown ancestors
remain null, and saved RAM is explicitly not claimed current. Actual pop results
come from RSP state. State capture is bounded to 512 entries/generation and 32
saved levels, with overflow and partial capture exposed. Disabling/releasing
capture invalidates live stack/vertex shadows; retained immutable pages survive.

`n64.capture.matrices` / MCP `matrix_capture` pages snapshots. RSP command rows
join before/after IDs and actual cached vertices to the transform used when each
vertex was loaded, even if current matrices subsequently change. Raw clip and
quarter-pixel screen coordinates are retained. No CPU matrix arithmetic is used
as authoritative data. The separate consumed operand still has
`rsp_matrix_stack: null`. Both new reads require plugin `debug.read`; enabling
capture also requires `session.control`. Task matrix availability is derived
from retained verified states for that task. The MCP inventory is now 99 tools.

The generated fixture executes actual source-matching microcode under the normal
interpreter and JIT: nested lists, segmented pointers, push/load/multiply/pop,
projection/viewport changes, noncommuting transforms, signed fixed-point
rounding, cached vertices after matrix changes, late RAM rewrites and actual RDP
pixels. It also checks partial/excessive stack depth, 512-state overflow, modified
code/tables and stale paging. It needs no private ROM and is selected by test:all.
The live private Kirby gate captured 208 verified states through VI 8 from the
provided JIT state and 34 through VI 34 from interpreter power-on. These are
different starts; same-frame parity is established by the generated fixture.

Capture remains a bounded VI-origin-swap diagnostic, not proof of compositor
presentation, displayed-pixel contribution, arbitrary microcode support or a
complete draw history when the command cap is reached. The private skeleton
plugin's joint/model interpretation and UI migration remain separate follow-up
work; no unsupported microcode is silently interpreted as this profile.

Final delivery: build **9f0386eed16ccd2b** is installed at
`build_macos/Ares.app`. Previous build is preserved at
`electron-ui/artifacts/feedback-before-matrix-stack-20261025/Ares.app`.
Packaged candidate: `artifacts/feedback-matrix-stack-20261025/Ares.app` relative
to electron-ui. Final full suite: **168 passed, 0 failed, 0 skipped**. Generated
microcode verifies just-in-time operand updates and a pop after saved RAM was
changed, distinguishing historical pushes from actual restored matrices.

Both real Kirby capture paths pass using the bundled native host. Copied-package
runtime, MCP stdio, plugin CLI/reload, icon and shutdown checks pass. The exact
installed helper passes the private 80-VI recorder, complete paged result/file
agreement, adapter/app build identity, health/logs, provenance and the new
`matrix_capture` MCP tool. The private recorder now accepts multi-scenario args
and returns larger results; the acceptance harness was updated for that format
and checks every retained result page. Private ROM/state/recorder were not edited.

## Kirby skeleton migration — October 25

The canonical migrated plugin is `examples/kirby-skeleton`, version 2.0.0.
It replaces live display-list page scans and JavaScript matrix-stack arithmetic
with immutable native matrix-command snapshots. Object grouping uses actual
stack depth/model segment, while joint origins and camera are explicitly derived
visualizations. Actual combined/viewport state from vertex load is used when the
verified profile provides it; other points are labeled derived from the actual
modelview/projection snapshots. Raw bytes, task/state IDs, frame/capture and
matching renderer-submit references, partial/projection metadata are exported.

A new read-only `n64.capture.transforms` feed retains four immutable VI views,
256 matrix commands per task and eight source task batches. This is independent
of the verbose RSP command-row cap. Views select a recently stopped scanout task
candidate with captured matrices; they do not promise complete contributor or
yield/resume proof. Missing/unknown state and quota loss remain explicit. The
compact generation is exposed in boundary script `emu.info().capture_generation`.

Live acceptance exposed and fixed these integration gaps:

- Kirby's VI starts a scanline into its color target. Task candidates now include
  bounded compatible source ranges and prefer recent reused-buffer submissions.
  Range association remains candidate-only, not proof of pixel authorship.
- Address-swap captures cannot identify repeated VI-origin writes. The compact
  view has its own VI generation and exact origin-write identity, including when
  reusing a recent stopped task's immutable matrix data. Strict VI/epoch/session/
  origin matching is required before `overlay.present`.
- VI observers now freeze ordinary-play boundary data before the next control
  dispatch, preserving the last matching sample when pausing. Observer admission
  retries transient exclusive-operation busy responses with a bounded retry
  count; disposing a scope cancels pending admission and suppresses stale logging.
- Pending overlay paints capture their own immutable scene instead of reading a
  later replacement/null global scene.

The plugin uses a host-owned DPR canvas, no `#screen` queries or body overlay,
and gesture-scoped clipboard/JSON saves. Display mapping is currently gated to
Kirby's tested 320x240 logical / 640x240 native path with no core canvas crop or
rotation. It does not infer arbitrary VI source filtering geometry. The generated
fixture covers frozen history, repeated origin identities, quota loss, actual
vertex-load combined matrices, stale paging and both RSP executors. Capability
tests require debug.read for the compact feed and session.control in addition
for capture control.

Full Node regression run: **170 passed, 0 failed, 0 skipped**. Private Electron
acceptance (`test:skeleton`) identifies Kirby's 16-joint rig and 34 captured nodes,
checks painted pixels, pause/resize/DPR, Settings, floating viewport, scoped copy/
save, reload during an exclusive script, a subsequent state-load epoch and owner/
overlay cleanup. Original private media hashes are unchanged. Screenshot and
frame JSON: `artifacts/kirby-skeleton-migration`.

Final migration handoff: **a438ce5fa6068350** replaces `build_macos/Ares.app`.
No app backup was created. The already-enabled external
`/Users/bschlenk/Developer/kirby/ares-plugins/kirby-skeleton` now contains the
canonical v2 manifest, plugin.js, skeleton.js, style.css and README. The existing
Kirby workflow/rendering notes were updated only where they described the old
live display-list walker. Camera-solver exports preserve `frame`, `screen`,
camera `persp`/`view`/`viewport`, and joint `node`/`parent`/`world`/`matrix` and
`screen: [x,y]`; provenance/raw bytes are additive. `mesh` is explicitly unknown,
since vertex loading does not prove visible mesh contribution.

Copied-package acceptance exposed a reconnect race: polling an existing native
operation after disconnect could autostart a replacement app. Explicitly
session-bound requests now fail disconnected instead. A regression test covers
that admission path. Final full suite: **171 passed, 0 failed, 0 skipped**.
Copied-package runtime/MCP/plugin/icon/named-signal acceptance passes, including
credential refresh and no mutation replay. Generic overlay UI acceptance passes.
The exact installed helper passes the real private 80-VI recorder and full paged
result/file agreement; its harness now waits for the explicitly launched,
ROM-identity-checked app instead of racing an automatic launch during startup.
Deployed-plugin/installed-native UI acceptance passes the real Kirby checks.
App-level source build provenance and the external plugin artifact are distinct;
see `artifacts/kirby-skeleton-migration/deployment.json` for the handoff receipt.

This completes the skeleton-plugin migration, not the remaining whole-plan work
on verified task contribution/yield-resume, broader stress/cost reporting or an
independent main-event-loop watchdog.

## Independent stall watchdog

Agent-service startup now starts a separate Node process. It receives a bounded
250-ms heartbeat and writes one private instance-bound health snapshot; its own
monotonic clock continues during blocked/stopped main execution. Fresh fixed,
named and automatic local clients can read the snapshot before a main socket
handshake. Healthy main responses remain live; a missing response falls back in
500 ms, and two seconds without heartbeat progress is labeled unresponsive.
Observer staleness and parent IPC disconnection are separate from main status;
no modal dialog or root cause is inferred. Oversized/failed snapshot collection
cannot suppress the heartbeat. A two-file 64-KiB transition journal survives an
abrupt parent exit. Normal shutdown revokes the observer and removes its sidecar.

Focused validation exercises Atomics.wait in a real parent Node loop, OS-stopped
Electron main, a freshly started MCP client, recovery, SIGKILL, file permissions,
instance mismatch, oversized state, journal transitions and cleanup. This closes
the independently responsive main-stall reporting gap from A.

Watchdog acceptance: **175 tests passed, 0 failures, 0 skips**, including the
real stopped-Electron/fresh-MCP case and normal recovery/cleanup. This independent
slice is committed before graphics provenance work continues.
