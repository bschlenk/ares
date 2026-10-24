# Native scripting and CLI implementation plan

Proposed 2026-10-23. Implementation and acceptance are recorded below.

Sources: [issue #12](https://github.com/bschlenk/ares/issues/12) and
`~/Developer/kirby/docs/ares-electron-feedback.md`.

## Recommendation

Embed a pinned QuickJS runtime in the native Electron host, on the emulation
thread. JavaScript reads and transforms native memory without a transport round
trip. Electron main handles source preparation and authorized file operations.
MCP, CLI and plugins invoke the same service. Keep game-specific addresses,
animation lookup tables and effect decoders in project scripts.

Deliver recordings first. Add non-stopping CPU hooks and live observation as
separate milestones; neither should block useful frame-driven scripts.

## Existing foundations and changes needed

- `native/execution-service.hpp`, `native/frame-service.hpp` and
  `services/batches.ts` already coordinate exclusive runs, VI boundaries,
  disconnect, deadlines and human takeover. Generalize the reservation machinery
  for scripts rather than nesting a script inside a public batch operation.
- `native/memory-service.hpp` and the N64 memory helpers already implement
  cache-aware CPU versus RDRAM access. Extract reusable internal functions;
  script bindings must bypass request serialization, not memory validation.
- `services/session-router.ts` brokers state/artifact work. Reuse that boundary
  for script state loads, saves, screenshots and result publication.
- `services/automatic-client.ts` already discovers and starts the app. The CLI
  should use it directly, without spawning an MCP server or speaking JSON-RPC.
- MCP definitions currently live in `mcp/server.ts` and `mcp/*-tools.ts`.
  Extract transport-independent tool descriptors and handlers before adding
  `ares call` / `ares tools`; do not maintain another tool inventory.
- `mcp/batch-tools.ts` explicitly adds `steps: r.result.results`; the underlying
  service already has only `results`. This confirms the duplicate-output report.
- `ares/n64/cpu/debug-control.hpp` documents interpreter selection for active
  per-instruction debugging. Fast sparse hooks require additional JIT work.

## Public API and compatibility

| Existing surface | Decision |
| --- | --- |
| Status, pause/resume, ROM/state loading, memory reads/writes, input, screenshots | Keep direct tools. They remain useful atomic actions and script implementation primitives. |
| `batch` | Keep as a declarative, bounded sequence. Prefer scripting for loops, custom decoding and large recordings. Share ownership/helpers; do not immediately rewrite batches as generated JS. |
| Memory recorder and capture status/read/release | Keep. Useful independently of JavaScript and for collecting raw samples during play. Add bulk export. |
| `trace_pc`, `trace_calls`, breakpoints/watchpoints | Keep. They have structured debugging contracts and immutable capture results. Reuse hook infrastructure where practical. |
| Game-specific future tools | Prefer project scripts. Do not add MCP tools for Kirby clips, effect spawns or screen shake. |
| Duplicate `batch.steps` output | Deprecate this alias explicitly; migrate consumers to `results`, then remove it. Offer an opt-in legacy result format during transition if consumers require it. |

Do not remove existing MCP commands in the first release. Revisit overlap after
real script usage; replacing a public tool requires demonstrated equivalent
semantics, a migration path and updated compatibility evidence. Tool-list size
alone is insufficient justification.

Proposed additions:

- MCP `run_script`: exactly one of path/source, JSON args, limits and optional
  output path. Start an operation and return its handle promptly; status/cancel
  work through the existing operation model. A bounded wait option can support
  short one-call recordings without holding the transport indefinitely.
- `ares run FILE --args scenario.json [--output result.json]`: await completion,
  emit the script's JSON value on stdout; progress/errors to stderr. Nonzero
  exit on failure/interruption, including structured stop metadata. SIGINT
  cancels only the CLI-owned operation. Never replay mutations after reconnect.
- `ares call TOOL --json params.json`; support named flags such as `--path`
  using the same schema. `ares tools` emits those same schemas. Preserve normal
  `ares` app launch and existing helper installation/discovery behavior.
- Plugin SDK `scripts.run(...)`, then `scripts.observe(...)` for live panels.
  Bind jobs to plugin lifetime, session identity and granted capabilities.

## Runtime contract

Use `export default async function ({args, emu, mem, input, frames, cpu, log})`.
Typed memory methods cover the requested integer/float types, bytes and hex,
with explicit CPU/RDRAM views and big-endian guest interpretation. Return copies,
never raw pointers or mutable borrowed buffers. Specify alignment/range errors,
64-bit register representation and JSON handling for nonfinite floats/BigInt.
Keep region-based access available for other systems; advertise N64-specific
capabilities instead of silently assuming all cores support them.

`frames(n)` suspends the script and advances exactly n native VIs. Drain bounded
promise jobs only at controlled safe points. Reads following resolution observe
the stopped boundary. Define zero-frame and partial-start behavior consistently
with `run_frames`. Reject concurrent/nested frame advances and unresolved
promises with no supported host work. Guest mutation stays on the emulation
thread; no nested emulator event loops or native request dispatch from callbacks.

Input replaces a whole port state and latches at the next VI/run start. Clean up
all script input and hooks on every exit. State loads intentionally update the
job epoch and invalidate old memory/capture handles. External reset, ROM changes,
pause, takeover or disconnect revoke the job. Earlier effects are retained;
cancellation is not rollback. Completion leaves execution paused.

Async state/file operations suspend the runtime while main performs bounded I/O;
every completion must revalidate ownership before resuming or publishing. Support
explicit input state paths and output destinations through host capabilities.
Scripts receive no general filesystem, network, process, Node, `std` or `os` APIs.

Bundle local ES module graphs in main with existing esbuild, optionally stripping
TypeScript and retaining source locations. Send source, not untrusted bytecode.
Restrict imports to the supplied project/plugin root; reject path/symlink escapes,
Node builtins and remote imports. Pin the module graph for the run. Bound source
bytes and import count; do not execute project build plugins or arbitrary config.

QuickJS provides memory/stack limits and an interrupt callback; the embedding
must also bound native functions and promise-job draining. See the
[official C API documentation](https://bellard.org/quickjs/quickjs.html).
Use total wall deadline, per-resumption JS budget, per-frame aggregate callback
budget, heap/stack limits, frame ceiling, log/event/result limits and bounded
native memory transfers. Check an atomic cancellation/deadline flag from the
interrupt callback so an infinite loop cannot prevent control-plane cancellation.
Serialization must also be interruptible/bounded. Prototype these failure cases
before promising UI responsiveness; this remains an in-process runtime.

Large results use chunked native transfer and main's atomic output writer, rather
than raising the control protocol's bounded message size. Expose truncation or
limit errors, job identity, frame/epoch, executor mode and committed artifacts.
Runtime destruction releases memory and hooks even after a thrown callback.

## Live panels and execution hooks

Live observation is a distinct read-only mode: a bounded callback at each VI
reads/decodes memory during ordinary play and publishes a throttled latest value.
It cannot advance frames, load states, mutate memory or own input. Reuse shared
decoder modules with recording scripts. Coalesce updates for slow panels rather
than blocking the emulator. Bound observer count and aggregate callback cost;
dispose on plugin unload/reset and suspend during exclusive runs initially.

Start `cpu.onExecute` with exact aligned address matching, synchronous read-only
callbacks and immutable pre-instruction registers. No awaiting, guest writes,
state loads or nested frame execution inside hooks. This records entry registers
at the effect function, which differs from tracing every call instruction.
Specify canonical addresses, delay-slot behavior, ordering and hook disposal.

First implementation may select the interpreter for the entire hook lifetime;
report that explicitly and restore configured execution afterward. Benchmark it
against `trace_calls`. Next, investigate sparse JIT instrumentation: matching
addresses must be reached through block entry, internal entries and delay slots,
with precise architectural register state. Invalidate/version old translations
when hooks change. A hooked-block fallback is an optimization to prove, not a
performance guarantee. Keep write watches optional until execute hooks work.

## Delivery sequence and acceptance

| Slice | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1 | Bulk capture export; compact batch results and alias migration | One export retrieves all samples/ranges in order; wrap/gaps explicit; existing captures and consumers remain valid. |
| 2 | Shared tool registry and `ares call` / `ares tools` | Same schemas/defaults/errors as MCP; discovery/autostart, packaged helper, stdout discipline and SIGINT verified. |
| 3 | QuickJS embedding and ownership prototype | Real native typed reads; infinite loop, promise storm, OOM, cancellation and teardown cannot strand ownership or input. |
| 4 | Frame-driven scripting, state/input/artifact bridge, modules/TS, MCP/CLI/plugin run | Kirby recording and clip resolver execute in one job, without per-field/frame IPC. |
| 5 | Read-only live observers | Recording and panel share decoder; human play stays responsive; reload/reset/slow consumer bounded. |
| 6 | Interpreter execute hooks, then sparse JIT investigation | Correct effect entry tuples; callback/overflow failures explicit; executor cost measured and restored. |

Slices 1 and 2 provide immediate value. Slice 3 can proceed independently of the
CLI refactor; 4 depends on its runtime contract. Slices 5 and 6 depend on 4 but
are separately releasable. Scripting is a multi-milestone project; do not couple
recording delivery to JIT optimization.

Use generated CPU/ROM fixtures for correctness and lifecycle tests, then the
Kirby project for manual end-to-end acceptance. Record 200 VIs with seven fields,
setup writes, input changes and clip mapping; compare against the existing
recorder with matched memory views/frame semantics. Repeat from the identical
state and compare output. Measure wall time, native read cost and transport call
count; target eliminating 1,400 capture-read calls, not an unmeasured speedup.

Test little-endian host versus big-endian guest, dirty cache and KSEG aliases,
reset during pending file work, concurrent owners, interruption at boundaries,
JSON/output limits, import escapes and packaged execution without checkout reads.
Test hooks with branches/delay slots, exceptions, repeated hits, hook replacement
and self-modifying code before claiming JIT correctness.

Deterministic output requires the same ROM/state, emulator configuration/build,
script/module graph and arguments, plus isolated inputs. Define virtual time and
a seeded random source, or disable ambient clock/random APIs. Wall deadlines are
safety bounds and can interrupt differently under load; do not claim identical
completion across deadline failures or different renderer/core configurations.
Include input/config/source hashes in recording metadata so results are comparable.

## Implementation record (2026-10-23)

Implemented slices 1–6, with the scoped interpreter-first hook implementation and
sparse-JIT investigation in `SCRIPTING-JIT-NOTES.md`. Runtime usage, limits,
compatibility migration and plugin contracts are in `mcp/README.md`.

- Capture export streams bounded native pages into an atomic JSON artifact;
  sequence wrap/drop metadata is preserved. Batch `steps` is now an explicit
  `legacy_results` opt-in.
- MCP and direct CLI use one registry. Existing tools remain available. The
  installed helper dispatches tools/call/run and preserves ordinary app launch.
- QuickJS 2026-06-04 is pinned to official commit
  `7d1c13c5d8f8c6b32893786ed35cdcebd88194d2`; no libc/std/os bindings are linked.
- Native jobs implement typed/region reads, bounded writes, VI waits, input,
  promise draining, cancellation, state/file capabilities and result paging.
  Main bundles confined modules/TS and handles state/artifact I/O. Script-owned
  loads rebase the job epoch and invalidate hooks/captures.
- Plugin run/observe APIs enforce capability and lifetime checks. Observation is
  initially one read-only runtime, with throttled latest-value publication and
  suspension during exclusive runs.
- Execute hooks match normalized physical instruction addresses, preserve
  pre-instruction/delay-slot registers, reject async/mutating callbacks, bound
  aggregate work, and restore the configured executor after disposal.

Fixture evidence includes 200 VIs × seven fields compared byte-for-byte with the
native recorder, actual entry/delay-slot tuples, ownership/executor restoration,
module escapes, loop/promise/OOM failure cleanup, state/artifact round trips,
CLI discovery/output/SIGINT and SDK compilation. The fixture measured 1,403
native reads (three initial typed reads plus 1,400 recording reads), 1,407 bytes,
and approximately 19.9 ms inside native read functions in one run. The recording
used no per-field memory transport requests. These are observations, not a
cross-core or Kirby speedup guarantee.

The private Kirby scenario was also run from its existing save state in an
isolated native instance using `examples/scripts/record.ts`: 200 rows × seven
fields, 10 settle VIs, right input for 40 rows then release. Repeating from the
same state produced identical rows. Observed wall times were 6.17 s initially
and 2.25 s warm, including state loading, bundling, execution and result transfer.
No private ROM/state/output is committed. The shared example decoder accepts
project-supplied clip ranges; no game addresses or lookup tables were added to
native tools.

Explicit initial limits: one observer; one retained native script result (use
`script_result.operation_id` to detect replacement); 4 MiB result; interpreter
for the entire execute-hook lifetime. Output publication has a separate
`script_output` pending/committed/failed state. Sparse JIT optimization and write
watches remain future work, as allowed by this plan.

Final verification: the complete service suite passed (132 passed, one skipped),
with an additional targeted pending-file ownership test passing. The direct CLI
integration passed discovery, JSON/stderr discipline, output files and SIGINT.
The copied signed macOS app passed its real MCP/plugin/CLI checks with checkout
reads denied. A 100-VI private Kirby hook-versus-trace comparison observed 44
entries in each mode and equivalent interpreter timings; details and limits are
in `SCRIPTING-JIT-NOTES.md`.

The standalone packaged TypeScript/native scripting check also passed with all
checkout reads denied (`PACKAGED_SCRIPT_OK`), using only the bundled Node,
esbuild, QuickJS, native host and copied runtime libraries.

Final hardening tests also cover escaped-log serialization limits, bounded UTF-8
errors, invalid host-work paths, plugin artifact-root pinning, and pure region
reads on Game Boy with explicit rejection of unsupported VI stepping. The rebuilt
CPU fixture completed with `CPU_DEBUG_FIXTURE_PASS`.

The renderer observer consumer also has a deterministic slow-callback test:
updates arriving while an asynchronous callback is pending are coalesced, then
the next delivery reads the newest native value. Callback failure stops delivery
and requests native observer cleanup.
