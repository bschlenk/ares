# Task 3: Personal windows and shared settings

Status: **Next — not started**. Depends on task 2 and task 1's settings transaction.

Read [the shared preamble](README.md) first. Reuse
`settings/transaction.ts` and `sessions/launching.ts`; finish watcher/revision
reconciliation and every mutable store identified by the data-root audit.
Task 2 added `storage-routing.json`: preserve its effective contained save subtree
when opening additional personal windows; coordinate that shared routing rather
than allowing a default launch to redirect a running custom-root personal game.
Do not remove the personal-profile exclusion merely because launching another
process works. Keep broad multiwindow/external-access exposure gated until the
storage and revocation guarantees in this plan are available.

## Requirements

Add File → New Window to every window. Spawn another personal app with a new
instance UUID/runtime directory and the same personal logical root. Explicitly
remove inherited named-session selection/private save overrides from its launch
context. Preserve the namespace needed for isolated tests/embedded profiles.
Reuse a launch helper for checkout and packaged binaries; do not use shell
command strings. Ordinary personal GUI launches also create a personal instance.

Coordinate settings using a kernel-backed file transaction: read latest values
under lock, apply a key-level patch/reset, validate, atomically publish with a
persisted revision, release lock, then apply local runtime changes. Preserve
unknown keys and refuse malformed files as today. Define same-key conflicts as
last committed write; unrelated keys must survive concurrent writes.

Notify other windows through a file watcher with revision reconciliation and
periodic/focus resync so missed/coalesced watcher events are harmless. Every
window applies shared live changes to its own runtime and retains next-ROM or
restart semantics. Keep locks out of native awaits. Ensure external queued
settings writes recheck authorization immediately before commit. Apply the same
transaction pattern to other shared mutable stores found in the data-root audit.

---

Previous: [Task 2: Actual storage ownership and inheritance](02-storage-ownership-inheritance.md) · Next: [Task 4: Managed states and recovery](04-managed-states-recovery.md)
