# October 25 feedback implementation

Branch: `kirby-feedback-2026-10-25`, based on `fce7b00ad`.
The pre-existing edits to `KIRBY-FEEDBACK-TRIAGE.md` and untracked
`KIRBY-FEEDBACK-2026-10-25-TRIAGE.md` are preserved separately.

## Delivered contracts

- Recording 1: CLI entry/state/artifact paths resolve against caller cwd. The
  explicit file base also resolves relative script host requests without changing
  user argument strings. Unexpected main/service exceptions return their message
  and write stacks into bounded app logs.
- Recording 5: successful CLI consumption acknowledges results, leaving them
  readable until expiry or admission pressure. `--retain-result` preserves the
  ordinary pinned retention contract. Unconsumed MCP results remain pinned.
  Failed/cancelled CLI runs discard even pending transfers unless explicitly retained. `script_results`
  lists handles, consumed state, expiry, pending reservations and admission limits.
- Recording 3: authenticated clients can explicitly create/use/list/release one
  of eight owner leases lasting 1–600 seconds. `ARES_OWNER_LEASE` selects one
  across independent CLI processes. Expiry/release revokes native ownership;
  ordinary disconnect cleanup remains. CLI refuses known persistent starts and
  handle-producing memory operations without a lease.
- Recording 2+4: `ares run --video PATH` / `run_script.video_path` records exactly
  one framebuffer image per advanced native VI, independently of presentation
  credits and the eight-file/64-host-request script limits. Native storage is
  bounded to 36,000 frames / 256 MiB / script deadline. An owned state load drops
  pre-load pictures and rebases the interval. Failed/incomplete/cancelled capture
  never publishes an AVI. Publication is atomic and refuses existing files.
- Recording 6: local hello negotiates a schema digest before execution. Missing
  or changed schemas return `adapter_stale`, app/build/schema details and restart
  instructions, including to legacy adapters. Running processes pin their build
  metadata across on-disk rebuilds. Same-schema builds can reconnect without any
  mutation retry. Adapter-only `build_info` stays available.
- Issue #18: a shared native demonstration service arms separately from recording,
  exposes a visible nonmodal human Start/Stop/Cancel interaction, records actual
  standard N64 Gamepad SI-read wire values and replays exact relative VI/latch
  sequences with port ownership. Human-only and merged sources are explicit.
  Export/import use a bounded versioned JSON clip with ROM/session/frame/rate,
  completeness/overflow, decoded buttons/axes and optional starting-state hash/path.
  A mid-frame stop waits for the next VI; replay can begin from a restored
  mid-frame state. Divergence/cancel/takeover/reset/load/deadline release playback
  inputs. MCP, CLI and native JS expose the shared operations.

Usage, examples and exact limits are in [mcp/README.md](mcp/README.md).
The already implemented plugin features and their microcode/renderer-loss/
candidate-only pixel-attribution limits remain as specified by the triage.
This work makes no stronger arbitrary-game task-to-pixel attribution claim.

## Fresh verification

- `npm test`: 185 tests, 184 passed, one optional private-ROM profile test skipped.
  Final follow-up changes were checked with the targeted suites below.
- `feedback-reliability`, `local-endpoint`, `n64-live`: 21 passed; includes result
  retention/discard, schema refusal, app restart/nonreplay and native fixture checks.
- `demonstration-live`, `feedback-reliability`, `schema-parity`, `script-cli-live`:
  14 passed after the boundary-aware stop and diagnostics changes.
- Final `input-clips`, `demonstration-live`, `tool-registry`,
  `feedback-reliability`, `schema-parity`: 15 passed, including starting-state
  association invalidation on native replacement and offline diagnostics with an
  expired owner-lease environment.
- `batch-live`: real generated N64 VI fixture passed a cross-directory CLI script
  with relative entry/args/state/PNG/video paths, two owned state loads and exactly
  200 post-load AVI frames. Existing batch/state/observer behavior also passed.
- `ares-electron-cpu-fixture`: actual Gamepad reads reach the SI hook; shaped axes,
  opposite-button cancellation and repeated same-VI reads replay bit-for-bit.
  Tests also cover replay divergence/input release, mid-frame starts/stops, frame
  limits, 200 video frames in pixel order, rebasing, duplicate suppression,
  cancellation, byte/time bounds and frame gaps.
- `demonstration-live`: exact synthetic button/axis traces, complete clip export/
  import/replay, foreign-owner rejection/cancel isolation, human-only injection rejection, frame/
  time limits, reset invalidation, independent CLI processes and native JS file
  capability wrappers.
- `script-cli-live`: 20 sequential successful runs, 20 failures, fresh-process
  retrieval, missing/broken source diagnostics, 200-frame AVI, lease expiry,
  SIGINT cleanup, abandoned native recording expiry and no publication/overwrite for failed/cancelled video exports.
- `electron tests/electron-demonstration.mjs`: isolated Electron human prompt and
  Start/Stop/Cancel controls passed; screenshot inspected at
  `/tmp/ares-demonstration-preview.png`.
- `legacy-adapter-live.cjs`: the actual historical adapter source at `fce7b00ad`
  was compiled in `/tmp`, kept alive before the new endpoint started, and then
  rejected with actionable build/schema diagnostics before executing any request.
  Adapter-only diagnostics continued working; a current adapter connected.
  The old provenance JSON was a fixture label identifying that source commit.

Native targets rebuilt: `ares-electron-host`, `ares-electron-cpu-fixture`.
Public MCP schema comparison and native capability inventory were updated.

## Remaining manual gates

Physical keyboard and physical gamepad demonstrations, followed by replay from
an associated game state, still need human acceptance. Synthetic traces and UI
button automation do not establish physical-device acceptance. No installed or
packaged build acceptance is claimed by this implementation pass. The native
clip currently supports one standard N64 Gamepad port; other controller types
need their own latch contracts.
