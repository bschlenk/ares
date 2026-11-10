# Session data-root audit

Task 1 separates logical persistent data from Electron's per-process `userData`.
The personal logical root remains the existing profile directory, including
explicit `ARES_PROFILE_DIR`, `ARES_PROFILE` and embedding `userData` namespaces.
Management paths use the canonical root's hash; checkouts and service directories
do not establish another ownership domain.

| Consumer | Logical durable data | Process-local data / coordination still required |
| --- | --- | --- |
| `SettingsStore` | `preferences.json`, unknown/plugin values | Kernel transaction, latest-file key patch, persisted revision; cross-window reconciliation in task 3 |
| Imported configuration | Personal `settings.bml` / selected read-only import; named copies import once | Generated native settings overlays in runtime root |
| Native persistent media | Personal `saves/` or its recorded contained subtree; generation-local `storage/<resource>/data` | Task 2 descriptors, inherited ownership, snapshot/flush barriers and initialization ledger |
| Managed checkpoints | Default `states/`; personal may select an external library | Named `states.root` is rebased and contained; original source recorded in generation metadata; overlay/coordination in task 4 |
| Plugin registry | `plugins/enabled.json`, per-plugin storage and journals | Enablement patches, key storage, journal and paired-recovery transactions need process coordination before personal multiwindow |
| Paired recovery | `paired-recovery/`, plugin journals | Keep each generation's records together; cross-process personal namespace coordination required |
| Workspace | `workspace.json` | Whole-layout saves need serialization/latest-file reconciliation before personal multiwindow |
| Artwork/catalog | `artwork/` | Cache; can move to runtime or coordinate publication before personal multiwindow |
| App/native diagnostics | No authoritative profile store | Runtime `logs/`; application log identity equals service instance identity |
| Chromium/session storage | Never authoritative for shared preferences/workspace | Runtime `userData`, `browser/`; renderer reconstructs preferences and workspace from main |
| Launcher diagnostics | Existing bounded profile launch logs | Move to private launch runtime when multiwindow launch helpers land |
| Endpoint credentials | Private service-directory files only | Never included in session manifests or recovery data |

Every process retains a private runtime directory under the namespace's
`instances/<UUID>`. Startup acquires a kernel lock before constructing data-root
consumers. Personal roots remain exclusive until task 2 protects actual native
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
PID metadata or deleting lock files for recovery. Task 2 must retain the lock
holder through native child exit, including parent/helper crash tests, before
enabling simultaneous writers.

Task 2 adds actual load descriptors and a recoverable resource initialization
ledger under each generation's `storage/`. `data.json.initialized` records private
resource identity/aliases and absence; `storage/groups.json` records game load
sets. `storage-routing.json` in the personal logical root remembers its effective
contained save subtree. Neither Electron runtime roots nor service directories
change resource ownership identity. Resource, lifecycle and snapshot-barrier
kernel descriptors are inherited into the actual native writer. See
[STORAGE-INVENTORY.md](STORAGE-INVENTORY.md) and task 2's implementation report for
native/open-time safeguards and validation limits. Personal profile exclusivity
continues until task 3 coordinates the remaining shared stores.
