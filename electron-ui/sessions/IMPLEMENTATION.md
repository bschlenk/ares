# Session-management implementation evidence

Branch: `feat/session-management`. Planning source:
[docs/session-management/README.md](../../docs/session-management/README.md), with
[the session-management spec](../../docs/SESSION-MANAGEMENT-SPEC.md) authoritative.
The pre-existing uncommitted planning documents and `.gitignore` change are not
part of implementation commits.

## Task 1 — Data model, paths, lifecycle

Implemented the personal data/runtime split, persistent UUID registry and
generations, recoverable first creation, private metadata validation, coordinated
settings/import snapshot, rebased owned paths, startup lifecycle ownership,
credential-free startup/readiness records and duplicate named-open resolution.
The shared launch helper constructs argument arrays for checkout/packaged apps,
clears inherited selection/private overrides, and waits for authenticated app
readiness without native inspection. A busy but unreachable owner is never
displaced; canceling an in-flight probe closes its connection immediately.
`--session-name NAME` is the explicit launch interface at this stage;
`--instance-name` retains its previous endpoint-label meaning until task 5.
Service and log identities now match the app instance UUID, without changing
native session/epoch identities. See [DATA-ROOT-AUDIT.md](DATA-ROOT-AUDIT.md).

Validated on macOS arm64, Node **24.22.0**, Electron **45.1.0**, working tree
based on `1712fae48925ff52ec810d09a87bb4e837ca98f1`. Exact commands:

```sh
# Repository root
cmake --build build_macos/workbench --target ares-electron-host -j 8
# electron-ui/
mise exec node@24.22.0 -- node scripts/build.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node --test tests/session-repository.test.js tests/settings.test.cjs tests/automatic-client.test.cjs tests/local-endpoint.test.cjs tests/profile.test.cjs tests/client.test.cjs tests/tool-registry.test.cjs
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/profile-live.cjs
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/session-context-live.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node node_modules/electron/cli.js tests/electron-settings.js
```

Results: native build and all three TS targets passed; **44/44** focused tests
passed with zero skips; `PROFILE_OWNERSHIP_PASS`, `SESSION_CONTEXT_PASS` and
`SETTINGS_UI_PASS`. Electron checks require desktop process access; sandboxed
profile checks timed out before startup. The first settings UI run exposed an
assertion at the former runtime-settings path; the assertion now uses the app
context, and the rerun passed. SIGKILL tests cover intent, generation, manifest
and registry publication boundaries, in addition to actual subprocess creation
and settings races. Fixtures use disposable data and generated media.

Task 1 does **not** enable personal multiwindow or named game execution. Native
storage inventory/prepare, lock retention through orphan native writers,
inheritance barriers and ledgers are task 2. Named game loads fail closed with
`session_storage_transactions_not_ready` until that protocol lands. Remaining
shared stores are still protected by exclusive personal-profile ownership.

At the task 1 handoff, tasks 2–7 remained outstanding. Full `npm run accept`, packaged/Dock checks,
approval/revoke gameplay, capture pixels, all peripheral coverage, and the final
eleven-criterion acceptance map have not been run or claimed complete. Issue #37
remains open.

## Task 2 — Actual storage ownership and inheritance

Implemented on `feat/session-management`, based on `972498009a2866a0cab8544f13c8ace4c4f18e3b`.
Implementation commit: **`164e91973`** (`feat(sessions): coordinate native storage ownership and inheritance`).

The [loader/write-path inventory](STORAGE-INVENTORY.md) covers the active MIA
helpers, direct runtime writes, shared peripherals and VFS modes. Optional MIA
hooks retain upstream path calculation. `--prepare-storage` runs the selected
loader, configured peripherals and companion media, then its full save/unload
path, with persistence reads substituted by absence and writes inventoried. It
creates no save/system directories and never reads personal save bytes. Imported
BML and the generated overlay are frozen together for prepare and actual load.
Writable WAV decoding/encoding uses memory buffers; converted tape formats overlay
their persisted WAV output. Read-only media/firmware keep their original loaders.

Electron reserves the complete resolved destination set under a short namespace
lock before stopping the old game. A same-instance replacement publishes its new
reservation while retaining the old one, avoiding an unlock/relock gap. Canonical
existing ancestors cover absent files and symlinks; existing device/inode identity
covers hard links. macOS volume capabilities determine case-sensitive identity,
including absent resources. Private mapping persists observed aliases, preserving
initialized data when an original hard-link name disappears. Whole-directory
claims participate in overlap checks; current native inventory uses individual
files, and directory inheritance fails closed until a directory consumer exists.

Coordination uses stable kernel-lock inodes under `/tmp/ares-storage-v1-<uid>`
(canonicalized on macOS), outside service and profile namespaces. A claim's JSON
contains instance/game descriptions, never lock authority or endpoint credentials.
Stale claim metadata is removed only after successful kernel acquisition; lock
inodes are never deleted. Each helper shares an open file description with its
parent. Electron passes resource and profile/session lifecycle descriptors into
the native writer; helper or Electron death cannot release them while an orphan
can still save. Native directory-relative opens refuse symlinks and changed
inodes; personal opens also revalidate the original path alias. Unprepared
persistence reads/writes fail closed. There is no unlocked native fallback within
an Electron game launch. The low-level host's existing standalone fixture mode
without `--storage-transaction` remains available; it is not a personal/named
window launch interface.

All loader save/unload groups, nested MIA saves and direct writes use a short
exclusive flush barrier. Named initialization uses a shared snapshot barrier on
the same stable inode, while personal lifetime ownership remains held. The
barrier is deliberately global/coarse: disjoint runtimes play concurrently, but
their short disk flushes serialize. No personal pause or forced in-memory flush is
needed. Copies stage and fsync all resources before publishing a durable intent;
recovery rolls complete staging forward before allowing runtime reads. The ledger
records absence, persisted generation policy, shared resources and observed path
aliases independently of game/ROM identity. Game resource groups are recorded
separately. Cancellation before publication leaves initialization retryable.
Personal save-subtree overrides are recorded as contained relative routing in
`storage-routing.json`, so named preparation uses the effective personal source.

Named game execution is now enabled through this transaction. Exclusive personal
profile ownership remains in place for task 3's remaining stores. New Window,
shared-store reconciliation, managed-library overlay/reset/restore, target
selection, approval/revoke and final presentation remain gated by tasks 3–7.
The initial renderer startup now rechecks its queued fallback so it cannot replace
a service-loaded game while storage preparation is in progress.

### Validation — 2026-11-10, macOS arm64

Node **24.22.0**, Electron **45.1.0**. All fixtures use disposable roots and original
generated media, never personal saves. Exact principal commands:

```sh
# Repository root, initial build and final acceptance binary rebuild
cmake --build build_macos/workbench --target ares-electron-host -j 8
cmake --build build-electron-acceptance --target ares-electron-host -j 8
# electron-ui/
mise exec node@24.22.0 -- node scripts/build.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build-electron-acceptance/bin/ares-electron-host mise exec node@24.22.0 -- node --test tests/session-storage.test.js tests/session-repository.test.js tests/settings.test.cjs tests/profile.test.cjs tests/upstream-merge.test.js
mise exec node@24.22.0 -- npm run accept
```

Native builds and all three TypeScript targets pass. Final focused run: **42/42
passed, zero skips**, including **22 storage tests**. Tests cover subprocess races,
same/disjoint sets, symlink/hard-link/absent paths, directory overlap, volume case
rules, same-instance replacement, shared resources across games, same basenames
at different sources, initialized absence, fresh policy, source-subtree routing,
cancellation, and SIGKILL at staging/intent/individual publication/ledger boundaries.
They verify grouped snapshot versus a deliberately delayed multi-file write;
helper/native/parent death independently; an orphan retaining lifecycle ownership
through final flush; path replacement/unprepared opens; PlayStation shared
expansion EEPROM plus metadata/card paths; N64 controller/transfer paks, EEPROM,
RTC and companion Game Boy persistence; and writable WAV private loading.

Full acceptance run `artifacts/acceptance/run-ynzGhW` passed configuration, native
build, TypeScript, **316 fixture tests with zero skips**, native smoke,
`electron-local-ai`, `electron-session` and `electron-shutdown`. It **failed** at
`electron-mcp`: the pre-existing expected tool list omits eight already registered
tools. A diagnostic rerun temporarily correcting that assertion reached another
stale expectation (`movie.frame_kind` expects `unavailable`, current generic GB
capture returns `primary-screen-frame`). The unrelated test edits were reverted;
no tools/capture behavior was changed for this task. Later full acceptance gates,
including packaging, were not reached. Full acceptance is **not** claimed green.
Final focused tests/builds above include subsequent path revalidation and routing
hardening and the converted-tape overlay correction beyond that full run.

Desktop-specific checks require process access outside the sandbox. A sandboxed
session-context run timed out before startup; with desktop access it passed.
The seven final separate desktop checks below all passed. Supported
peripheral paths are audited, with generated native fixtures for PS1, N64 and ZX
Spectrum; exhaustive gameplay/recording fixtures for every core/peripheral,
case-sensitive APFS, other OS/filesystems, packaged/Dock/manual checks and the
final eleven-criterion acceptance map remain unrun. This task does not complete
issue #37.


Final desktop commands (from `electron-ui/`, each prefixed with
`ARES_HOST=/Users/bschlenk/Developer/forks/ares/build-electron-acceptance/bin/ares-electron-host mise exec node@24.22.0 --`):

```sh
node tests/profile-live.cjs
node tests/session-context-live.js
node tests/session-storage-live.js
node node_modules/electron/cli.js tests/electron-settings.js
node node_modules/electron/cli.js tests/electron-checkpoints.js
node node_modules/electron/cli.js tests/electron-reload.js
node node_modules/electron/cli.js tests/electron-recovery.js --disable-plugins
```

All seven exited **0**. `SESSION_STORAGE_PASS` verifies a personal window and two
named sessions running the same original battery cartridge, independent actual
save bytes, and persistent reopen advancing only the selected named session.
Settings, checkpoint final-save/switch, renderer reload and paired recovery
regressions also pass. Personal profile exclusion remains covered by
`PROFILE_OWNERSHIP_PASS`. Logs were captured at `/tmp/ares-task2-{profile,context,
storage,settings,checkpoints,reload,recovery}.log`; final focused test output is
`/tmp/ares-task2-focused.log`. The fixtures and runtime roots were cleaned after
each check. Repository `git diff --check` passes.

## Task 3 — Personal windows and shared settings

Implementation commit: **`9be56e5f1`**
(`feat(sessions): coordinate personal windows and shared settings`).

Implemented on `feat/session-management`, based on `d607ab7f1794db9b0db93e869291d5d2c228dbc3`.

File → New Window (`CmdOrCtrl+N`) launches a personal process from either context,
with a fresh app instance/runtime and the same canonical personal data root.
The shared argument-array launcher removes inherited named selection, ROM,
settings/private-save overrides and development-session replay. Packaged launches
use the app executable; checkout launches copy compiled UI/native resources into
a private launch directory, so parent snapshot cleanup and checkout rebuilds do
not break the new window. Plugin source/dependency links resolve to their stable
canonical source directories. Launch logs and these runtime copies live under
the personal namespace's UUID `launches/` directories, not shared profile logs.
They currently remain as runtime caches; no new automatic deletion policy is
introduced. Each process retains its own Dock activation behavior; packaged Dock
interaction is still a manual release check.

Personal lifecycle ownership is now a shared kernel lease inherited by the native
writer. The routing transaction reads the recorded contained save subtree before
selecting defaults. Changing that subtree requires exclusive personal ownership;
a concurrent/custom-root game, including an orphan native writer, prevents a
redirect. Task 2's actual resource ownership continues to arbitrate game loads
before stopping the current game. Diagnostics use per-instance runtime records;
PID records still do not establish ownership.

Settings continue to read latest values and patch/reset one key under their kernel
transaction, preserve unknown values, validate/refuse malformed files and publish
persisted revisions atomically. After releasing the lock, every changed live
setting is applied locally, including unrelated changes learned during a write.
A directory watcher, periodic resync (two seconds), focus resync and initial resync
reconcile revisions and values. Next-ROM/restart entries remain pending until
acknowledged by their existing lifecycle. No startup/shutdown preference write is
introduced. A transport guard reaches external provenance setting commits, so a
disconnected queued request cannot publish. The settings transaction rechecks the
supplied guard after lock acquisition; task 6 must add window-wide grant generation
checks across the complete external boundary, cancellation and revocation.

The [data-root audit](DATA-ROOT-AUDIT.md) now accounts for the remaining writers:
plugin configuration uses latest-file ID/directory patches and preserves unknown
fields, ordinary startup does not republish cached enablement, and explicit
recovery reset can still replace malformed plugin configuration. Plugin key
storage and journals serialize latest-file patches; workspace saves serialize
whole layouts with latest-file reads; personal checkpoint publication/read,
rename/delete and retention coordinate across processes. Paired-recovery index,
retention and journal publication coordinate without holding kernel locks across
native awaits, and restore checks its index again before final publication.
Artwork and built plugin artifacts use process-local caches, preventing another
window's pruning from removing a live artifact. Generic store locks use stable
canonical-path hashes outside the stores under `/tmp/ares-stores-v1-<uid>`.

### Validation — 2026-11-10, macOS arm64

Node **24.22.0**, Electron **45.1.0**. Disposable roots, private service directories
and generated cartridges only. Principal commands (repository root first,
then `electron-ui/`):

```sh
cmake --build build_macos/workbench --target ares-electron-host -j 8
mise exec node@24.22.0 -- node scripts/build.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node --test tests/personal-windows.test.js tests/settings.test.cjs tests/workspace.test.cjs tests/session-repository.test.js tests/session-storage.test.js tests/plugin-journal.test.js tests/checkpoint-library.test.js tests/paired-recovery.test.js tests/plugins.test.cjs tests/plugin-recovery.test.cjs tests/local-endpoint.test.cjs
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/personal-windows-live.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/profile-live.cjs
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/session-context-live.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/session-storage-live.js
ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host mise exec node@24.22.0 -- node tests/launch-live.cjs
mise exec node@24.22.0 -- npm run accept
```

The same `ARES_HOST` and pinned `mise exec` prefix were used with
`./node_modules/.bin/electron tests/<file>` separately for `electron-settings.js`,
`electron-journal.js`, `electron-plugins.js`, `electron-reload.js`,
`electron-workspace.js` and `electron-plugin-settings.js`.

Native and all three TypeScript builds pass. Final focused run: **81/81 passed,
zero skips**. Coverage includes subprocess disjoint/same-key settings writes,
unknown values, polling with an unavailable watcher, next-ROM/restart semantics,
no startup/shutdown writes, authorization after lock wait, disconnected queued
external writes, canonical routing leases, concurrent plugin configuration/key
patches, journal sequences, workspace publication and native-await lock freedom.
The existing storage race, alias, crash and peripheral suite also passes against
the rebuilt binary (task 2's inventory/coverage limits still apply).

The multiwindow desktop test passes from named-only startup, creating two personal
windows, checking distinct instances/browser roots, shared live native settings,
independent named settings, disjoint games, conflict refusal without replacing the
current game, unload/reacquire, preserved custom routing and actual saves, and
child operation after deleting the parent's temporary installation. The suite is
registered in `scripts/accept.js` and exposed as `test:personal-windows`.

Separate desktop checks passed: `PERSONAL_WINDOWS_PASS`,
`PROFILE_OWNERSHIP_PASS`, `SESSION_CONTEXT_PASS`, `SESSION_STORAGE_PASS`,
`ISOLATED_LAUNCH_PASS`, `SETTINGS_UI_PASS`, `PLUGIN_JOURNAL_PASS`,
`PLUGIN_UI_PASS`, `PLUGIN_RELOAD_PASS`, `WORKSPACE_PASS` and
`PLUGIN_SETTINGS_PASS`. The plugin artifact-pruning test now uses the runtime
cache location; affected tests select short private service directories. Desktop
Electron cannot start in this sandbox (the initial attempt aborted with SIGABRT);
the passing runs used desktop process access. An early plugin UI invocation had
an overlong Unix socket path and did not reach its pass marker; the short-path
rerun did.

Full run `artifacts/acceptance/run-6uKFuz` passed configuration/native/TypeScript
builds, **329 fixture tests with zero skips**, native smoke, `electron-local-ai`,
`electron-session` and `electron-shutdown`. It failed at
`tests/electron-mcp.js:44`, the previously recorded stale exact tool-list
expectation (for example it omits current input, renderer and video tools).
Later full-suite gates, including the newly registered personal-window gate,
were not reached; separate checks above provide their task-specific evidence.
This is not a green full acceptance result. Its summary records baseline
`d607ab7f1794db9b0db93e869291d5d2c228dbc3` with dirty task-3 changes. The final
focused run also covers the explicit same-key subprocess race added to that test
before commit.

Earlier full run `run-v9CJEO` reported 327/328 fixture passes and caught this
change's malformed-plugin-reset regression. The explicit reset repair was fixed,
its focused test passed, and the second full fixture lane passed. Initial focused
attempts with an unset/stale host failed; rebuilding and selecting `ARES_HOST`
fixed those. A focused run overlapping the acceptance TypeScript rebuild saw a
transient missing `dist` import; the final 81-test run ran after compilation and
passed. These earlier failures are not counted as passes.

Packaged/Dock hover/activation, physical input, other operating systems, final
approval/revocation gameplay and banner/capture pixel acceptance were not run for
this milestone. Packaged argument construction has unit coverage; it does not
substitute for packaged New Window/Dock acceptance. The full MCP assertion and
remaining task-4–7 acceptance are still outstanding.

Task 3 contributes to spec criteria 1–2 and preserves criteria 3–5. Managed named
state overlay/reset/restore is task 4. Scoped discovery/selection, approval/revoke,
and final titles/banner/capture behavior remain tasks 5–7. No new automatic target
selection, authorization grant or claim of full issue #37 acceptance is introduced.

## Task 4 — Managed states and recovery

Implemented on `feat/session-management`, based on
`13a03a0cb14ea31102eb2164503c8ccab735e880`. Implementation commit:
**`e89674814`** (`feat(sessions): add managed state overlays and recoverable reset`).
See [the task handoff](../../docs/session-management/04-managed-states-recovery.md).

`ScopedCheckpointLibrary` exposes writable local and inherited personal entries
with explicit origin, writable status and source-qualified references. Timestamp
collisions cannot redirect inherited rename/delete to the writable library.
Personal windows enumerate only their personal library. Backend retention touches
only the local library; verified personal reads and listings use the same kernel
transaction as publication/retention, with immutable bytes retained after read.
The browser labels origins, disables inherited mutation controls and uses only
local autosaves for Continue. Existing checksum, ROM and configuration checks
remain; file-based N64 state tools and explicit imports/exports are unchanged.

Five managed-library tools add paged listing, explicit load, save, rename and
local deletion. They route native transfers through their connection/lease owner
and recheck liveness throughout the operation. Three offline lifecycle tools
provide archive listing, reset and restore without launching an app or requiring
its service endpoint. See [recipes and storage layout](RECOVERY.md). Selection
and personal authorization/revocation remain tasks 5–6.

Whole-session replacement acquires the exclusive lifecycle lock before selecting
data, refusing a running or orphan-native-owned session even without services.
Fresh clone snapshots current personal preferences/BML and clears initialization;
Start empty omits personal BML and persists the `fresh` policy. Both retain the
explicit personal checkpoint source. A complete synced generation precedes the
replacement journal; archive bookkeeping and the active manifest are atomically
published and replayable at open/reset/restore. Displaced generations never move
or disappear. Restore copies a selected archive into a new generation, rebases
owned settings and pending storage journal paths, and archives the displaced
current generation. It does not follow symlinks or traverse referenced external
personal directories. Interrupted pre-intent staging may leave an unreferenced
generation, while active data stays intact. No automatic permanent deletion was
added. Settings → Sessions makes both reset modes and Restore previous data
available for existing sessions; name creation remains CLI/MCP-only.

Validation uses generated media/disposable roots, macOS arm64, Node **24.22.0**
and Electron **45.1.0**. Final focused commands from the repository root:

```sh
mise exec node@24.22.0 -- node electron-ui/scripts/build.js
ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec node@24.22.0 -- node --test electron-ui/tests/session-recovery.test.js electron-ui/tests/session-repository.test.js electron-ui/tests/checkpoint-library.test.js electron-ui/tests/session-storage.test.js electron-ui/tests/local-endpoint.test.cjs electron-ui/tests/tool-registry.test.cjs electron-ui/tests/schema-parity.test.cjs
ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec node@24.22.0 -- node electron-ui/node_modules/electron/cli.js electron-ui/tests/electron-session-recovery.js
ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec node@24.22.0 -- node electron-ui/node_modules/electron/cli.js electron-ui/tests/electron-session-recovery.js --no-services-test
ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec node@24.22.0 -- node electron-ui/node_modules/electron/cli.js electron-ui/tests/electron-checkpoints.js
# Full lane, from electron-ui/
mise exec node@24.22.0 -- npm run accept
```

All three TypeScript targets and **60 focused tests** passed with zero skips.
Task 4 adds nine focused cases including source collisions, personal immutability,
local retention, verified bytes after subprocess deletion, compatibility failures,
SIGKILL at four reset and four restore boundaries, services-independent lifecycle
refusal, persistent fresh/inherit policy for different resources after reopen,
restored custom roots and interrupted storage journals, symlink rejection,
external native transfer ownership/liveness, and actual offline CLI calls.
Existing native alias, peripheral, inheritance and orphan-writer coverage remains
passing; its supported inventory limits are unchanged from task 2.

Separate desktop passes: `SESSION_RECOVERY_UI_PASS`,
`SESSION_RECOVERY_NO_SERVICES_PASS`, and `CHECKPOINT_UI_PASS`. The first uses a real
native capture with identical personal/local timestamp IDs, explicitly loads the
personal source through the shared tool registry, rejects inherited mutations,
checks origin controls and performs closed-session reset/restore through renderer
IPC. The second uses a real named native window with no endpoints and refuses
both reset modes and restore. Screenshots in `artifacts/session-recovery/` were
visually inspected. The new desktop cases are registered in `scripts/accept.js`.
Sandboxed Electron aborted before startup; passing checks used desktop access.

The first full run, `artifacts/acceptance/run-6SfnFB`, passed native and TypeScript
builds but reported **334/337 fixture passes**. New tool registration required
updating the schema parity report and explicit additions. Two unrelated fixture
failures were transient adapter/app identity mismatches caused by overlapping a
local rebuild with the full run. That overlap was stopped; no rebuilds overlapped
the rerun. The MCP exact inventory expectation was also updated for these eight
new tools and eight already-existing tools omitted by the previously stale test.
No schemas or assertions were weakened. Final full-run results follow below.

Final full run `artifacts/acceptance/run-mz2PPL` passed native/TypeScript builds,
**338/338 fixture tests with zero skips**, native smoke, `electron-local-ai`,
`electron-session`, and `electron-shutdown`. The corrected MCP inventory passed;
that test then failed at `tests/electron-mcp.js:101`, another pre-existing stale
expectation: Game Boy recording now returns `primary-screen-frame`, while the
assertion expects `unavailable`. The non-N64 primary-screen clock is documented
in `services/CORE-CONTROL.md` and is unrelated to session recovery. Later gates,
including the newly registered recovery gates, were not reached in the full run;
the separate desktop passes above cover this task. Full acceptance is **not
green**. The summary records baseline `13a03a0cb14ea31102eb2164503c8ccab735e880`
with dirty task-4 changes. Earlier unset-host focused checks failed before lock
startup; selecting the rebuilt host corrected them. A first recovery fixture
assertion compared macOS `/var` against canonical `/private/var`; fixing the
fixture path made it pass. A first managed tool call accidentally spread status
fields into management params; it now sends only the native identity.

Task 4 covers spec criteria **6–7** within this milestone, preserving the earlier
storage/settings checks. Packaged/Dock behavior, physical input, final
approval/revoke gameplay, banner/capture pixel checks, other platforms and the
final eleven-criterion feature acceptance remain unrun/manual. No personal user
saves were read or changed. Tasks **5–7** and issue #37 remain open. Task 5 should
reuse the offline lifecycle methods and scoped managed tools when introducing
request-local target selection and binding namespace/instance identity.

The two recovery desktop commands were also rerun after full acceptance, with
`ARES_HOST="$PWD/build-electron-acceptance/bin/ares-electron-host"` and the final
compiled UI. Both pass markers were produced again. The older workbench-host
checkpoint UI pass remains relevant: no native sources changed in this task.

## Task 5 — discovery and scoped selection

Implementation commit: **`3f358202e`**.

Implementation extends the task 1 launch/readiness helpers and task 4 lifecycle
repository. The shared public CLI/MCP registry now exposes persisted/live session
listing, runtime named open/select, scoped recovery operations and optional opaque
`target` selectors on target-dependent tools. A returned name selector can reopen
its storage; returned instance selectors pin a UUID and never choose replacements.
`ARES_TARGET` and immutable MCP startup selectors avoid a machine-global current
session. Legacy `ARES_INSTANCE_NAME` / `--instance-name` retain endpoint-label
semantics, including fresh explicit legacy-name reconnects without mutation replay.

Discovery uses typed authenticated `app_status` metadata, independent of native
identity: kind, UUID, persistent ID/name, namespace-locked monotonic open order,
cached game title/system/playback state, readiness and approval state. It neither
launches nor reads native gameplay. Name-claim liveness uses the same probe.
Default calls choose the earliest personal window and ignore named windows; when
none exists, automatic startup opens personal storage. Explicit named open uses
persistent isolated storage and implicit authorization.

The bounded pool holds eight target clients. Every entry has independent tool
caches, request-local native identities and cancellation context; active calls
cannot be evicted. Socket reply callbacks update connection state, while the
awaiting request updates its own identity scope. This distinction is necessary
because a socket listener retains the async context in which it was installed.
Scoped `operation_ref`, `handle_ref`, `lease_ref` and `result_ref` companions retain
the initial target, and native identity for operations/captures; legacy raw IDs
remain available. Scoped references reject another target, and operation/capture
references reject changed native identity. Lease/result references can survive
native game changes according to their existing lifetime rules. Explicit leases
remain necessary for durable resources across short CLI processes.

Personal protected external requests are closed at the authenticated local
boundary with `access_required`. Cached personal watchdog observations contain
only minimal instance/approval information. This gate does not affect internal UI
or plugin/native ownership. `access_request/status/wait` report
`approval_controller_pending`; no prompt, grant, delayed command or authorization
bypass is exposed before task 6. Task 6 must replace this gate with the real
window-wide grant controller and guard queued/in-flight work and all owners.
Task 7 still owns presentation/capture acceptance. Issue #37 remains open.

Validation commands and final outcomes are recorded below after the final run.

Validation environment: macOS arm64, Node 24.22.0, Electron 45.1.0. Commands ran
on base `930ee0213` plus the task 5 working tree; implementation/handoff commits
are recorded in `docs/session-management/README.md`. Native source is unchanged
by task 5. The full lane nevertheless configures/builds its own native host.

- `mise exec node@24.22.0 -- node electron-ui/scripts/build.js` — passed all
  three TypeScript targets and generated build/schema provenance.
- `ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec
  node@24.22.0 -- node --test electron-ui/tests/session-selection.test.js` —
  **9 passed**, zero failures/skips, on the final source. Includes subprocess
  open sequence races, two callers, request-local identity, real native
  cancellation isolation, scoped lease/epoch rejection, stopped-name recovery,
  personal denial, and cached-health personal-default selection. Nested batch
  references retain their own epoch, rather than the batch's final epoch.
- The expanded selection/automatic-client/tool-registry/schema-parity run passed
  **16 tests**. The recovery/selection/tool-registry/parity run passed **20**;
  the native batch/signals/selection regression command passed **10**. These
  overlap; their counts must not be added. The final full fixture lane includes
  these suites. The schema report records 134 public tools, no missing reference
  tools, and intentional optional-target differences on all 68 frozen FastMCP
  reference signatures. Raw ID compatibility is retained alongside scoped refs.
- With desktop access, and the same `ARES_HOST` prefix, the final frozen source
  separately passed:
  `mise exec node@24.22.0 -- electron-ui/node_modules/.bin/electron electron-ui/tests/electron-session-selection.js`
  (`SESSION_SELECTION_NAMED_PASS`), the same command with `--personal-test`
  (`SESSION_SELECTION_PERSONAL_PASS`), and
  `mise exec node@24.22.0 -- node electron-ui/tests/session-selection-live.js`
  (`SESSION_SELECTION_LIVE_PASS`). These cover real generated-ROM load/status/
  close, empty-app discovery, personal refusal, runtime named open/reuse, two
  targets through one MCP adapter, CLI exported handles, and automatic personal
  startup when only named windows exist.
- `ARES_HOST=... mise exec node@24.22.0 -- electron-ui/node_modules/.bin/electron
  electron-ui/tests/electron-mcp.js` — updated inventory/schema assertions pass;
  execution reaches the pre-existing Game Boy video-clock assertion (now line
  103), actual `primary-screen-frame`, expected `unavailable`.

Sandboxed Electron startup aborted before app initialization; desktop checks above
were rerun with desktop process access. Exploratory full runs `run-VFfl1k` and
`run-EB1J7r` found compatibility/fixture issues during implementation and are
superseded by the final run. Superseded/interrupted runs `run-pS1lcJ` and
`run-sFLAK0` are not acceptance passes. No private ROMs or personal saves were
used. Packaged/Dock checks, actual approvals/revocation and task 7 capture pixels
remain unrun for this milestone.

The overlapping focused commands above used these explicit test paths (with the
same pinned Node and `ARES_HOST` prefix):

```sh
node --test electron-ui/tests/session-selection.test.js electron-ui/tests/automatic-client.test.cjs electron-ui/tests/tool-registry.test.cjs electron-ui/tests/schema-parity.test.cjs
node --test electron-ui/tests/session-selection.test.js electron-ui/tests/tool-registry.test.cjs electron-ui/tests/session-recovery.test.js electron-ui/tests/schema-parity.test.cjs
node --test electron-ui/tests/signals-live.test.cjs electron-ui/tests/batch-live.test.cjs electron-ui/tests/session-selection.test.js
```

Final full command (from `electron-ui/`, with desktop process access):
`mise exec node@24.22.0 -- npm run accept`.
[Final summary](../artifacts/acceptance/run-oHmuAx/summary.json) and
[fixture log](../artifacts/acceptance/run-oHmuAx/fixture-regressions.log): configure,
native build and TypeScript passed; **347 fixture tests, 346 passed, 1 failed,
zero skipped/cancelled**. The only failure is the unchanged paired-recovery
scheduler timing assertion at `tests/paired-recovery.test.js:105`: `input_active`
remained visible when the test expected `undefined`. All nine new selection tests
and all updated compatibility/schema fixtures passed within this full run.
The exact isolated rerun
`ARES_HOST="$PWD/build_macos/workbench/bin/ares-electron-host" mise exec node@24.22.0 -- node --test --test-name-pattern='scheduled recovery reports' electron-ui/tests/paired-recovery.test.js`
passed (1 test). No scheduler implementation/test was changed for task 5.

The final full command stops at that fixture failure, so its native-smoke,
Electron, launch and packaged gates are **unrun**, not passes. The three task 5
desktop checks were run separately and passed as recorded above. The separate
existing MCP desktop check still fails at its previously documented Game Boy
video-clock expectation. These limits prevent claiming full spec acceptance.


## Task 6 — personal approval, cancellation and native revocation

Implemented on `feat/session-management` after `25c02f655` (task commit recorded in
the completion handoff). The main-owned `ExternalAccessController` keeps grants
only in memory, deduplicates one nonmodal prompt for up to 32 bounded requesters,
and carries a monotonically increasing grant guard through local transport,
queued lifecycle/settings/checkpoint operations, native dispatch and artifact
publication. Short explicit requests survive socket close until their deadline;
waiters detach on cancel/disconnect. CLI `--wait-access` retains intent locally.
MCP adds real access tools, including `access_cancel`, without global selection.

Revoke synchronously closes the gate and invalidates leases, drains focus-pause
continuations, acknowledges an aggregate native external-owner cleanup, drains
main lifecycle work and checks the current host again. The native barrier stops
scripts and batch children, releases observers/recordings/input/state transfers,
clears external held inputs and pauses. Detached input demonstration owners keep
external classification. Background guards reject old generations even after
reapproval. An aborted native start is cancelled by its exact operation ID when
its acknowledgement arrives; cancellation/expiry cannot silently leave it running.
Native cleanup bypasses contention and the revoked external grant. An unresponsive
host follows the existing terminate-on-native-failure path, and failed cleanup
leaves the access state `revoking` rather than reporting success.

Human UI/plugin owners are separate and preserved (the native regression keeps a
human-owned observer alive). Because renderer plugin commands reuse their human
SDK callback closure, external `add/enable/reload/resetStartup/open/command`
management in personal windows is deliberately still closed with
`plugin_management_requires_named_session`. Named sessions retain that interface.
This is a documented compatibility limit; per-invocation renderer plugin
provenance has not been implemented. Named instances always provide their
implicitly authorized service despite a copied disabled personal integration
setting. Session identity, epochs, storage ownership and contention remain enforced.

Validation uses generated media and disposable profile/service/save roots only:

- Repository root: `cmake --build build_macos/workbench --target ares-electron-host -j 8`
  — passed with the modified native barrier.
- `electron-ui/`: `mise exec node@24.22.0 -- node scripts/build.js`
  — all three TypeScript targets, preload bundling and SDK/build metadata passed.
- `electron-ui/`, with `ARES_HOST=/Users/bschlenk/Developer/forks/ares/build_macos/workbench/bin/ares-electron-host`:
  `mise exec node@24.22.0 -- node --test tests/external-access.test.js tests/external-access-native.test.js tests/session-selection.test.js tests/focus-pause.test.js tests/local-endpoint.test.cjs tests/client.test.cjs tests/batches.test.cjs tests/artifacts.test.cjs tests/plugin-settings.test.cjs tests/checkpoint-library.test.js tests/schema-parity.test.cjs`
  — **60/60 passed**, no skips. Covers bounded requesters, Deny/cancel/expiry,
  reconnect/nonreplay, late artifact publication across a new grant, failed barriers,
  queued management cancellation, cancelled-start acknowledgements, disconnected
  leases, scripts/batch children/observers/recordings, human owner preservation,
  target concurrency, settings/checkpoint guards and schema inventory.
- The additional native/script/observer lane passed 16/17 under the sandbox;
  `batch-live.test.cjs` reported `renderer_unavailable`. Its exact separate rerun,
  `ARES_HOST=... mise exec node@24.22.0 -- node --test tests/batch-live.test.cjs`,
  with desktop/graphics access passed **1/1**, including real N64 input preparation,
  detached demonstration, baseline/load/write/run/crop and revocation. The sandbox
  failure is not counted as a pass.
- Independent desktop runs (same `ARES_HOST`, `mise exec node@24.22.0 -- npx electron`):
  `tests/electron-session-selection.js`, the same file with `--personal-test`,
  the same file with `--disabled-named-test`, and `tests/electron-external-access.js`
  all passed. The access check exercises pending gameplay progression, a nonmodal
  renderer Allow/Deny prompt, window-wide short-client approval, reload survival,
  a disconnected durable input lease, post-barrier paused/frame stability,
  native bounded execution, expired lease rejection after reapproval, MCP waiter
  abort, and actual CLI `--wait-access` cancel/allow. A cancelled CLI ROM load is
  proven absent after a subsequent Allow. The named-disabled fixture writes an
  actual disabled personal preference and starts without `--services`.
  Initial sandboxed Electron startup SIGABRT required rerunning with desktop access.

The first full `mise exec node@24.22.0 -- npm run accept` run,
[run-kyGeKd](../artifacts/acceptance/run-kyGeKd/summary.json), passed configure,
native/TypeScript build, **351/351 fixtures**, native smoke, electron-local-ai,
electron-session and electron-shutdown. It stopped at the unchanged MCP Game Boy
video-clock assertion at `tests/electron-mcp.js:103` (`primary-screen-frame` versus
`unavailable`). Later gates in that full run were unrun. The final focused 60-test
run above additionally includes the cancellation-acknowledgement regression added
after those first full-run fixture workers started.

Final full command, with no overlapping rebuilds:
`mise exec node@24.22.0 -- npm run accept` (desktop access).
[run-nH9w7f summary](../artifacts/acceptance/run-nH9w7f/summary.json) and
[fixture log](../artifacts/acceptance/run-nH9w7f/fixture-regressions.log) record
**352/352 fixtures passed**, zero failures/skips/cancellations, followed by passing
native smoke, electron-local-ai, electron-session and electron-shutdown. The run
then stops at the same unchanged MCP assertion at line 103. All subsequent gates
(including the new access desktop gates) are unrun within that full command;
the separate access/selection desktop passes above provide their evidence.
The final access desktop check also holds the actual personal preferences lock,
queues a provenance settings write, revokes, releases the lock and verifies that
the preferences file remains byte-identical.

An intermediate full run, `run-w4tbRS`, is invalidated by an overlapping rebuild
that removed `dist` while five workers imported modules (five missing-module
failures); it also hit the previously documented recovery-scheduler timing
assertion. Its 329/335 fixture result is not a pass. The final clean run above
supersedes it. An initial focused invocation without the rebuilt `ARES_HOST`
selected a stale lock helper, and initially exposed the cancellation-polling
regression fixed before the final focused and full runs.

Required new access
fixture tests are automatically in the fixture lane; explicit access and inherited
integration-disabled desktop gates were also added to `scripts/accept.js`.
Packaged/manual Dock, physical controller interaction with a pending nonmodal
prompt, title/banner/capture pixel evidence and full spec acceptance are **not
claimed**. Task 7 remains next; issue #37 remains open.
