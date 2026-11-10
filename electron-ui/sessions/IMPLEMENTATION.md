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
