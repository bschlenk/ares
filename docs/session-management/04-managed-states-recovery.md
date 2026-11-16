# Task 4: Managed states and recovery

Status: **Complete**. Depends on tasks 1–3.

Implementation commit: **`e89674814`**
(`feat(sessions): add managed state overlays and recoverable reset`).
Evidence: [implementation report](../../electron-ui/sessions/IMPLEMENTATION.md#task-4--managed-states-and-recovery),
[acceptance](../../electron-ui/ACCEPTANCE.md), and
[CLI/MCP recipes](../../electron-ui/sessions/RECOVERY.md).

Native/TypeScript builds, 60 focused tests and three separate desktop checks pass.
Full acceptance passed 338 fixture tests and stopped at an unrelated stale MCP
Game Boy video-clock assertion; later full-suite gates remain unrun. Task 5 is
next. Scoped selection, approval/revocation and presentation remain gated by
tasks 5–7; issue #37 stays open.

Read [the shared preamble](README.md) first. Build on the generation repository
and the native/lifecycle ownership protocol completed in task 2. Task 3 now
coordinates personal checkpoint publication/read/retention and the remaining
shared stores; preserve those transactions when adding the overlay. Creation's
journal alone is not a reset/restore protocol. Keep the personal library
read-only through the backend, including collisions in timestamp IDs.

## Requirements

Wrap `CheckpointLibrary` in a scoped facade with a local writable library and,
for named sessions, a personal read-only library. Return entries with explicit
`origin` and a source-qualified opaque reference; timestamp IDs can collide
between libraries. Show Personal/Session origin in `ui/checkpoints.ts`.

Enforce read-only inheritance in the backend: rename/delete/retention/overwrite
only accept local references. Personal windows enumerate only personal states.
Keep existing checksum and ROM/configuration checks when loading either source.
Coordinate personal library writes/retention across processes; protect an
explicit inherited load against concurrent deletion using a library transaction
or verified in-memory read. Never automatically load an inherited checkpoint.

Add separate managed-library tools for listing, explicit loading, and local
management. Keep the existing path-based `state_load`/`state_save` and imports/
exports, with their compatibility/capability limits. Do not imply universal core
state support by renaming tools currently limited to N64 services.

Reset/restore use the same exclusive lifecycle lock as open, acquired before any
data selection. A running app, including one with services disabled, causes a
clear refusal. Never stop it implicitly.

- Fresh clone: build a new generation with current personal settings and an
  empty initialization ledger under `inherit-personal`.
- Start empty: build defaults without imported personal BML, empty ledger, and
  a persisted `fresh` policy that applies to all later game loads.
- Both retain access to the personal managed-state source.
- Stage and sync the replacement generation; atomically publish the active
  generation pointer. Record the old generation in recovery with mode, timestamp,
  and ID. Use a recoverable transaction journal so a crash at any step leaves
  one valid active generation and recoverable displaced data.
- Restore a selected archived generation by the same transaction, archiving
  the displaced current generation. Never destructively swap/delete backups.

Expose archive listing/restore through CLI and MCP and a discoverable Sessions
settings view with **Restore previous data**. Named-session creation remains
CLI/MCP-only. Do not add automatic permanent archive deletion. Keep backups and
lock paths outside data that can be replaced. Archive only session-owned data,
never external personal folders referenced by old settings.

---

Previous: [Task 3: Personal windows and shared settings](03-personal-windows-shared-settings.md) · Next: [Task 5: Discovery and scoped selection](05-discovery-scoped-selection.md)
