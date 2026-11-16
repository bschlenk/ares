# Task 7: Identification, toolbar, and captures

Status: **Complete (implemented and automated integration verified; manual release limits recorded)**.
Implementation commit: **`6c7f6fb12`**. Depends on tasks 1–6.

Read [the shared preamble](README.md) and
[shared acceptance requirements](ACCEPTANCE.md) first. This task includes the
final integration/release evidence, not just titles and toolbar markup. Run the
full acceptance lane and map evidence to all eleven spec criteria. Record manual
packaged macOS results or explicit unrun limits; do not infer Dock behavior from
development Electron.

## Requirements

Use one main-owned title formatter for app startup, empty game, ROM changes,
native disconnect, and renderer recovery. Include the name for named sessions;
send identity/access state in the renderer's initial snapshot and later updates.
Update the custom title UI as well as the native window title.

Add named-session and authorized-personal banners to the playback toolbar's
existing visibility container. Named banners have no dismiss/revoke action.
Personal banners explain access to real data and expose Revoke whenever controls
are revealed, including keyboard/focus accessibility. Renderer reload reconstructs
them from main state. Request prompts remain usable without interrupting gameplay.

Mark banners as app chrome and exclude them through the common capture scope,
not only CSS placement. Audit presented screenshots with arbitrary supported
rectangles, renderer video surfaces, framebuffer captures, managed checkpoint
previews, and plugin exports/recordings. Extend capture leases to hide excluded
chrome for the full capture interval, restoring it safely after nested captures,
errors, cancellation, and renderer recovery. Verify the resulting pixels with
distinctive banner test imagery; do not hide legitimate game/plugin overlays.

For macOS, try supported per-process application naming before readiness and
verify separate instance activation and Dock hover text in a copied packaged app.
Record exactly what the OS supports. Window titles are mandatory; if the fixed
bundle display name prevents per-session Dock hover names, document that measured
limit. Do not assume development Electron naming proves packaged behavior, or
rewrite the signed bundle metadata at runtime.

## Completion and remaining release checks

Implemented persistent main-owned native/custom titles and revisioned identity/access
snapshots; named and personal-access banners follow toolbar idle and keyboard focus.
Capture leases exclude app chrome for the whole interval, preserve legitimate overlays
and reject stale renderer captures. Native PNG/AVI/checkpoint pixels and plugin exports
are audited. Task 6's named-only external renderer plugin boundary is preserved.

Final full command: `mise exec node@24.22.0 -- npm run accept` from `electron-ui/` —
**38/38 gates, 353/353 fixtures passed**, including copied-package and helper UI gates.
See [implementation evidence](../../electron-ui/sessions/IMPLEMENTATION.md#task-7--identification-toolbar-and-captures)
and [the eleven-criterion map](../../electron-ui/ACCEPTANCE.md#task-7-identity-toolbar-and-capture-integration).

Supported `app.setName` is attempted before readiness. Packaged Dock hover strings
and separate icon activation, physical-controller gameplay with pending approval,
and human packaged title/banner/toolbar reveal checks remain **manual/unrun**.
Automated development application naming and copied-package checks do not establish
OS Dock behavior. No runtime bundle metadata rewriting was added. Issue #37 remains
open for those release checks and the documented compatibility boundary.

---

Previous: [Task 6: Approval, cancellation, and revocation](06-approval-cancellation-revocation.md) · Next: [Final acceptance](ACCEPTANCE.md)
