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
