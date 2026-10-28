# Kirby feedback triage and implementation plan

Date: 2026-10-28. Source: `/Users/bschlenk/Developer/kirby/docs/ares-electron-feedback.md`, open items 1–10 and the October 26 escalation. Source review baseline: `f11874415`; working tree was clean before this document. This is a planning and source-triage pass, not a claim that the packaged app has passed acceptance. No implementation changes are included.

## Approach

1. Preserve the feedback's numbering and distinguish implemented foundations from outstanding behavior. Verify suspected fixes against source, history and targeted regressions before closing anything.
2. Address the continuous-video blocker first, then intermittent script failures and test isolation. Improve error reporting alongside those fixes so failures remain diagnosable.
3. Agree on the human demonstration contract below, then implement it once in shared services for MCP, scripts and plugins. Reuse the existing recording banner and input recorder.
4. Finish source selection, clip ergonomics and plugin integration. Defer multiple videos per script unless the shared video work makes it inexpensive.
5. Validate in isolated temporary profiles with explicit process teardown. Record the tested commit and actual packaged `build_info` separately; report each item as verified fixed, partial, or still open.
6. After verification, update the source feature request document at `/Users/bschlenk/Developer/kirby/docs/ares-electron-feedback.md`: remove completed requests from its open list, retain unresolved portions of partially completed requests, and keep unverified requests open. Update its completion summary with the tested commit/build and a reference to the acceptance evidence so removing an item does not lose its verification history.

## Request triage

| Item | Priority / disposition | Evidence and planned action |
| --- | --- | --- |
| 1. Leaked app and opaque profile lock | High; partially covered, verify launchers | `tests/feedback-packaged.cjs` now explicitly uses temporary `ARES_PROFILE_DIR` and `ARES_SERVICE_DIR`, with TERM/KILL teardown in `finally`. Recent helper-discovery and dead-service-claim fixes (`a535e9c5e`, `c83a596f6`, `0f0056c4e`) are relevant but do not establish that every launcher is safe. Audit all launch paths, early failures and descendant processes. `services/automatic-client.ts` still reduces launch failures to `profile_in_use`; add bounded holder diagnostics (PID, start time, executable, service directory and existence) without contacting or killing an unrelated app. |
| 2. JSON encoded inside an error string | Medium; open | `cli.ts` still throws `Error(JSON.stringify(...))`, then wraps the message in `{error: ...}`. Introduce structured CLI failures with stable code, readable message and operation details; cover thrown scripts and missing files, preserving exit status 1. |
| 3. Unknown option validation dump | Medium; open | CLI forwards parsed option names to the registry. Format schema failures at the shared boundary: name unknown options and list the accepted parameters; for `--count`, point to `run_frames --n`. Preserve structured validation details for programmatic clients. Strict schemas already exist on many tools, but readable rejection still needs work. |
| 4. Different video sources | Medium; partial foundations only | Native status already identifies framebuffer versus presented; `video_start` still exposes no source choice and documents presented frames. Script recording uses the separate exact framebuffer path. Screenshot source selection is already implemented, but does not fix video. Add an explicit source to both public recording paths and document defaults, dimensions and timing semantics. Presented frames must not silently claim exact VI coverage. |
| 5. Multiple videos per script | Low; defer | `RecordingService::rebase` still clears script-owned frames after state loads. First document the limitation. Later consider explicit script start/stop segments with pregranted outputs, building on the new video sink; do not let this delay continuous capture. |
| 6. Script blocked after demonstration request | High for demonstrations; open | `host.cpp`'s armed guard still excludes `script.*`, despite allowing `n64.demo.*`. The outer script polling/result path can therefore fail even when the direct demo method is allowed. Permit the owning script's status, result, cancellation and demo lifecycle operations while retaining paused-state protection. Attribute rejected inner calls to `script_error`; ensure a returned script can hand off ownership to a durable human job. |
| 7. Idle cancel and unnamed buttons | Low; open | Native owner checks still precede cancellation handling; `InputEvent` still contains numeric masks without names. Make cancellation of an inactive job an idempotent no-op without weakening active-owner protection. Add derived `held` names matching `controller_set`, retaining raw wire values as the replay authority; define import/version compatibility. |
| 8. Long video cap loses result | **Highest; open, blocking Kirby** | `native/recording-service.hpp` retains raw frames in a vector and rejects above 256 MiB; `services/script-wait.ts` throws when script output publication fails. Stream/spool frames to bounded disk storage with a bounded producer queue and explicit backpressure/failure behavior. Preserve exact continuous capture beyond 1,500 frames without increasing unbounded RAM use. Publish script results independently of video outcome and retain a usable prefix when capture stops at a limit. |
| 9. Plugin button arms human demo | Medium after item 6 / contract; partial UI foundation | `renderer.ts` already creates Start recording, Stop recording and Cancel buttons. MCP and script demo methods exist; a plugin-facing demonstration capability and authorized state/export flow remain to be designed and verified. Use a user-picked state or granted folder, perform the two RAM writes while paused, snapshot the resulting starting state, then arm the existing banner. Stop should finalize and save through `ctx.exports` or a preauthorized destination. |
| 10. Intermittent promise job limit | High; potential partial fix, still needs reproduction | `24d36eeb4` changed time-slice exhaustion into a yield and added queue regressions. Current `ScriptJobQueue` still caps at 4,096 jobs across yields, resetting only when drained; `script-service.hpp` still reports bare `promise_job_limit`. Do not call this fixed. Instrument actual pending-job execution and host-call categories, reproduce both 5,000 reads and repeated `await frames(1)` under slow scheduling, then separate legitimate progress from a self-replenishing promise storm. Preserve hard protection against runaway scripts. Add typed/batched reads only if needed after identifying the cause. |

The feedback explicitly says pre-October-25 requests were checked against `1f56ca14f`. Do not reopen those as new work. Its unverified `adapter_stale` scenario and physical human demonstrations remain acceptance gaps, not evidence of a regression.

## Human recording proposal for discussion

### What to record

Use a replayable controller demonstration as the primary artifact. The current version-1 `ares-input-clip` already records the data the N64 game consumes at each standard Gamepad SI read: sequence, relative VI/frame, selected port, raw controller word, button mask and signed axes after shaping/deadzone/gate. Preserve multiple latches per VI and VIs without reads. Add friendly button names for inspection; do not substitute wall-clock keydown/keyup events for these native samples.

Bundle or reference the exact starting save state, ROM hash, state hash and emulator/build provenance. A file path alone is not a portable recording. Capture one selected controller port initially; additional ports require an explicit schema extension. Optional synchronized video provides a visual reference for the agent/user; it is a separate artifact whose failure must not destroy the input clip. Audio and arbitrary RAM traces are outside the initial contract. Exact replay still needs compatibility and divergence checks; a save state does not justify a universal determinism guarantee.

### Required state and human lifecycle

Agreed public flow: **required starting state → load while paused → optional authorized setup → snapshot exact prepared state → armed → first deliberate controller input or Start button → recording → human Stop → finalizing → ready, paused**. Video is available explicitly on request and defaults off.

1. Require an existing starting-state reference when requesting a human recording. Validate the state/ROM, permissions, output destination and ownership before mutating emulation. Pause before loading and keep the emulator paused through setup and arming. If loading or setup fails, return an actionable failure and leave the emulator paused; do not show a successful request banner.
2. For the plugin power-setting use case, load the state and apply both RAM writes while paused. Persist and hash the **post-setup** state that replay actually needs. Prefer a restricted setup script or validated write list over arbitrary setup callbacks exposed through MCP.
3. Display the prompt, starting-state identity, “Press a controller button or move the stick to start” and **Start recording** / **Cancel**. Arming captures no input samples or video frames and advances no emulated frames. Treat time waiting for a human separately from recording duration; expose an explicit waiting expiry so a person does not consume the capture budget before starting.
4. The first deliberate input on the selected human controller port implicitly starts capture and unpauses. The explicit Start button remains available for demonstrations that begin with intentional neutral frames. Both routes enable input capture and requested video before any emulated advancement. Show **Stop recording** / **Cancel**, recording status and elapsed emulated duration. The Stop button is the normal human completion mechanism; MCP start/stop remain available for automation and acceptance.
5. Stop disables further advancement at the agreed VI boundary, seals input/video intervals consistently and leaves the emulator paused. It may require a short finalizing state. Automatically publish to the authorized destination; if saving fails, retain the clip and offer retry. The user should not need to send a chat message to finish.
6. Cancel releases held inputs and marks the job cancelled. Return explicit reasons for user cancellation, waiting expiry, capture limit, disconnect and session replacement. Keep a durable job independent of the originating script's short lifetime, with bounded lease/expiry and explicit ownership rules. Agent result polling must not require holding one MCP call open throughout human play.

### Starting precisely from controller input

Observe physical input while emulation is paused; waiting for a native SI read cannot trigger the start because the core is not running yet. Use the same mapped keyboard/gamepad controls and selected port as gameplay. A new mapped button press or deliberate stick movement outside the configured deadzone can start the job. Ignore unmapped keys, UI shortcuts, other ports, injected MCP input and gamepad drift. Do not start while the user is interacting with a text field or another UI control that consumes the input.

At arming, establish a neutral baseline for the selected controls. A button already held or a stick already deflected must return to neutral before a subsequent gesture can trigger recording; releasing an old hold alone does not start it. Show “Release controls to enable input start” while waiting for neutral. The explicit Start button remains usable without this automatic-start gate.

Handle the transition atomically: retain the triggering mapped controller state, enable recording, then resume the prepared state. Preserve a short press/release that arrives before the first native controller read so the initiating press is available at least at that first eligible latch, then apply subsequent input transitions in order. Define and test this handoff rather than relying on the next UI polling snapshot. Recorded events remain the actual native SI samples; the physical trigger is start metadata, not a fabricated extra input event. Optional video starts on the same emulated timeline, with its first-frame boundary documented.

Include `started_by` (`controller_input`, `ui_button` or `mcp`) and the capture boundary in status/manifest metadata. Input start removes human response latency and leading emulated idle frames; it does not imply sub-frame input replay precision beyond the game's native sampling boundary.

**Existing behavior worth retaining:** the banner and Start/Stop/Cancel controls, paused arming, asynchronous status, native latch recording, boundary-safe stopping, ROM validation and versioned export already exist. **Crucial incompatibility:** current optional MCP `state_path` means “save the current paused state here” (`services/input-clips.ts`), not “load this initial state.” Introduce an unambiguous `initial_state`/`initial_state_path` field or a new versioned high-level request. Do not silently reinterpret `state_path` and overwrite existing callers' expectations.

### Proposed MCP responses

Return a small job receipt immediately. Poll status for progress and retrieve artifact metadata when ready; avoid putting thousands of samples into every tool response. These are proposed shapes, not currently supported parameters or responses.

```json
{
  "job_id": "demo-123",
  "state": "armed",
  "waiting_for": "human_start",
  "start_triggers": ["controller_input", "ui_button", "mcp"],
  "prompt": "Show Kirby using Stone+Cutter several times, then press Stop recording.",
  "initial_state": { "id": "prepared-state-123", "sha256": "..." },
  "capture": { "input": true, "video": false, "port": 1 },
  "status_tool": "demonstration_status"
}
```

```json
{
  "job_id": "demo-123",
  "state": "ready",
  "complete": true,
  "stop_reason": "human_stop",
  "duration_frames": 184,
  "events": 184,
  "artifacts": {
    "manifest": { "path": ".../manifest.json", "sha256": "..." },
    "input": { "path": ".../input.json", "format": "ares-input-clip", "version": 1, "sha256": "..." },
    "initial_state": { "path": ".../initial.state", "sha256": "..." },
    "video": null
  },
  "warnings": []
}
```

Paths refer to the emulator host. Where supported, add MCP resource references for remote retrieval; do not imply a host path is directly readable by every client. The manifest links artifacts, timing/source metadata and provenance. Retain the existing numeric job identity if extending current APIs; the illustrative string above does not require changing it. A `held` field can be additive if importers tolerate it; otherwise version the clip. Distinguish completed input capture from successful artifact publication and optional video success in status.

### Agreed defaults and remaining decisions

- Agreed default: inputs plus required prepared state, with video opt-in and supported through MCP/plugin requests. First deliberate human controller input starts and unpauses; the Start button is also available.
- Recommended output: a recording directory containing manifest, input JSON and save state, plus optional video. The request preauthorizes a destination or uses app-managed storage, allowing Stop to save without another agent round trip.
- Recommended completion: Stop yields a complete clip; reaching a safety cap yields an explicit partial clip and reason, exportable for inspection but not described as complete. Current demonstration overflow prevents export, so accepting this requires a deliberate compatibility change.

## Implementation batches and acceptance

1. **Video reliability (#8, shared groundwork for #4/#5).** Separate result and artifact publication outcomes first; implement bounded disk capture without blocking native render callbacks. Verify at least 1,800 continuous 320×237 frames (stretch: 3,600), frame ordering/count and bounded RAM. Verify bytes/disk/write limits preserve script JSON and a readable captured prefix. Exercise reset/load, cancellation, dimensions changing and shutdown cleanup. At raw BGR24, 320×237 is 227,520 bytes/frame: 256 MiB holds 1,179 frames before container overhead. Document actual dimensions and configured limits rather than a universal frame cap.
2. **Execution and lifecycle correctness (#10, #1, #2/#3).** Reproduce scheduler failures under slow execution, retain a real promise-storm negative test, and validate structured CLI errors. Force failures during startup/acceptance; confirm no orphan app or default-profile lock. Verify lock-holder metadata without stealing a live profile.
3. **Human recording contract (#6, core of #9).** Implement required-state preparation and durable handoff, then wire existing banner controls and input-triggered start. Test no advancement/capture while waiting, first-press inclusion (including press/release before the first native latch), held-input neutral gating, analog drift/deadzone, wrong-port and injected-input rejection, consumed UI input, duplicate simultaneous start triggers, explicit Start with neutral frames, video off/on, exact prepared-state replay, script return/polling after request, stop-at-boundary, cancellation, expiry, disconnect, save failure/retry and competing owners. Physical keyboard and gamepad input-start/play/Stop/replay require manual acceptance; synthetic input/UI tests alone are insufficient.
4. **Public API consistency (#4, #7, remainder of #9).** Expose source choice, friendly event names, safe idle cancel and plugin capabilities/exports. Test a plugin that loads a picked state, performs two authorized RAM writes, arms, and saves after human Stop. Ensure plugin access obeys granted file capabilities.
5. **Optional segmentation (#5).** Reassess after the streaming sink exists; add explicit script segments only if it fits without destabilizing continuous capture.

For each batch, run focused existing tests and add regressions for the changed behavior, then rebuild and check the actual packaged app. Record measured acceptance evidence in a companion document, including which private Kirby workloads and physical-controller cases were available. No request is closed solely because related source code or a similarly named feature exists.

Finish each verified batch by reconciling the source feedback document: remove requests completed by that batch or verified as already completed by recent work, preserve remaining requirements, and update the completion summary. The plan and acceptance evidence retain the original item numbers even if the source open list is subsequently renumbered.
