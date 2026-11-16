# Managed states and session recovery

Named windows use a writable session checkpoint library plus a read-only personal
source. The state browser labels entries **Session** or **Personal** and disables
personal rename/delete. Personal windows list only personal states. Inherited
entries are explicit choices; the startup Continue invitation uses local autosaves
only. A named session's generation records its inherited personal library path.
Both reset policies retain that source, using the personal state folder configured
when the new generation is created.

CLI and MCP expose the same managed-library tools:

```sh
ares call managed_states --offset 0 --limit 20
ares call managed_state_load --reference 'REFERENCE_FROM_LIST'
ares call managed_state_save
ares call managed_state_rename --reference 'LOCAL_REFERENCE' --name 'Before boss'
ares call managed_state_delete --reference 'LOCAL_REFERENCE'
```

Treat references as opaque, source-qualified values, including when timestamps
collide. `managed_states` returns `entries`, `total`, and `nextOffset`; entries carry
`origin`, `reference`, and `writable`. Rename/delete/retention cannot write inherited
personal entries. Reads verify state checksums under the same cross-process
transaction as personal writes/retention; the verified in-memory bytes survive
later deletion. Loads check the current game and core configuration, start a new
native epoch, and resume as the in-app state browser does. Core checkpoint support
is required; these tools do not make unsupported serializers available.

Path-based `state_load`/`state_save` remain separate N64 services, retaining their
existing capability and compatibility limits. Explicit file imports/exports remain
supported. Managed operations use the existing selected instance and native
session/epoch checks, preserving connection/lease ownership. Scoped discovery and
selection changes are task 5; personal approval/revocation is task 6.

## Whole-session reset and restore

Close the target named window first. Settings → **Sessions** lists existing names,
offers **Fresh clone of personal**, **Start empty**, and **Restore previous data**.
It can manage another closed session from a personal or named window. Creating
names remains CLI/MCP-only (`--session-name NAME` launches/creates a named window).

Offline lifecycle tools require an explicit absolute `personal_root`, the shared
profile directory from which the named session was created. They do not connect
to or launch an app, infer a machine-global selection, or create a missing name:

```sh
ares call session_reset --personal_root /absolute/disposable/profile --name work --mode inherit-personal
ares call session_reset --personal_root /absolute/disposable/profile --name work --mode fresh
ares call session_archives --personal_root /absolute/disposable/profile --name work
ares call session_restore --personal_root /absolute/disposable/profile --name work --archive_id ARCHIVE_UUID
```

Use the same fields in MCP. `inherit-personal` copies current personal preferences
and imported BML, with an empty initialization ledger so later game loads inherit
current personal saves. `fresh` uses defaults without personal BML and persists a
fresh-save policy for every later game load, including different games after
restart. Both offer personal managed states for explicit loading.

The session lifecycle kernel lock is acquired before selecting data. A running
window or surviving native writer causes `session_running`, even with services
disabled. Nothing stops the app implicitly. Restore refuses concurrent writers
and copies a selected archived generation into a new writable generation. Owned
settings paths and pending native initialization paths are rebased; external
personal folders are never traversed, moved, or deleted.

Storage lives beside the personal profile in `.ares-session-management/v1/` under
its canonical-path namespace, independent of service directories. Each session's
`session.json` points to its active `generations/UUID`; `recovery/UUID.json` records
the displaced generation, mode and timestamp. Locks and recovery records sit
outside replaceable generations. A synced `replacing.json` journal makes archive
publication and the atomic active pointer recoverable on the next open/reset/
restore. Both generations stay intact throughout; interrupted staging can leave
an unreferenced generation, but does not replace active data. No automatic
permanent archive deletion is performed.
