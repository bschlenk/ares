# Paired checkpoint and journal recovery

A trusted plugin can ask Ares to keep the emulator state and its durable records
at a matching recovery point. Declare **both** `recovery.manage` and
`storage.journal` in its manifest. This is a generic host API, independent of the
loaded core or game. It adds no QuickJS/model bindings and offers plugins no
restore or rewind operation.

```ts
// Trusted adapter only. Serialize this with the adapter's own action queue.
await ctx.recovery.capture();
await ctx.recovery.start({intervalMs: 5000});
const status = await ctx.recovery.status();
await ctx.recovery.stop();
```

These four SDK methods return `RecoveryStatus`. `capture()` durably publishes
one point; `start()` schedules future attempts, with a 1,000–300,000 ms interval.
It does not take an immediate snapshot. `stop()` stops future attempts; an
already running capture still checks scope/session validity before publication.
Reload, unload, disconnect and epoch changes revoke the monitor. The replacement
plugin must start its own monitor. Ares never interprets journal payloads or
implements gameplay/retry policy.

## What is paired

The host holds the namespace's journal writer queue while it freezes the current
journal and captures a portable core state. It writes the state, frozen journal
and manifest to private files, syncs each file and the staging directory, renames
the directory, syncs its parent, then atomically publishes and syncs `latest.json`.
That pointer is the commit point. Partial publication leaves the previous point
usable. The manifest records normalized game hash, core configuration digest,
plugin ID/storage version, native session/epoch, capture-start frame and kind,
wall timestamp, native capture work time, and the journal sequence cutoff. SHA256
and length checks cover both data files. No filesystem paths are returned by the
plugin API.

Files live under the profile's `paired-recovery/<plugin>-v<storageVersion>/`.
The broker retains the latest and preceding point, caps the whole store at
512 MiB/128 namespaces, and accepts states up to 64 MiB and journals up to 4 MiB.
Unpublished staging files/directories are cleaned on the next namespace operation.
Competing captures are refused (`recovery_busy`); competing plugin coordinators
for the same live game are refused (`recovery_owner_conflict`). Publication is
bounded by the native transfer lease; journal admission remains bounded as well.

Captures defer with `input_active` while injected buttons, human buttons/sticks,
or pending human takeover are active. Exclusive execution, GDB and competing
transfers retain native admission guards. The trusted plugin should serialize
journal writes/input actions with explicit captures when it needs an application
transaction boundary; Ares does not infer one from application record text.

## Crash restoration

A normal close/game switch first uses the existing autosave-before-stop flow and
**disarms** paired recovery. Unexpected native exit or app death leaves the last
point armed. Opening the same game after that failure starts a new native process
paused. Before publishing its session to plugins, main checks enabled plugins'
grants, game/configuration identity, file integrity and the journal prefix, then
restores the state and journal view. A native guard requires epoch 1, no elapsed
frames and no prior injected/human input; recovery cannot rewind a process that
has already played. Normal launches never auto-load an old armed point from the
same healthy session. A restore increments the epoch.

Restoration keeps the core paused until journal publication completes. An intent
marker is persisted before RAM changes, so a second crash can retry the same
point in another fresh process. After success the original pause/run preference
is restored (agent launches remain paused). If validation or journal publication
fails, the game stays paused, no player plugin scope is activated, and the error
appears in app logs/status and `app_health.native.recovery_failure`. There is no
silent fallback to playing a fresh game. Normal close/reopen can deliberately
leave that failed recovery path.

Journal records after the cutoff remain physically retained for audit but are
excluded from ordinary reads. Sequence numbers never go backwards or get reused;
a retry of an excluded stable ID reports `duplicate:true, superseded:true`.
`JournalPage.recovery` identifies the point/cutoff/target session. The plugin must
rebuild its model context from that recovered view rather than retaining stale
in-memory history from the abandoned process. See [journal details](../plugins/JOURNAL.md).

## Timing, limits and existing APIs

`RecoveryStatus` exposes `point`, `ageMs`, `framesSincePoint`, `monitoring`, the
configured interval, last scheduler error and restored point metadata. Frame age
is null across session/epoch changes. `point.frame` is the native coordinate at
capture start; portable coroutine serialization may advance to a synchronization
point. `captureMs` measures native serialization/pixel-copy work, excluding queue
delay, transfer and durable publication. Capture retains the normal run/pause
flag but briefly blocks the emulation thread. It is not a non-stalling RAM sample.

Read-only observers survive capture: callbacks are suppressed during serializer
work and resume with existing skipped-sample accounting. Upload/restore remains
exclusive. Startup restoration happens before plugins/observers receive a new
session, so they cannot observe mismatched RAM/history during recovery.

A requested interval is **not a guaranteed progress-loss bound**. Input or other
exclusive work, storage failures and quota exhaustion can defer capture
indefinitely. Actual potential loss is progress since the last committed point;
inspect its reported age/frame, not the desired interval. No journal compaction,
automatic native-process relaunch, cross-version state migration or zero-loss
promise is provided. Reopen/restart triggers restoration; a supervisor may do
that using the existing local service `load_rom` after native failure. The local
service may be unavailable until the app itself has restarted after app death.

The existing native services remain `checkpoint.info`,
`checkpoint.capture/read/release`, and `checkpoint.upload/write/commit/abort`.
Optional capture `{requireIdle:true}` and upload `{recovery:true}` encode native
admission guards; they do not create plugin state-load permissions. MCP/CLI keep
their existing trusted/manual state tooling; the recovery SDK is admitted through
the host plugin channel, not a player service. Cartridge saves retain their
normal profile-owned locations and are separate from this journal.

Tests use generated ROMs and disposable profiles. They cover paired GB/GBC/N64
restoration, input/pristine guards, integrity/configuration/namespace refusal,
publication faults, repeated crashes, monotonic journal history, capability and
scope enforcement, real Electron SIGKILL/restart, normal-close disarming, and
fail-closed plugin startup. No private ROMs or saves are test artifacts.

Validation on 2026-10-30: host/CPU/task/matrix fixtures and strict TS/browser/
preload targets rebuilt; SDK declarations regenerated. The complete sequential
suite passed 264 tests, with zero failures and one optional private-Kirby skip.
Focused scheduler/permission checks and real Electron session, plugin reload,
journal and checkpoint flows passed. A copied Electron 45.1.0 app passed ad hoc
signature verification and MCP/native/TSX hot-reload tests, including paired
captures at journal sequences 1 and 2, without loader/CLI access to this checkout.
This is development-package validation, not notarization or a zero-loss guarantee.
