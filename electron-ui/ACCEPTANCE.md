# Fixture acceptance and remaining gates

From `electron-ui/`:

```sh
npm ci
npm run accept
```

This is the same command used by `.github/workflows/electron-macos.yml`. It
configures/builds the native host and fixtures, compiles three strict TS targets, runs the
fixture suite and native GB/NES/transport smoke, then actual Electron session,
MCP, plugin, hot-reload, agent-tool, profile settings, local plugin settings and startup-recovery checks. It also verifies
profile ownership/crash recovery, a running app surviving checkout rebuild, and
a fresh copied macOS app with checkout access denied. No private ROM, vendor BIOS,
reference checkout or live user profile is needed. The GBA BIOS/cartridge fixture
contains original instructions and verifies firmware loading, input and persisted
SRAM. Live settings checks verify native pixels/PCM, core options, persistence,
scoped plugin registration, reload/nonreplay and SDK type checking. Existing bounds, session/epoch ownership and nonreplay contracts remain.

Prerequisites: macOS arm64, Xcode command-line tools, CMake 3.28+, Node 24–26,
locked npm dependencies, and ffmpeg/ffprobe. CI pins Node via `.node-version`;
use that version for matching its toolchain. `brew install cmake ffmpeg` supplies
the additional macOS tools. Native dependencies download through CMake using
`deps.json` version/hash pins. No developer Node is needed by a copied app.

The lane selects the complete default core set and builds into
`build-electron-acceptance/`. `ARES_ACCEPT_BUILD_DIR` can select an existing
compatible Makefiles build; `ARES_ACCEPT_JOBS` selects 1–16 jobs. An absolute
`ARES_FFPROBE` can select ffprobe, with ffmpeg in the same directory. Other
inherited `ARES_*` variables are cleared so a caller's media, profile, enabled
plugins or service endpoint cannot become test inputs. Run one acceptance lane
per checkout at a time; normal `npm start` apps keep independent runtime snapshots.
The test suite is sequential and the fixture lane rejects failures and skips.

The smoke gate validates frame contents/progression, input echo, frame-credit
backpressure, pause/resume and clean shutdown. It records measured FPS without
requiring shared runners to sustain a particular throughput. For the original
50–70 FPS benchmark on a controlled machine, run
`ARES_SMOKE_PERFORMANCE=1 npm run smoke` (or the same flag with `npm run accept`).
The result records whether that additional performance gate was enabled;
performance is not reported as checked by the default correctness lane.

Each invocation keeps per-gate logs and a summary under
`artifacts/acceptance/run-*/`, plus `artifacts/acceptance/latest.json`. The summary
records platform/tool versions, checkout revision/dirty state, native build path,
gates and exclusions. The temporary packaged app is removed after its checks;
logs and concise package evidence remain. The command exits nonzero on a failed
command, timeout or missing result. Failed gates stop subsequent work.

The workflow uses the standard `macos-15` arm64 runner and read-only repository
permissions, runs on main pushes/PRs/manual dispatch, and uploads logs/JSON even after
failure. [Runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [Node version files](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)
are documented upstream. A configured workflow is not evidence of a hosted pass;
the execution log distinguishes local acceptance from actual GitHub runs.

## Separate checks and explicit dispositions

These dispositions implement the approved foundation triage. They do not rename
pending checks as passes and do not prevent implementing task 13.

| Check | Current disposition and evidence boundary | Follow-up / completion condition |
| --- | --- | --- |
| Physical keyboard takeover | Deferred manual acceptance. Generated-input/ownership checks pass, but cannot prove a physical keyboard/focus path. | During task 13 input acceptance, use an isolated profile and loaded N64 session; start a bounded external run/hold, press a physical mapped key in the focused canvas, and record host_input completion, cleared overrides, resumed play and key release. Repeat with lost/regained focus. |
| Physical gamepad takeover | Deferred manual acceptance. Native injection and virtual mapping tests do not establish a real browser gamepad/device path. | During task 13 input acceptance, repeat ownership takeover using a physical standard gamepad button and stick movement; record device/browser mapping, neutralization and disconnect behavior. Multiplayer/rumble remain outside the approved scope. |
| Audible output | Deferred listening acceptance. GB post-mix capture/WAV checks verify samples; they do not verify speakers or chosen output hardware. | During task 13 audio acceptance, play the original GB tone fixture through an isolated normal app with audio enabled; record actual audibility, mute/volume behavior, pause/resume and the output device. No listening pass is recorded. |
| Serializer rollback failure (task 8) | Deferred focused fault injection. Existing state rejection/load and transactional tests do not force both the attempted unserialize and backup restore to fail. | Before claiming rollback-failure recovery, add a test-only serializer seam/build that forces both failures, assert state_restore_failed plus paused/epoch/ownership behavior, then verify explicit recovery. Run when changing the state transaction/serializer; no public runtime fault switch is needed. |
| Private Kirby identity/power play | Optional user-supplied-media lane, excluded from fixture acceptance. Existing researched-revision evidence remains in the task 12 log; generated power/icon/matching unit checks still run. | Supply the verified ROM through ARES_PLUGIN_TEST_ROM for npm test and test:kirby. Keep original media/saves untouched. New revisions need separate researched evidence. |
| Cross-binary reference state tests | Optional external-input lane. Fixture serializer/layout checks run in acceptance; a vanished reference checkout is not a dependency. | Run test:state-reference with its documented reference executable/media inputs when compatibility claims change. |
| Soak, renderer heap, latency, other systems/peripherals | Deferred measurement and chosen support expansion. Loader availability is not universal game/peripheral acceptance. | Measure defined workloads before optimizing or expanding claims. Windows/Linux and public-release/notarization/update acceptance remain separate projects. |

Automated startup recovery is required and included in the fixture lane: persisted
infinite-loop code is never built/imported, renderer controls stay responsive,
CLI disable/reset works, reload remains safe and profile/plugin storage survives.
This differs from serializer rollback-failure fault injection above.

## GitHub Actions scheduling and reliability

The full macOS acceptance workflow runs on pull requests, pushes to `main`, and
manual dispatch. Feature branch pushes do not independently schedule a second
copy of the same PR run. The workflow remains enabled; `npm run accept` runs the
same checks locally. No test failures are suppressed or skipped.

The initial audit of PR #23 run `40249899219` and main run `40237317906` found the
same 17 fixture failures. Subsequent hosted reproduction `40255294053` exposed
the remaining native script error after the executable-path fixes. Corrections:

- Native test launchers and lock helpers honor `ARES_HOST`; CI builds in
  `build-electron-acceptance`, while local defaults use `build-electron-make`.
- Input takeover, demonstration completion, observer rejection and app startup
  tests poll the state they assert with bounded deadlines, rather than assuming
  a scheduler will finish work during a short fixed sleep.
- Script microtasks yield when a per-tick budget expires between jobs. The hard
  4,096-job limit persists across yields, and deadline/cancellation and single-job
  interrupt guards remain. A deterministic native fixture covers continuation
  after budget expiry and promise storms spanning many yields.
- Electron MCP acceptance lists the current public tools. Workspace acceptance
  checks visible default chrome while allowing the inactive demonstration banner.
- Named service shutdown waits for its claim helper to exit. Restart retries a
  briefly retained kernel lock only after the private authenticated record proves
  the old endpoint is gone; live/inconclusive records still fail closed. A native
  helper regression forces delayed lock release instead of relying on a race.
- Restart checks wait for the explicitly spawned instance through a non-launching
  client before asking the automatic MCP client to reconnect. This prevents the
  readiness query itself from launching a competing app. A private fallback
  profile and an assertion that it was never created guard against accidental
  use of a live/default user profile.
- Origin-observer tests preserve both frozen native captures in their payload,
  honoring the bounded latest-value notification transport rather than assuming
  its writer flushes between adjacent CPU instructions.
- Isolated development launches copy `tools/` along with the other TypeScript
  source directories, so their builds can resolve the tool registry.
- Smoke-test FPS is diagnostic in the correctness lane. Hosted run `40257051286`
  passed all 186 fixture tests but measured 39 FPS in smoke; that shared-runner
  throughput is not a deterministic correctness assertion. The original 50–70 FPS
  benchmark remains available through `ARES_SMOKE_PERFORMANCE=1`.
- Packaged settings acceptance uses the current direct helper executable, waits
  for native-session readiness, and uses a private service directory to avoid
  discovering unrelated apps running on the same machine.

The full sequential fixture suite has a 10-minute suite budget; individual test
and native operation deadlines remain unchanged. Hosted run `40259040052` reached
the final watchdog tests without assertion failures but was terminated by the
previous 3-minute suite timer. Gate summaries record the configured timeout, and
timeout errors are distinguished from child-process exit failures.

Per-gate logs and revision-tagged summaries remain the source of validation
results. A configured workflow alone is not evidence that a particular revision
passed on GitHub's hosted runner.
