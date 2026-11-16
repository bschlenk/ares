# Session data-root audit

Task 1 separates logical persistent data from Electron's per-process `userData`.
The personal logical root remains the existing profile directory, including
explicit `ARES_PROFILE_DIR`, `ARES_PROFILE` and embedding `userData` namespaces.
Management paths use the canonical root's hash; checkouts and service directories
do not establish another ownership domain.

| Consumer | Logical durable data | Process-local data / coordination still required |
| --- | --- | --- |
| `SettingsStore` | `preferences.json`, unknown/plugin values | Kernel transaction, latest-file key patch, persisted revision; directory watcher, persisted-revision reconciliation, polling/focus resync in task 3 |
| Imported configuration | Personal `settings.bml` / selected read-only import; named copies import once | Generated native settings overlays in runtime root |
| Native persistent media | Personal `saves/` or its recorded contained subtree; generation-local `storage/<resource>/data` | Task 2 descriptors, inherited ownership, snapshot/flush barriers and initialization ledger |
| Managed checkpoints | Default `states/`; personal may select an external library | Named `states.root` is rebased and contained; original source recorded in generation metadata; publication/read/list/retention transactions; scoped facade exposes personal read-only and local writable references |
| Plugin registry | `plugins/enabled.json`, per-plugin storage and journals | Enablement/key patches and journal transactions use stable kernel locks; built artifacts are process-local |
| Paired recovery | `paired-recovery/`, plugin journals | Root transaction protects indexes, retention and journal reconciliation; native awaits run outside kernel locks |
| Workspace | `workspace.json` | Kernel transaction, latest-file reads, atomic whole-layout publication (last committed layout wins) |
| Artwork/catalog | `artwork/` | Process-local runtime cache in task 3 |
| App/native diagnostics | No authoritative profile store | Runtime `logs/`; application log identity equals service instance identity |
| Chromium/session storage | Never authoritative for shared preferences/workspace | Runtime `userData`, `browser/`; renderer reconstructs preferences and workspace from main |
| Launcher diagnostics | Existing bounded profile launch logs | Private UUID launch directories; checkout child installations are copied so parent cleanup/rebuild cannot break them |
| Endpoint credentials | Private service-directory files only | Never included in session manifests or recovery data |

Every process retains a private runtime directory under the namespace's
`instances/<UUID>`. Startup acquires a kernel lock before constructing data-root
consumers. Personal windows now share a lifecycle kernel lease; task 2 protects native
write paths and task 3 coordinates the remaining mutable stores. At the task 1 handoff, named game
loads failed closed until storage transactions landed; creating/opening an empty
named workspace is intentionally available for lifecycle validation.

Lifecycle locks live outside generation directories and keep stable inodes.
Creation publishes a durable intent, a complete generation, a session manifest,
then the registry entry. An interrupted unpublished generation is rebuilt from a
coordinated snapshot; publication is retryable. Published generations are never
reinitialized on ordinary reopen. Settings snapshots preserve arbitrary unknown
values, rebase owned state/configuration paths, and record the personal managed
state source separately. No personal game-save contents are read during creation.

The synchronous startup lock mode uses the native host's kernel lock and a
private, unlinked acknowledgement file. Startup cannot wait on child stdout
callbacks before Electron readiness. It bounds acquisition and release waits;
ordinary settings operations use the asynchronous helper. Neither mode relies on
PID metadata or deleting lock files for recovery. Task 2 retains lock
descriptors through native child exit, including the parent/helper crash cases,
so orphan writers cannot lose their ownership early.

Task 2 adds actual load descriptors and a recoverable resource initialization
ledger under each generation's `storage/`. `data.json.initialized` records private
resource identity/aliases and absence; `storage/groups.json` records game load
sets. `storage-routing.json` in the personal logical root remembers its effective
contained save subtree. Neither Electron runtime roots nor service directories
change resource ownership identity. Resource, lifecycle and snapshot-barrier
kernel descriptors are inherited into the actual native writer. See
[STORAGE-INVENTORY.md](STORAGE-INVENTORY.md) and task 2's implementation report for
native/open-time safeguards and validation limits. Task 3 replaces personal
exclusivity with shared lifecycle leases. A routing
change still requires exclusive personal ownership under the routing transaction;
a default launch reuses the recorded subtree. Both parent and native writer retain
the shared lease, so an orphan writer also prevents a routing change.


Task 3 store locks use stable hashed canonical-path identities under the private
`/tmp/ares-stores-v1-<uid>` directory. Lock files are never removed as stale;
kernel ownership recovers after process death. They sit outside store directories
so journal enumeration, recovery quotas and checkpoint listings are unchanged.
Settings retain their existing `.settings-locks` transaction namespace. Workspace
layouts are whole-document last-commit wins; loads always reread the latest file.
Plugin enablement patches preserve unrelated IDs/directories and unknown fields;
startup without an explicit plugin selection does not publish cached configuration.
Enablement changes affect other windows on their next initialization, while
preference values reconcile live according to each setting's apply timing.
Paired recovery keeps its existing per-plugin/version latest/previous retention
policy; file publication and cleanup serialize across windows. Native capture and
restore run outside the kernel transactions; restore rechecks its index before
journal/index publication. Managed personal checkpoint reads, publication,
rename/delete, listing and retention serialize. Task 4 adds the scoped overlay and journaled reset/restore lifecycle.

Task 4 keeps immutable displaced generations and recovery records under each
session directory. Reset/restore acquires the same exclusive lifecycle lock as
open before reading the active generation. `replacing.json` records the complete
replacement and displaced archive; replay publishes the archive and active
pointer without deleting either generation. Restore copies owned files only,
rejects symlinks, rebases owned preferences and pending initialization paths, and
archives displaced current data. No external personal folders are archived. See
[RECOVERY.md](RECOVERY.md) for layout and offline CLI/MCP recipes.
