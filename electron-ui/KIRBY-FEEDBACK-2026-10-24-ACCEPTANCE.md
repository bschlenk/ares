# Feedback plan acceptance — October 25, 2026

This is the current acceptance index for `KIRBY-FEEDBACK-2026-10-24-PLAN.md`.
The implementation log is chronological; earlier unfinished-work notes there
record the state at that time. Tests and limits below supersede those notes.

| Slice | Implemented contract | Evidence |
| --- | --- | --- |
| A | Explicit helper dispatch, detached GUI, private bounded durable logs, controlled fatal errors, independent main-stall health | `feedback-reliability.test.cjs`, `diagnostic-fatal.cjs`, `launch-live.cjs`, `watchdog.test.cjs`; real stopped Electron/fresh MCP, recovery, abrupt exit, slow/full disk, queue/rotation/cursor loss |
| B | Bounded owned epoch lineage, one default/schema path, immutable completed results and fresh-process retrieval, both input spellings | CLI/script/result regression tests and `feedback-packaged.cjs` real 80-VI Kirby recorder with state load, default/explicit fresh-process results, output-file agreement |
| C | Immutable boundary references and larger paged samples, CPU/RDRAM views and bounded handles | CPU/native memory fixtures, snapshot/scan live tests, origin observers; retained data survives later writes; stale/reset/quota errors explicit |
| D | Host-owned screen-sized DOM layer/DPR canvas, matched immutable observer samples, multiple owners, bounded loss and stale hiding | `electron-overlays.mjs`, `electron-kirby-skeleton.mjs`, observer/origin live tests; main/floating screenshots, resize/DPI/scale/Settings, exclusive scripts and disposal; deterministic 60-VI stream with independent 30-Hz and slow consumers |
| E | Frozen dispatch/IMEM/consumed target metadata, qualified yield/resume and candidate-only scanout association | `task-provenance.test.cjs`, `task-targets.test.cjs`, `yield-resume.test.cjs`; actual GPU pixels, triple/repeated buffers, same-VI overwrite, CPU rewrite, nested lists, task reuse/reset, interpreter/JIT |
| F | Full-profile-gated actual RSP matrix/vertex state and raw consumed bytes | `matrix-stack.test.cjs`, yield fixture, `kirby-matrix-live.cjs`; genuine CC0 microcode, segmented/nested lists, push/load/multiply/pop, rounding, source/stack rewrite, actual pixels, interpreter/JIT; migrated real Kirby skeleton |
| G | Gesture/capability scoped clipboard, atomic single-frame and bounded sequence exports | `plugin-exports.test.cjs`, `electron-exports.mjs`, deployed skeleton copy/save acceptance; lease/session revalidation, cancellation, limits and destination protection |
| H | Copied package, normal installed app/helper, build/schema provenance and private integration | `package-live.cjs`, `feedback-packaged.cjs`, deployed-plugin UI; final receipt appended after replacement |

## Cost and transport observations

`ARES_PLUGIN_TEST_ROM=... ARES_PLUGIN_TEST_STATE=... npm run test:feedback-cost`
uses separate temporary ROM/state/save/settings copies for each ordinary-play run.
All modes include always-on bounded task metadata. Each starts from the same save
and runs at least 120 VIs. There are no video credits or renderer in this native
measurement. Wall time includes pacing and control requests; these are observed
costs, not isolated CPU overhead, a renderer benchmark or a throughput guarantee.

Observed on this macOS arm64 checkout, before final package replacement:

| Mode | VIs | Wall ms | Requests | Response bytes | Pushed sample bytes | Descriptor/IMEM snapshot ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Metadata only | 120 | 2110.3 | 125 | 574889 | 0 | 1.536 |
| Task queries while running | 121 | 2127.9 | 218 | 997822 | 0 | 1.451 |
| Full RSP capture | 120 | 2122.2 | 126 | 576248 | 0 | 1.441 |
| Capture plus two observers | 120 | 2120.0 | 129 | 572502 | 194946 | 1.440 |

The observers froze 120 and 60 samples, reading 15,360 and 7,680 bytes. Native
read cost was 2.770 and 1.049 ms respectively. Each retained sample's VI/session/
epoch/origin identity was validated. Request counts include setup after the start
marker, final status/capture and observer teardown; byte counts are serialized
JSON replies/events, excluding socket framing and video. Task retention stayed at
64 and reported 119–120 dropped historical dispatches. The compact view retained
43 records without truncation in the measured final generation. Full JSON and
native hash are in ignored `artifacts/kirby-feedback-cost.json`.

Separate real Kirby matrix acceptance records paged transport cost and explicit
verbose-capture overflow: its 8-VI JIT saved-state run made 584 requests / 515.5 ms
and retained 208 actual matrix states; three verbose generations hit their cap.
The interpreter power-on run reached VI 34 in 1252.1 ms / 422 requests with 34
states. These historical observations have different startup/workload semantics
and are not an executor speed comparison. The committed harness reproduces them.

Renderer acceptance checks composed screenshots and sample/presentation matching.
The delivery stress test accounts for all 120 input samples as delivered or
explicitly skipped, isolates independent consumers and verifies cleanup. Live
UI overlays coalesce bounded matching updates; lossless acquisition uses the
separate bounded recorder/export contract.

## Capability boundaries

- Scanout task IDs are address/range candidates. They do not prove arbitrary
  displayed pixel authorship after blending, CPU writes or buffer reuse.
- Verified matrix and yield/resume state supports the full hashed F3DEX2 FIFO
  2.04H profile and static tables. Other code stays unsupported/unverified.
- Matrix/command/transform retention and observer/export quotas report loss;
  unlimited or lossless live rendering is not promised.
- The Kirby visualization supports its tested 320x240 logical / 640x240 native
  geometry; camera/joint projections are labeled derived. Save-state portability
  between whole-system executors is not established by the power-on tests.
- Watchdog health is an independently timestamped cached observation during a
  main stall. It does not infer a dialog or other unobserved root cause.
- This macOS arm64 package is a development distribution, without a signing or
  notarization claim. Sparse JIT optimization remains separately scoped issue 15.

## Final installed handoff

Build **609ee560967bbeb3** replaced `../build_macos/Ares.app` at the normal path.
No app backup was created. Its build-time HEAD is `1e6f68e4c`; final acceptance
harness/documentation are committed afterward. Source digest is
`609ee560967bbeb3a88b82455e417fc4f7991ea17c196f15fb6555a4a3378981` and the
installed native payload SHA-256 is
`b970af1f4f750482bcb444dd50079d9a7eb4cbd1f7b79edd980f9c317d1d82c3`.
The existing `/Users/bschlenk/.local/bin/ares` already targets that app and needed
no rewrite. The user's controller icon remains in the verified package.

Final checks passed:

- Full Node lane: **180 passed, 0 failed, 0 skipped**.
- Copied package: bundled Node/native/MCP and schemas, plugin build/reload/tooling,
  icon and named-instance signal/reconnect/nonreplay checks.
- Actual installed helper: real private Kirby recorder, its state load and 80-VI
  result, exact output-file/full-paged-result agreement and fresh-process default/
  explicit retrieval. Adapter/app build IDs match; original media is unchanged.
- Packaged main was OS-stopped. Fresh installed `ares call app_health` returned
  bounded independent cached `main: unresponsive`, `observer: responsive` health;
  continuing main restored its responsive heartbeat. No dialog cause was guessed.
- The actual deployed Kirby plugin with installed native passed overlay pixel,
  resize/DPR, Settings/floating, clipboard/save, exclusive reload and epoch cleanup.
  Screenshot reviewed: 34 captured nodes, the 16-joint Kirby rig, 2280 overlay
  pixels, epoch 2 / VI 26 / origin commit 26. Its frozen export is nonpartial for
  this sample; task mapping remains candidate-only.
- Generic real-Kirby overlay composition/slow-consumer/origin checks and scoped
  clipboard/single-frame/12-frame sequence export/cancel/reset-picker checks pass.
  Actual Electron fatal/EPIPE handling and durable stack capture pass.

Receipt: ignored `artifacts/kirby-skeleton-migration/deployment.json`; detailed
installed recorder evidence: `artifacts/feedback-packaged/summary.json`; final
package: `artifacts/feedback-plan-final-20261025/Ares.app`. The canonical example
and all five deployed Kirby plugin files have identical recorded SHA-256 hashes.

All A–H deliverables are complete within the explicit capability boundaries
above. Broader arbitrary-microcode/pixel-authorship/platform work and issue 15
remain separate work, not silent guarantees of this implementation.
