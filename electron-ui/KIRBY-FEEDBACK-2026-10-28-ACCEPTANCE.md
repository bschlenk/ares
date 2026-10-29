# October 28 implementation and acceptance

Follow-up: original item 5 is now implemented and verified. See
[sequential video acceptance](VIDEO-SEGMENTS-ACCEPTANCE.md). The deferral below
describes the earlier build and is superseded by that follow-up.

Implementation branch: `kirby-feedback-2026-10-28`. Product source tested at
`1fb001ebd2abc7e3f2d76a08ad2b641535695531`; later documentation commits do not
change that product build. The plan's original request numbers are preserved here.

## Actual builds and evidence

The final macOS package is
`electron-ui/artifacts/feedback-2026-10-28-verified/Ares.app`.
Its actual `build_info` is commit `1fb001ebd2abc7e3f2d76a08ad2b641535695531`,
build ID `e7fe1c6cec866014`, schema ID
`a1751c576e5d9bf8ed7d88acd181977d2d5c5a4315bd93b26750e8d7071b298c`,
built at `2026-10-28T19:57:04.570Z`.

Both the final package above and an earlier packaged run at commit `e95c8e43325bd5525b85fcd0f42a2601dc726bff`,
build ID `7324fab24f3ec86f`, passed 1,800 continuous Kirby gameplay frames,
plus 10 settling frames: **1,810 ordered framebuffer frames, 320×237,
411,811,200 raw bytes, 411,854,872 AVI bytes**. Script JSON retained all 1,800
statue samples. The input workload used the private `rec2` state, both
Stone+Cutter power writes, and twelve four-frame B taps spaced 120 frames apart.
It does not claim to reproduce every field, enemy removal or visual comparison
of Kirby's full recorder. Source ROM/state hashes were checked unchanged.
Final native SHA-256 is `b7ebc8ffca4f7019deab73a9d3f76e77458e2dfbaab98a21ee829920238bd4d4`.
Actual JSON, video metadata and stderr are under the package's sibling
`continuous/` directory, outside version control.

The isolated native recording fixture independently captures and reads back
1,800 ordered 320×237 frames (409,536,000 bytes), checks byte-cap prefixes,
dimension changes, state-load rebase, source overrides and reset cleanup. A
real `RLIMIT_FSIZE` short write verifies that only complete readable frames
survive a disk failure. Observed peak fixture RSS was about 2.5–3.2 MiB on
macOS; this is a measurement for the fixture, not a universal app memory bound.
Producer storage is bounded to 16 MiB, plus one converted incoming frame.

## Automated checks

- `npm test --prefix electron-ui`: 228 tests, 227 passed, one private-ROM
  profile case skipped, zero failures. Log: `/tmp/ares-kirby-final-serial.log`.
  This suite passed before the final narrowly scoped ownership/start changes;
  those changes have focused regressions below.
- Real N64 batch/MCP regression: required-state preparation, two RAM writes,
  exact prepared-state snapshot, script epoch lineage, return/status while
  armed, durable handoff, and cancellation. Also 5,000 awaited reads followed
  by 200 VI waits: 6,403 total native reads, 21,407 read bytes. Passed.
- Scheduler queue fixture and live negative cases: a self-replenishing
  promise-only queue still fails at 4,096 jobs across scheduling yields;
  successful host progress renews its budget. Script deadlines remain hard.
- CLI/session/matrix focused reruns: passed after fixing capability inventory
  and independently reporting partial video warnings. CLI file-exists video
  failure preserves stdout JSON and exits successfully when the script succeeds.
- Prepared-job unit checks: load/write/snapshot/arm order, durable ownership,
  automatic manifest/input publication, retained input after save failure,
  explicit retry, and refusing an existing recording before mutation. Passed.
- Physical-start gate fixture: neutral gating, old-hold release, short-press
  retention, wrong-port/unmapped input rejection, drift threshold and transition
  delivery through native latches. Passed. These are synthetic checks.
- Native demonstration regression: active foreign-owner protection, idle cancel,
  friendly derived button names, exact raw replay, explicit partial export and
  rejecting partial imports, duplicate starts, CLI leases. Passed.
- Electron banner test: visible prompt and actual Start/Stop/Cancel native
  transitions passed. Screenshot: `/tmp/ares-demonstration-preview.png`.
- Copied macOS package acceptance passed at both `7324fab24f3ec86f` and the final
  build `e7fe1c6cec866014`: real MCP
  stdio, native loader, plugin scaffold/build/add/enable/open/reload/commands,
  and checkout-read-denied execution. See `artifacts/package-mcp.json` and
  `/tmp/ares-kirby-verified-package-acceptance.log`.
- Live profile acceptance: holder PID, start time, executable/service directory,
  existence checks, duplicate/alias refusal, independent profiles and crash
  recovery passed. All launcher profiles and IPC paths in these checks are
  temporary; owned processes are terminated and awaited.

Final continuous-package evidence: `artifacts/feedback-2026-10-28-verified/continuous/acceptance.json`.

An earlier concurrent validation run encountered native/render timeouts and a
packaged plugin preflight timeout. These passed on isolated reruns. A capability
inventory mismatch and missing partial-video CLI warning were real failures and
were fixed. Automatic approval review once timed out on the Electron banner
launch; its single retry was approved and passed. No unrelated app was contacted
or killed to resolve a profile lock.

## Request disposition

| Original item | Disposition and practical limits |
| --- | --- |
| 1 | Diagnostics and tested launcher isolation verified. Metadata names the holder and checks process/service-directory existence without probing or killing it. PID metadata is diagnostic evidence, not authority to take a lock. The tests exercised startup preflight failure and profile crash/recovery; they do not prove every possible OS failure. |
| 2 | Verified: CLI exceptions carry a code, readable message and nested details as objects, including thrown scripts and missing paths; script failures retain exit status 1. |
| 3 | Verified: unknown options name accepted parameters; `run_frames --count` points to `--n`. Structured Zod issues remain available. |
| 4 | Source choice implemented on both public recording paths and verified through schemas/native overrides and packaged framebuffer capture. Defaults, dimensions, timing and presented-frame limitations are documented. |
| 5 | Intentionally deferred after reassessment. One script video still rebases on owned state loads. Explicit segments need output reservation and lifecycle work; they are not required for continuous capture. |
| 6 | Original script-polling failure verified fixed. `input.demonstration.prepare` uses shared preparation and a durable owner; legacy request/status/return also remains supported. Inner frame advancement while armed raises `demonstration_armed` as a script error. Physical-human handoff/replay remains a manual gate. |
| 7 | Verified: inactive cancellation is idempotent, active-owner checks remain enforced, and exported/read events include additive lowercase `held` names matching controller_set. Raw words remain authoritative; version-1 import ignores derived names. |
| 8 | Continuous native and private packaged workloads verified beyond 1,500 frames. Capture is disk-backed, with explicit queue/disk/byte/time failures and readable prefixes. Video errors do not destroy script JSON. Native no-audio AVI is still uncompressed; disk space is bounded, not free. |
| 9 | Shared plugin request API and host file pickers implemented with session.control, memory.write, files.export and a user gesture. Automatic Stop publication and retry are implemented. The complete plugin picker → physical keyboard/gamepad → Stop → prepared-state replay scenario is **not manually verified**. Keep this request open for that acceptance. |
| 10 | 5,000-read and repeated-frame workloads and the promise-storm negative case verified. The private continuous workload also completed 1,800 sequential VI waits. This does not claim every private particle-list workload has been rerun. |

## Manual acceptance still required

A person must verify both keyboard and gamepad input-start, held-input neutral
gating, a short initiating press, intentional neutral Start, play, human Stop,
automatic saved bundle and restoring/replaying its prepared state. Repeat through
a plugin command with the two authorized power writes and video off/on. Verify
consumed text-field input and unmapped controls do not start recording. Physical
input maps to virtual port one in this frontend; other selected ports expose
explicit Start/MCP start only. No universal deterministic replay guarantee is made.

The final product code and automated work are implemented. Physical-controller
acceptance and optional segmentation are explicitly outstanding; they are not
silently recorded as completed requests.

The source feedback document in the Kirby repository was reconciled after these
checks: original items 1, 2, 3, 4, 6, 7, 8 and 10 were moved into the completion
summary with build/evidence references. Original item 5 and the unverified
physical/plugin portion of item 9 remain open. That external documentation
change is intentionally not committed from the ares repository.
