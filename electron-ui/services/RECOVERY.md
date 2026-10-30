# Checkpoints, journals and remaining recovery work

Generic checkpoints already support Game Boy. The existing native
`checkpoint.info`, `checkpoint.capture/read/release` and
`checkpoint.upload/write/commit/abort` contracts use portable synchronized core
serialization and epoch guards. The trusted host `Checkpoints` service downloads
an immutable capture and publishes it through `CheckpointLibrary`; it can reopen
GB and N64 captures in a new native process. Cartridge saves retain their normal
profile-owned save locations. No model-script save/load binding is added.

Capture retains the run/pause flag. It executes synchronously on the emulation
thread and may run a coroutine core to a serializer synchronization point; it is
not free of native work or equivalent to sampling RAM. Its response now includes
`capture_ms`, measuring native serialization and pixel-copy work, excluding
request queue delay, transfer, PNG encoding and durable file publication.
`capturedAt` is the wall timestamp at the start of capture. Do not interpret that
start timestamp as the instant the complete state file became durable.

Read-only observers can remain registered during capture. The host suspends their
callbacks while serialization/capture runs, then resumes normal sampling with
existing skipped-sample accounting. It does not destroy/recreate observer jobs
or reenter QuickJS from serializer callbacks. Exclusive execution, GDB, competing
transfers and state restoration keep their admission guards. Upload/restore still
rejects while observers exist; the trusted recovery orchestrator must coordinate
that lifecycle and expect the restore to invalidate the old epoch.

Generated GB/GBC/N64 tests verify capture with live observers, continuation,
unchanged pause/epoch, transfer ownership and exclusive upload refusal. Sample
native capture work on this machine was approximately 0.25 ms GB, 0.29 ms GBC,
and 24 ms N64; those fixtures are not performance bounds for every game/core.

The [durable journal](../plugins/JOURNAL.md) now supplies acknowledged sequence
numbers and idempotent retries. It is still separate from checkpoint publication.
The remaining recovery broker must commit one manifest associating an immutable
checkpoint with the corresponding plugin/storage-version journal sequence,
validate game/configuration identity, defer to idle input, and permit automatic
restoration only after a technical failure. This trusted broker must never be
included in the model's player API.

A checkpoint interval alone is not a guaranteed progress-loss bound when capture
can be deferred by active input or exclusive jobs. Recovery diagnostics must
report the actual age/frame of the last committed paired recovery point. Until
that scheduler and paired publication exist, maximum loss since the last saved
checkpoint is unbounded; Ares does not currently advertise unattended crash
recovery or a zero-loss guarantee. Existing autosave-before-stop handles normal
shutdown/game switching, rather than arbitrary process crashes.

Validation (2026-10-30): the complete sequential suite passed 254 tests with zero
failures and one optional private-ROM skip; the actual disposable Electron
save-state flow passed (`CHECKPOINT_UI_PASS`). Host/CPU/task/matrix fixtures and
all strict TS/SDK targets were rebuilt. No save/load capability was added to the
plugin or model API.
