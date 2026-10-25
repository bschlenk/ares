# Scripting reliability and frame-exact plugin plan

Written 2026-10-24 from `~/Developer/kirby/docs/ares-electron-feedback.md`,
`scripts/record/kirby-record.ts`, the skeleton plugin, and the current fork.
Planning only: this document does not implement fixes or claim new acceptance.
It supersedes no historical acceptance record; the new reproductions expose gaps
that the earlier tests did not cover.

## Findings to preserve during implementation

- `cli.ts` retries `stale_epoch` indefinitely using `client.identity`.
  `LocalServiceClient` updates that identity only on successful replies. The
  existing CLI test never loads a state inside its script; the N64 state-load
  integration used MCP, whose status path explicitly refreshes identity.
- `ToolRegistry.call` already calls `inputSchema.parse(args)`. Do not add another
  parser blindly. Reproduce the reported default failures against the installed
  helper, its packaged registry/cancellation wrapper, and the checkout. Zod's
  JSON-schema conversion defaults to output mode, which can also explain fields
  with defaults appearing in `required`. Inspect the actual adapter export.
- `script.read` checks the native connection owner and returns `invalid_request`
  for an owner mismatch. Each `ares call` is a fresh connection; CLI exit also
  releases its connection. Therefore fetching a prior CLI job is a lifecycle
  problem even with explicit parameters. `operation_id: 0` is not inherently an
  encoder error: the current encoder and native code accept it.
- The installed `ares` helper sends only call/tools/run to the CLI. Help and
  unknown flags go to the GUI executable. Direct helper launch inherits stdio;
  native stderr is forwarded with an unguarded `process.stderr.write`. Automatic
  service launch already detaches and redirects stderr, but unlinks its temporary
  log directory, so that path is not durable diagnostics.
- Both `input(state)` and `input.set(port, state, stick)` exist today.
- Overlay mode is explicitly rejected by the registry. Observation is one
  runtime, every fourth VI, followed by a 100 ms renderer polling timer. Removing
  just the native modulo-four throttle will not make the overlay frame-exact.
- Existing command capture commits on VI-origin changes and framebuffer capture
  has epoch/frame/sequence/origin concepts. Those are useful foundations, but a
  command capture's committed frame is not proof of the frame the renderer
  actually displayed. Do not label “latest” state as “presented” without linkage.

## Delivery order and coverage

| Slice | Deliverable | Feedback covered | Dependencies |
| --- | --- | --- | --- |
| A | Launch safety, durable app logs and health | Bugs 2, 6 | None |
| B | CLI job lifecycle, defaults, result retrieval and input docs | Bugs 1, 3, 4, 5 | A aids diagnosis; otherwise independent |
| C | Shared frame identity and immutable boundary samples | Per-frame callbacks; paged readMany | None; foundational for D–F |
| D | Supported overlay surface and SDK frame delivery | Overlay; per-frame callbacks | C; basic layout work can start earlier |
| E | Read-only peripherals and graphics-task provenance | VI_ORIGIN; last presented graphics task | C; initial peripheral access independent |
| F | Verified per-draw matrix capture | Matrices as the RSP consumed them | C, E and microcode fixtures |
| G | User-authorized clipboard and file exports | Clipboard/file output | A; reuse artifact infrastructure; independent of F |
| H | Kirby and packaged acceptance, normal app replacement | All items | Applicable slices above |

Ship A/B first to restore a reliable recording/debugging workflow. Do not delay
those fixes for graphics work. Ship useful overlays and boundary snapshots before
requiring matrix capture. Sparse JIT optimization remains issue #15 and is not a
prerequisite for this feedback.

## A. Launch safety and observable app errors

1. Give the installed helper an explicit dispatch contract: no arguments launches
   the GUI; `--help`, `-h`, and subcommand help print usage and exit successfully
   without discovery/autostart. Unknown commands/options produce usage on stderr
   and a nonzero exit. Preserve documented GUI launch options deliberately;
   inspect existing consumers before deciding whether arbitrary positional ROM
   paths remain valid. Do not route every unrecognized argument into Electron.
2. Make GUI launch independent of terminal lifetime, including the no-argument
   helper path. Detach the GUI and direct diagnostics to a profile-owned log
   sink. Preserve inherited stdout for CLI JSON and MCP stdio protocol traffic;
   those transports must not use the GUI detachment/logging policy.
3. Install safe diagnostic handling before native startup or other error-prone
   initialization. Handle stdout/stderr stream failures without recursive logging.
   An expected EPIPE must not invoke Electron's default error dialog. Capture
   uncaught exceptions, unhandled rejections, native exits and renderer failures
   with stacks and correlation metadata. Unexpected fatal main exceptions should
   log and exit/restart cleanly, not continue arbitrary damaged state or block
   the request loop behind a modal dialog.
4. Introduce one bounded app-log service, used by main and native stderr capture,
   with timestamp, severity, source, app instance, native session/generation,
   sequence/cursor and truncation/loss counts. Bound individual messages, pending
   writes and in-memory history; throttle repetitive messages. Persist with
   rotation/retention and private permissions under the profile's logs directory.
   Never include service credentials or unrestricted file contents in diagnostics.
5. Add `app_logs` through the shared registry and management endpoint, so it works
   without a loaded ROM or responsive native host. Support source filtering,
   bounded pages and generation-aware cursors; expose how to find the log files
   after process exit. Retain `plugin_logs` for its existing contract.
6. Add a cheap app-level health call distinct from native `emu_status`: native
   connection state, last heartbeat/response, last fatal/recoverable error and
   known user-interaction waits. Include component/reason/request identity in
   timeout errors when known. A genuinely stalled main event loop cannot answer
   its own health request: report cached observations as stale/unresponsive, not
   a fabricated current `blocked: error_dialog`. An external heartbeat/watchdog
   is a separate requirement if independently responsive stall reporting is needed.

Acceptance: close a launching shell/pipe, provoke native stderr and main logging,
and verify no modal exception, the app remains serviceable, and logs are readable
from a fresh CLI/MCP client. Inject a fatal error and verify durable stack capture
and a controlled failure. Test rotation, oversized/fragmented native lines,
slow disk, full queues, stale log cursors, no-ROM health and native timeouts.

## B. CLI epochs, defaults and completed results

### Script-owned epoch transitions

Extract one job-waiting helper for CLI and MCP instead of maintaining divergent
poll loops. Bind it to app instance, ROM session and job ID. A stale-epoch read
must perform an explicit successful status/job refresh before another poll;
re-reading the same cached identity is not progress. Accept a new epoch only when
it belongs to the same script's intentional load lineage, not merely because the
ROM session string matches. Expose that lineage/job generation from the service
if needed. External reset/load, ROM replacement, disconnect and job eviction must
terminate with a structured reason. Never replay a mutating request.

Use an overall polling deadline, bounded read retries, SIGINT cancellation of only
the owned job, and a bounded result-publication wait. Result pages and cancellation
must use the refreshed validated job identity too. Distinguish script completion
from `script_output` pending/committed/failed so callers do not mistake runtime
completion for successful file output.

### Defaults and packaged provenance

Reproduce bare `ares call script_result`, `operation_status --operation_id ID`,
JSON-file arguments and named flags through the actual installed helper. Compare
helper destination, app build/commit, CLI bundle, MCP adapter and schema inventory.
Provide a build/version diagnostic so agents can identify mixed or stale installs.

Keep a single Zod input parse/default application path for every transport, and
verify the cancellation wrapper does not bypass or change its arguments. Export
input JSON schemas consistently in CLI and MCP; use the installed Zod input-mode
conversion where appropriate, while verifying how the MCP SDK exports schemas.
Defaulted inputs should not become mandatory user flags. Preserve real required
fields, refinements and strict unknown-field validation; update parity fixtures
only for intentional schema changes, not to bless unexplained drift.

### Result lifetime and the meaning of zero

Separate active execution ownership from finished result retention. Keep active
jobs connection/plugin scoped and revoke their input/hooks on disconnect. Publish
completed values into a bounded immutable result store in main, with opaque job
identity, app/ROM/session lineage, byte/hash metadata, TTL, count/byte quotas and
explicit expiry/release errors. Create a bounded native completion-transfer ticket atomically at completion,
independent of the revoked execution lease, so main can finish draining even if
the originating CLI exits. A new run must not overwrite an unacknowledged result;
use explicit backpressure/expiry rather than an unbounded queue. Acknowledge and
release that ticket after main stores the immutable result. Do not make captures publicly readable or let a result-read
credential cancel or mutate someone else's running job.

Return a durable result handle from `run_script` and include it in completion
metadata. A fresh authorized local CLI must be able to fetch that completed job
without reviving its execution lease. Define `operation_id: 0` as the latest
completed result in the explicitly selected app/session scope; return a stable
`no_script_result` or ambiguity error when there is no unique eligible result.
Prefer the explicit opaque handle for reproducible automation. Observer latest
values remain a separate stream, not candidates for “latest completed script”.
Document result eviction and reconnect behavior, and preserve existing explicit
operation-ID reads during migration where unambiguous.

### Input documentation

Document the callable form and `.set` form with identical whole-port replacement,
stick, port, latch and cleanup semantics. Use one canonical style in examples and
provide a native recording example exercising both forms. This is a documentation
and compatibility task, not a reason to remove either working spelling.

Acceptance: run the actual Kirby recorder with its own state load, multiple owned
loads and output file; the CLI exits with complete JSON. Test external reset/load,
SIGINT, concurrent clients, same-session epoch races and result eviction. Start
and finish one CLI process, then retrieve its result from a second process with
zero/default and explicit handles. Confirm defaults and errors match in packaged
CLI, MCP and the checkout, with no app launch for help or invalid syntax.

## C. Boundary identity, read budgets and immutable larger samples

Define a shared frame reference before adding frame-exact API names: app/native
session, epoch, VI counter, boundary kind, VI-origin commit identity, video packet
sequence and renderer presentation acknowledgement where available. Origin address
alone is not identity: double/triple buffers reuse addresses. Expose unavailable
or unmatched provenance explicitly, including non-N64 limitations.

Keep existing `readMany` limits and atomic semantics for compatibility. Add an
immutable native sample handle for larger explicit ranges or project-script
results, captured entirely at one designated boundary. Page that frozen handle
without rereading live memory. Bound range count, total bytes, read/copy time,
concurrent handles, retained frames, TTL and per-plugin/global budgets; expose
truncation, overflow and stale/expired sample errors. Do not freeze all RAM or
raise request-line/message limits to satisfy a busy scene. If memory is sampled
across multiple boundaries, report that rather than calling it atomic.

Acceptance: mutate source RAM between page reads and verify the snapshot remains
identical; test more than 64 ranges / 64 KiB, dirty CPU cache versus RDRAM views,
reset/load invalidation, slow readers and budget exhaustion without pausing play.

## D. Overlay surface and per-frame delivery

Provide a scoped SDK overlay registration backed by a host-owned canvas/layer,
with framebuffer logical coordinates and a documented transform to displayed
pixels. Handle aspect correction, crop, letterboxing, scale modes, device-pixel
ratio, resize and detached/floating viewport windows. Kirby's 320×240 logical
picture versus a 640×240 presented image is an explicit acceptance case. Plugins
must not query `#screen` or append unrestricted body canvases.

Keep overlay registration/lifecycle separate from raw DOM access and from a
manifest mode switch. Enable `mode: overlay` only once activation, ownership,
multiple overlays, ordering, visibility, input pass-through and disposal are
supported. Default to noninteractive overlays; any pointer interaction is explicit.

Build `scope.onFrame` on the boundary sample stream, not renderer-side live reads.
Its callback receives frame identity and a frozen sample/result reference. A
renderer callback running later cannot retroactively read that boundary's RAM.
Reuse the native observer scheduler with selectable VI/VI-origin boundaries and
sampling every boundary, bounded multiple observers, aggregate runtime/copy
budgets and per-observer quotas. Use explicit observer handles on read/stop,
including multiple observers from one plugin, so disposing one cannot stop
another. Define fair scheduling and isolate an offending callback rather than
starving all other observers. Retain the existing low-rate observation mode
as an option. Push or signal available samples instead of polling at 100 ms.

Match overlay data to the frame actually presented. Under slow consumers retain
only a bounded/latest matching value, report skipped sample/presentation counts,
and hide or mark stale data rather than painting it onto an unrelated frame.
Do not block emulation waiting for rendering or asynchronous consumer callbacks.
Lossless frame sequences use a separate bounded recording/export path with
explicit overflow, not a promise that a live UI renders every emulated VI.

Keep the overlay alive and correctly aligned across Settings and workspace
changes; define DOM-modal z-order explicitly. Native OS dialogs cannot simply
be painted through by a renderer canvas. Include the supported overlay composition
in `ui_screenshot` for both main and floating viewport windows, using the same
frame reference as the displayed image. Game-framebuffer screenshots retain their
existing separate semantics.

Acceptance: draw known points over a generated picture and verify composed
screenshots at resize/DPI/aspect/scale changes and in a floating viewport. Open
Settings, reload/unload the plugin, reset the ROM and run an exclusive script.
Verify sample/presentation identity and correct stale/drop behavior at 30 fps,
60 VIs/s, repeated origins, slow callbacks and multiple observers.

## E. Graphics task and peripheral provenance

First expose `n64.peripheral.registers` through the plugin bridge under the
appropriate read-only capability, with epoch/frame identity. Do not grant blanket
N64 method access. Make the boundary sample/observer API able to read VI_ORIGIN
without a transport round trip or speculative whole-memory scan.

Then add a shared read-only graphics-task service (proposed
`n64.rsp.lastTask`) using actual task submission/dispatch boundaries. Capture a
copy of the task descriptor, `data_ptr`/size, task ID, microcode identity and
relevant render-target transitions when consumed, not a hard-coded OSTask address
or a later read of reused RAM. Handle yield/resume, nested lists and task reuse.

Relate task IDs and render targets to origin commits and displayed-frame IDs.
Return multiple contributing tasks or unknown/ambiguous mappings when necessary;
“last graphics task” is not guaranteed to be the one on screen. Reuse existing
RSP/RDP capture hooks while keeping provenance metadata available without forcing
full command recording or interpreter mode. Expose executor/capture cost when a
particular supported path requires it.

Acceptance: synthetic task descriptors in alternating/triple buffers, repeated
origins, late writes, multiple tasks per frame, yield/resume and reset. Compare
against captured dispatch and presented pixels; test both supported executors
before claiming general support.

## F. Matrices consumed by the RSP

Implement as a separately gated F3DEX2 capture capability, not a generic promise
for arbitrary microcode. Capture consumed command/matrix data when the RSP reads
it, then record modelview stack push/load/multiply/pop, projection and viewport
state attached to draw/task/frame identity. Preserve raw fixed-point bytes and
state provenance alongside decoded values. Verify multiplication order,
rounding, segmented addresses and viewport conventions against the supported
microcode. Data reread from a rewritten display list after submission is not
“as the RSP saw it”.

Investigate whether the existing dispatch hook can observe all needed operands
at the correct point. If actual post-operation state cannot be proven, expose
explicitly labeled consumed-command data first; do not present a CPU-side
reconstruction as an authoritative RSP matrix stack. Bound draws, matrices,
retained captures and export bytes, with paging and explicit overflow. Unsupported
microcode or partial capture must produce a capability/error result.

Acceptance: generated F3DEX2 lists with nested lists, segmented pointers, stack
operations, projection/viewport changes, just-in-time updates, rewrites after
consumption and repeated draws. Compare captured transforms with known vertices
and pixels; validate interpreter/JIT parity where supported. Only then replace
the Kirby plugin's list interpretation with this service.

## G. Scoped clipboard and file export

Add host-mediated SDK clipboard text and file-export APIs using explicit plugin
capabilities and user gestures. A save dialog grants a single destination or
bounded recording ticket, not general filesystem access or arbitrary paths from
a plugin. Revalidate the plugin lease, ROM session and ticket after the dialog
and before publishing; cancellation/unload/reset must not write a stale export.
Reuse atomic artifact writing, no-overwrite/overwrite choices and integrity
metadata. Keep authorization dialogs intentional and distinguish them from fatal
error modals addressed in A.

For camera-solver sequences, stream frozen frame records through a bounded export
job (for example versioned JSONL plus a manifest), with ordering, frame/task IDs,
loss/overflow metadata, byte/frame/time limits and cancellation. Do not buffer an
unbounded sequence in renderer memory or silently describe coalesced live updates
as a complete recording. Expose job status/artifacts for CLI/MCP inspection.

Acceptance: copy frame JSON, save one frame and a bounded sequence, cancel the
picker, deny capabilities, reset/unload during the picker or write, hit output
limits, and handle existing destinations without accidental replacement.

## H. Integrated acceptance and handoff

Use generated CPU/ROM/graphics fixtures for reproducible CI, then the real Kirby
recording and skeleton overlay. Include installed helper → packaged CLI → main →
native tests: the earlier coverage tested these pieces separately and missed the
state-load CLI loop and cross-process result lifetime. Compare deployed build IDs
and shared schema inventories in the test report.

Publish acceptance per slice with observed frame/epoch/task identities, limits,
wall/native cost and transport counts. Test no-ROM and native-failure diagnostics,
not only healthy emulation. Rebuild and replace `build_macos/Ares.app` at handoff,
refresh Ares-managed helpers as needed, and verify the exact installed commands
another agent will use. Keep the existing app path; do not introduce another
`scripting` app directory. Record build provenance and remaining capability gaps.
