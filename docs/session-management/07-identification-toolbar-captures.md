# Task 7: Identification, toolbar, and captures

Status: **Not started**. Depends on tasks 1–6.

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

---

Previous: [Task 6: Approval, cancellation, and revocation](06-approval-cancellation-revocation.md) · Next: [Final acceptance](ACCEPTANCE.md)
