# Session-management implementation evidence

Branch: `feat/session-management`. Planning source:
`docs/SESSION-MANAGEMENT-PLAN.md`, with the spec in the adjacent file authoritative.
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

Tasks 2–7 remain outstanding. Full `npm run accept`, packaged/Dock checks,
approval/revoke gameplay, capture pixels, all peripheral coverage, and the final
eleven-criterion acceptance map have not been run or claimed complete. Issue #37
remains open.
