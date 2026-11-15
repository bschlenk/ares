# Shared delivery and acceptance requirements

Read [the shared preamble](README.md) first. Execute tasks **1–7 in their numbered
order**, as requested by the repository owner, and commit after each task.

The following six stages are the original review/acceptance groupings. They are
not additional numbered tasks or a different execution order. Stage 3 maps to
task 4, stage 4 maps to task 3, stage 5 combines tasks 5 and 6, and stage 6 maps to
task 7. Do not expose a milestone as full spec completion until all dependencies
and acceptance cases are covered.

| Stage | Scope | Required evidence |
| --- | --- | --- |
| 1. Context and repository | Data/runtime split, registry, lifecycle locks, settings snapshot/rebasing, create/open | Concurrent create/open, persistent reopen, legacy personal paths unchanged, isolated profile fixtures |
| 2. Storage transactions | Native inventory/prepare, resource locks, snapshot barriers, private mapping, initialization ledger | Real save-path collisions, peripherals/shared resources, parent/child crash recovery, consistent copying and absence tracking |
| 3. Named data lifecycle | Managed-library overlay, reset policies, archive/list/restore | Personal entries immutable through session operations, local retention, crash-injected reset/restore, displaced data retained |
| 4. Personal multiwindow | Per-process runtime roots, New Window, shared settings/store coordination | Several personal windows from named-only startup, lost-update races, ownership failures without replacing another game |
| 5. External access | Typed discovery, target handles, CLI/MCP selection, approval, cancellation/revoke | Default order, shared-adapter concurrency, no preapproval reads, no delayed execution, complete owner cleanup |
| 6. Presentation and release checks | Persistent titles/banners, capture exclusion, packaged Dock checks, docs | Reload/ROM/empty views, auto-hide/Revoke accessibility, pixel checks, packaged manual evidence |

Storage stages 1–3 depend on parts of the settings coordination in stage 4;
implement the reusable settings transaction primitive in stage 1. Discovery
contracts and the access controller can be developed earlier, but enabling broad
personal multiwindow/external access waits for storage and revocation guarantees.

Automated coverage should include:

- Subprocess races, not only mocked or same-process unit tests: same named open,
  open versus reset/restore, same and disjoint save resource sets, symlink aliases,
  hard links, absent paths, shared peripherals, and unload/reload. Assert actual
  save contents and lock ownership after SIGKILL, not just error strings.
- First inheritance with/without personal data, later personal updates, initialized
  absent saves, shared resource initialization across different games, both reset
  policies across restart, and copy/write overlap with deliberately delayed writes.
- Fault injection around staging, ledger commit, generation-pointer publication,
  and archive bookkeeping. Personal settings/saves should remain byte-identical
  during all session-only reset/restore tests.
- Concurrent personal settings changes to different and identical keys, unknown
  key preservation, watcher misses, and no unintended writes from startup/shutdown.
- Approval across short CLI connections, Deny, timeout, disconnect, simultaneous
  requesters, renderer reload, and pending gameplay progression. Discovery and
  name-lock liveness probes must never prompt or use protected game inspection.
- Revoke during queued ROM load/settings writes, input holds, leases after socket
  close, scripts/observers, nested batches, captures and artifact publication.
  Assert no later frames from external work, no residual overrides, paused state,
  and blocked subsequent reads until a fresh grant. Include in-flight reapproval.
- Two callers sharing one adapter with interleaved selections, leases, operations,
  cancellation and reconnect. Explicit stale instance/native identities must fail.
- Source-qualified checkpoint ID collisions, inherited delete/rename attempts,
  concurrent personal retention/load, compatibility rejection and explicit exports.
- Two named sessions plus personal playing the same fixture with independent
  persisted saves; multiple personal games with disjoint resources running together.

Extend the existing fixture and Electron suites rather than replacing them.
Relevant existing lanes include `test:profiles`, `test:settings`, `test:session`,
`test:automatic-launch`, `test:launch`, `test:mcp`, `test:agent`, `test:controls`,
`test:playback-controls`, `test:save-states`, `test:paired-recovery`, `test:reload`,
`test:video`, and packaged tests. Add focused new suites to `scripts/accept.js`
and run the full `npm run accept` under the repository's pinned Node/toolchain
after integration. All tests must use disposable roots/service directories and
generated media, never the user's personal saves.

Map final acceptance evidence to all eleven numbered spec criteria. Perform
manual packaged macOS checks for Dock hover/activation, nonblocking approval
during human gameplay, toolbar reveal/Revoke, and visible title/banner behavior.
Record exact commands, revision, outcomes, supported peripheral coverage, and
unrun/manual limits in `electron-ui/ACCEPTANCE.md` and the implementation report.
Update CLI/MCP/service README files with target precedence/lifetime, no-app launch
behavior, approvals, reset/restore recipes, storage locations and compatibility
aliases. New Node helper scripts are `.js` ES modules; keep retired GUI paths deleted.

## Current validation status

Task 1's foundation is implemented in `7a2216451`, with native/TypeScript builds,
44 focused tests and the three documented Electron checks passing. See
[the implementation report](../../electron-ui/sessions/IMPLEMENTATION.md) for
exact commands and limits. Task 2 now has native/TypeScript builds, 42 focused tests, seven separate desktop
checks and an attempted full run with 316 fixture tests passed before a stale MCP
assertion. Task 3 adds 81 focused passes, eleven separate desktop checks and
329 fixture passes before that same MCP assertion. Task 4 adds 60 focused
passes, three separate desktop checks and 338 full-suite fixture passes. Its updated MCP inventory passes, then the full run stops at
the existing stale Game Boy video-clock assertion. Task 5 now adds scoped discovery/selection and keeps personal external access
closed pending the task 6 controller. Nine selection tests and three independent
desktop checks pass. Final full acceptance passes 346/347 fixtures, with an
unchanged scheduler timing assertion failing (isolated rerun passes); later gates
are unrun. The separate MCP desktop check still reaches its known video-clock
mismatch. Exact validation is in the implementation report. Task 6 now implements personal
approval/cancellation and the native revoke barrier, with renderer plugin management
deliberately restricted to named sessions. Its focused 60-test lane and independent
desktop approval/CLI checks pass. The final full run passes 352 fixtures and reaches
the previously documented MCP video-clock mismatch. Final task 6 evidence is in
the implementation report. Task 7, full integration acceptance and the final
map to the spec's eleven criteria remain outstanding.

The original planning-only document recorded source review and no builds/tests.
That historical statement is superseded by the task-specific evidence above;
it must not be interpreted as evidence for unimplemented tasks.
