# Task 2: Actual storage ownership and inheritance

Status: **Complete**. Depends on task 1.

Read [the shared preamble](README.md), the
[data-root audit](../../electron-ui/sessions/DATA-ROOT-AUDIT.md), and task 1's
[implementation evidence](../../electron-ui/sessions/IMPLEMENTATION.md) first.
Start by producing the loader/write-path inventory required below. The existing kernel helper is
a reusable primitive, not proof that an orphan native writer retains ownership.
Test parent, helper and native death independently before removing the named-game
load gate. Preserve exclusive personal-profile ownership until task 3's other
shared stores are coordinated as well.

Implementation: **`164e91973`** (`feat(sessions): coordinate native storage ownership and inheritance`).
Evidence: [task 2 implementation report](../../electron-ui/sessions/IMPLEMENTATION.md#task-2--actual-storage-ownership-and-inheritance)
and [loader/write-path inventory](../../electron-ui/sessions/STORAGE-INVENTORY.md).
Native/TypeScript builds, 42 focused tests and seven separate desktop checks pass.
Full acceptance passed 316 fixture tests, then stopped at an existing stale MCP
assertion; later full-suite gates remain unrun. Personal profile exclusivity is
retained, and tasks 3–7 remain outstanding.

## Requirements

Implement a native persistent-storage descriptor layer, with Electron-specific
policy under `electron-ui/native/`. Keep upstream-derived path calculation in
`desktop-ui/emulator/` and `mia/`; add narrow optional hooks, following the existing
resource-resolver pattern, rather than relocating those sources.

Descriptors identify the logical resource, resolved personal source, private
destination where applicable, file/directory scope, and shared resource groups.
Compute identity from the actual destination, not ROM identity. Cover battery
RAM, RTC/EEPROM, cards, controller/transfer paks, companion media, disks, writable
tapes and firmware/peripheral persistence. Audit direct file writes and writable
VFS handles as well as MIA save helpers.

First deliverable is a storage inventory by loader and write path. Build a
side-effect-free prepare phase using the same resolution code as actual loads;
the current `--identify` mode is insufficient. It may read ROMs/firmware to
determine storage, but must not read personal save contents, create save folders,
or mutate writable media. Include configuration and companion media in preparation.

Load transaction:

1. Prepare the complete writable resource set before committing a new game.
   Reserve it before stopping the current game where possible, so a conflict
   can leave the current game intact. Handle resources already owned by that
   same instance without releasing and reacquiring them in a race.
2. Acquire the resource locks as an all-or-nothing set. Canonicalize existing
   ancestors for absent files, resolve symlinks, handle directory overlap and
   platform filesystem case rules, and account for hard-linked existing files.
   Use stable lock files plus a short namespace arbitration lock to make set
   acquisition/alias registration atomic across processes.
3. Revalidate paths at open time; use safe directory-relative/no-follow access
   where appropriate. Refuse an unprepared write rather than falling back to
   an unlocked destination. Future dynamic media/peripheral attachment must
   reserve its additional resources before activation too.
4. Complete inheritance if needed, then permit save reads and runtime load.
   Hold personal resource ownership through final save/flush and native exit.
   On failed loading, release only newly reserved resources after the failed
   host has stopped; do not let cleanup saves bypass ownership.

Use kernel locks, extending the host's existing `--service-lock` primitives.
Ownership records describe the instance and game for conflict dialogs but are
not lock authority. Keep lock inodes stable; never recover by deleting a lock
because a PID record looks old. The actual native writer must retain the relevant
lock descriptors, or share a lock holder whose lifetime includes the native
writer. Parent Electron death must not release locks while an orphan host can
still flush. Apply the same protection to session lifecycle ownership during
reset/restore. Test killing parent, native child, and helper separately.

For named sessions, map each personal logical resource to a contained private
backing path. Record initialization per resource and per game load group, not
only by ROM hash. This prevents a second game using the same session-local card
from overwriting it during its own first load. The mapping must distinguish
resources that share a basename but have different personal destinations.

Initialization transaction:

- Consult the persisted generation policy: `inherit-personal` or `fresh`.
- Skip resources already initialized, even when their save files are absent.
- For uninitialized resources, snapshot personal on-disk data if inheritance is
  enabled, otherwise initialize absence/defaults. Publish files and ledger as
  one recoverable transaction; a crash must not turn a partial copy into success.
- Coordinate source reads with **all actual save write paths**. Add short-lived
  shared snapshot/exclusive save-transaction barriers, separate from lifetime
  writer ownership. Acquire barriers for the complete resource group while
  copying; group flushes also take them for the whole group. Direct writable
  media require the same barrier or a supported stable-snapshot mechanism.
- A personal runtime can keep playing and retain lifetime ownership during a
  snapshot. No flush of its latest in-memory progress is required. A canceled or
  failed snapshot leaves the session uninitialized and retryable.

This protocol must land before enabling inheritance from a running personal
game. Ordinary file copying or atomic replacement of individual files alone does
not establish a consistent multi-file snapshot.

---

Previous: [Task 1: Data model, paths, and lifecycle](01-data-model-paths-lifecycle.md) · Next: [Task 3: Personal windows and shared settings](03-personal-windows-shared-settings.md)
