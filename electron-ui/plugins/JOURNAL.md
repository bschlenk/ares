# Durable plugin journal

Declare `storage.journal` in the manifest to use `ctx.journal`. This trusted
plugin API is not included in QuickJS emulator bindings or automatically exposed
to a playing model. Keep journal access in the trusted companion adapter.
Existing `ctx.storage` and its 16 KiB settings quota are unchanged.

```ts
const receipt = await ctx.journal.append('events', {
  id: 'stable-action-id',
  schemaVersion: 1,
  value: {kind: 'observation', session: ctx.session, text: '...'},
});
const page = await ctx.journal.read('events', {afterSequence: 0, limit: 32});
```

Streams can hold events, explicit notes, or application-defined records. Ares
interprets neither their text nor gameplay policy. IDs and stream names are
case-sensitive tokens; the host accepts only letters, digits, dots, dashes and
underscores (stream names are at most 64 characters, record IDs at most 96).
`schemaVersion` is a positive integer, specific to the record's application
schema. Values must be finite, acyclic plain JSON; unsupported values are
rejected rather than silently coerced.

Receipts contain `sequence`, `duplicate`, current file `bytes` and `quotaBytes`.
Sequences are monotonic across streams within a plugin/storage-version namespace.
Reuse the same ID and payload when retrying an uncertain write: the host returns
the original sequence with `duplicate: true`. Reusing an ID in the same stream
with different content returns `journal_id_conflict`. Object key order does not
change identity. Record IDs are not emulator session IDs; include session/epoch/
frame identity in application payloads when those distinctions matter.

Reads return `records`, `cursor`, `hasMore`, `nextSequence`, `bytes` and
`quotaBytes`. Each record contains `sequence`, `stream`, `id`, `schemaVersion`
and `value`. Read again with `afterSequence: page.cursor` while `hasMore` is true.
Records are retained physically. Paired recovery can exclude an abandoned suffix
from the active read view; it never reuses sequence numbers. Archive or migration
policy needs an explicit follow-up.

## Limits and publication

- 4 MiB total per plugin and manifest `storageVersion`; 32,768 records.
  Appends reserve 64 KiB of that quota for recovery metadata.
- 16 KiB JSON value per record; JSON depth at most 32.
- At most 64 records and 64 KiB record payload per read page.
- At most 16 queued operations per namespace; overload is explicit.
- Activation/reload may read but cannot append until the scope is active.

Appends serialize in the host. The host writes a private staging file, syncs its
contents, checks that the scope remains valid, renames it over the namespace's
journal, then syncs the parent directory before acknowledging. Publication
failures clean staging files and preserve the prior committed version. If an
error occurs after rename, `journal_durability_uncertain` means the record may
already be committed; retry its stable ID to resolve it. Idempotent retries also
sync the directory before acknowledgement. Corrupt, oversized, future-format and
symlink files are rejected and preserved, never treated as an empty journal.
Unpublished UUID staging files left by a killed process are removed at the next
serialized namespace operation; committed and unrelated files are preserved.
File format version 1 is independent of each record's `schemaVersion`.

Quota errors are `journal_record_too_large` or `journal_quota_exceeded`;
admission uses `journal_overload`. Invalid requests/JSON/files and ID conflicts
are explicit errors. Capability and scope checks apply on the host, including
queued work after unload. The SDK checks scope validity again after replies.
The broker exposes no arbitrary file paths. Data is stored in a private file
under Ares's profile plugin-data directory, separately from immutable plugin
artifacts, saves and the small settings store.

## Recovery boundary

Acknowledged records survive plugin reload and process restart. The optional
[paired recovery broker](../services/RECOVERY.md) associates a checkpoint with the
journal's active view and sequence cutoff. It requires `recovery.manage` as well
as `storage.journal`. The journal alone never captures or restores emulator state.

After recovery, reads expose the matching prefix and any subsequent new records.
Abandoned records remain on disk but are excluded from reads, including notes
written after that recovery point. `page.recovery` contains `pointId`,
`journalSequence`, `targetSession` and ISO timestamp `at`. Sequence numbers keep
increasing across recoveries; gaps are expected. Retrying an excluded record's
ID/payload returns its old sequence with `duplicate:true, superseded:true` rather
than making the abandoned event current again. Use a new ID for a new event.
Records and exclusions both count toward the quota. Bounded recovery metadata
(maximum 1,024 excluded ranges) uses the reserved 64 KiB; there is no silent
pruning. A full store requires explicit future archival/migration support.

The plugin should rebuild model context from this recovered view after restart;
the model receives neither recovery controls nor journal write permissions
unless the trusted plugin deliberately provides its own restricted interface.

Tests cover restart reads, retry identity, pagination, concurrency, revocation,
injected publication failures, corruption/symlink/quota refusal, namespace/grant
isolation, repeated paired recovery and real Electron reload/crash paths.
