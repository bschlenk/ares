# Session management: read this first

This is the shared preamble for **every task's agent**. Read it, the authoritative
[session-management spec](../SESSION-MANAGEMENT-SPEC.md),
[shared acceptance requirements](ACCEPTANCE.md), and your task file before editing.
The spec remains authoritative; splitting this plan does not change settled
product requirements.

## Branch and current handoff

- Repository: `/Users/bschlenk/Developer/forks/ares`.
- Issue: [bschlenk/ares#37](https://github.com/bschlenk/ares/issues/37), still open.
- Working branch: **`feat/session-management`**. Continue on this branch; do not
  create a new branch for each task or switch back to `main`.
- Implementation baseline before task 1: `1712fae48925ff52ec810d09a87bb4e837ca98f1`.
- Task 1 implementation commit: **`7a2216451`**
  (`feat(sessions): add persistent contexts and lifecycle ownership`).
- Task 2 implementation commit: **`164e91973`**
  (`feat(sessions): coordinate native storage ownership and inheritance`).
- Task 3 implementation commit: **`9be56e5f1`**
  (`feat(sessions): coordinate personal windows and shared settings`).
- Next work: **[task 5 — discovery and scoped selection](05-discovery-scoped-selection.md)**.
- Evidence: [implementation report](../../electron-ui/sessions/IMPLEMENTATION.md),
  [data-root audit](../../electron-ui/sessions/DATA-ROOT-AUDIT.md), and
  [repository acceptance documentation](../../electron-ui/ACCEPTANCE.md).

Tasks 1–4 are complete within their scopes. Named game loads now use native
preparation, resource ownership and recoverable inheritance. Personal windows
now share coordinated preferences and mutable stores, with per-process runtimes
and File → New Window. Save-root changes still require exclusive personal
ownership. Managed states now expose read-only personal inheritance, and
whole-session reset/restore retains recovery generations. Approvals,
revocation and full spec acceptance remain outstanding. `--session-name` opens
persistent named storage; `--instance-name` still means the legacy endpoint label
pending task 5. Full acceptance now passes 338 fixture tests and stops at an
unrelated stale MCP Game Boy video-clock assertion;
see the implementation report for exact results and validation limits.

## Task list and status

Implement the **seven numbered tasks in order**, committing after each completed
task. The older plan's six delivery stages grouped work differently; their
acceptance mapping is retained in [ACCEPTANCE.md](ACCEPTANCE.md), not used as a
second execution order.

| Task | Scope | Status | Implementation commit |
| --- | --- | --- | --- |
| 1 | [Data model, paths, and lifecycle](01-data-model-paths-lifecycle.md) | **Complete (foundation)** | `7a2216451` |
| 2 | [Actual storage ownership and inheritance](02-storage-ownership-inheritance.md) | **Complete** | `164e91973` |
| 3 | [Personal windows and shared settings](03-personal-windows-shared-settings.md) | **Complete** | `9be56e5f1` |
| 4 | [Managed states and recovery](04-managed-states-recovery.md) | **Complete** | Recorded in completion follow-up |
| 5 | [Discovery and scoped selection](05-discovery-scoped-selection.md) | **Next** | — |
| 6 | [Approval, cancellation, and revocation](06-approval-cancellation-revocation.md) | Not started | — |
| 7 | [Identification, toolbar, and captures](07-identification-toolbar-captures.md) | Not started | — |

No task is currently in progress. Task 4 adds scoped managed-state references,
read-only inherited libraries, offline reset/archive/restore tools and a Sessions
settings view. Native/TypeScript builds, 60 focused tests and three separate
desktop checks pass. The full rerun passes 338 fixture tests, native smoke and
three Electron gates, then fails at the existing MCP Game Boy recording clock
assertion; later full-suite gates remain unrun. Preserve generation lifecycle
locks, personal checkpoint transactions and connection/lease ownership when
adding task 5 selection. Approval/revocation and final presentation remain tasks
6–7.

## Working agreement for each agent

1. Read the repository's [AGENTS.md](../../AGENTS.md), this preamble, the spec,
   shared acceptance requirements and your task file. Inspect `git status`, the
   current branch and previous implementation commits before changing code.
   Mark your task in progress in this table when you start.
2. Reuse completed work. Task 1 added `electron-ui/sessions/`, the settings
   transaction primitive, explicit data-root routing and a launch/readiness
   helper. Inspect those implementations and their limits before extending them.
3. Work only on the next incomplete numbered task. Reusable dependencies may be
   implemented early when required, but do not expose a later feature before its
   storage/authorization guarantees exist. Do not reinterpret a blocked exposure
   as permission to weaken the spec.
4. Preserve unrelated working-tree changes. The planning docs and `/docs`
   `.gitignore` exception originally arrived uncommitted; the documentation
   restructuring is separate from task 1's implementation. Preserve the spec's
   requirements and keep code changes in their task commits.
5. Use disposable data roots, private service directories and generated media.
   Never read or mutate the user's personal saves for validation. Use `.js` ES
   modules for new Node helper scripts; keep upstream-derived runtime code in
   `desktop-ui/` and `mia/`, Electron policy in `electron-ui/`, and retired GUI
   paths deleted.
6. Validate the change with appropriate subprocess/native/Electron tests, then
   inspect and commit explicit paths. Record exact commands, outcomes, revision,
   coverage and unrun/manual limits in the implementation report and acceptance
   documentation. A failing or unrun check is not a pass.
7. Update this table and the task file when finished, including the implementation
   commit, evidence link and any dependencies deliberately left gated. Include
   that metadata in the task commit where possible; a follow-up documentation
   update may record its hash. Leave the next agent a clear starting point.

Task completion means that task's implemented scope and required checks are
accounted for. **Issue #37 is complete only when all seven tasks and the eleven
spec acceptance criteria are covered.** Do not mark the issue complete based on
one milestone or a successful build.

## Toolchain and verification

The repository pins Node **24.22.0**; an unqualified `node` on this machine may
select another version. Run checks from `electron-ui/` with:

```sh
mise exec node@24.22.0 -- node scripts/build.js
mise exec node@24.22.0 -- npm run accept
```

Task 1 built the native host with:

```sh
# From the repository root
cmake --build build_macos/workbench --target ares-electron-host -j 8
```

Point focused native/Electron checks at that rebuilt binary using `ARES_HOST`
when appropriate. Native changes require rebuilding it; TypeScript compilation
alone does not update the host. Electron checks required desktop process access
in the prior run; sandboxed profile checks timed out before startup. Diagnose
that distinction rather than claiming an unstarted test passed.

Task 4 evidence: native/TypeScript builds, **60 focused tests**, three separate
desktop passes and **338 full-suite fixture tests**. The MCP exact tool inventory
and schema parity report were updated; full acceptance now stops at the stale
Game Boy video-clock expectation at `tests/electron-mcp.js:101`. See the
implementation report for exact commands and limits.

Task 3 evidence: native/TypeScript builds, **81 focused tests**, eleven separate
desktop checks, and **329 full-suite fixture tests**. Full acceptance still fails
at the stale MCP tool-list assertion; later full-suite gates are unrun. Packaged
New Window/Dock checks remain manual/unrun. Exact evidence and limits are in the
implementation report.

Task 2 evidence: native/TypeScript builds, **42 focused tests**, seven separate
Electron/profile checks and 316 fixture tests in the attempted full suite. Full
acceptance failed at a stale MCP expectation; later full-suite gates remain
unrun. Task 1 evidence: native build, all three TypeScript targets, **44 focused tests**,
and `PROFILE_OWNERSHIP_PASS`, `SESSION_CONTEXT_PASS`, `SETTINGS_UI_PASS`. Exact
commands are in the implementation report. Full acceptance, packaged/Dock checks,
approval/revoke gameplay and capture pixel checks remain unrun for this feature.

## Recommended architecture

Keep one Electron main process and one native runtime per app window. Separate
the logical data owner from Electron's process-local user-data directory. Add
cross-process storage coordination and explicit external authorization at the
local service boundary. Do not introduce a permanent background daemon.

This preserves the current main-process globals, native ownership model, renderer
recovery, and process-level Dock activation. Putting several emulator windows in
one main process would require a much larger rewrite of `main.ts`, its IPC
handlers, plugin manager, and service router, while making per-instance Dock
behavior harder to preserve.

Use four distinct identities throughout contracts and logs:

| Identity | Lifetime and purpose |
| --- | --- |
| Named session ID and name | Persistent workspace; independent of process and game |
| App instance UUID | One window/process lifetime, including renderer reloads |
| Native session UUID and epoch | Existing game/state mutation validation; retain unchanged |
| Connection/owner/lease ID | Existing execution contention and resource ownership |

Authorization is a fifth, separate concept: a window-wide grant generation. A
named session has implicit external authorization; a personal instance starts
without a grant. Neither a connection ID nor a target handle grants permission.

## Original planning findings

These findings describe the pre-implementation baseline at `1712fae48`. Task 1
has since split data/runtime roots, coordinated settings writes, rebased named
state storage, and made app readiness independent of native identity. Consult the
implementation report and current code before treating a finding as still open.

- `profile.ts` provides contained private saves, but `main.ts` currently ties
  shared data, browser storage, logs, and an Electron single-instance lock to
  the same profile directory. Merely removing that lock is unsafe.
- `--instance-name` currently claims a service name; it does not establish a
  persistent isolated session. Preserve explicit instance targeting while
  migrating the user-facing name onto real session storage.
- `AutomaticServiceClient` probes `app_status`, errors on multiple running
  apps, and automatically launches into the selected/default profile. Readiness
  currently depends on a native identity; app readiness must work with no ROM.
- `SettingsStore` serializes inside one process and atomically renames a JSON
  file, but writes from a cached complete values object. Two processes can lose
  unrelated changes despite each file replacement being atomic.
- Writable paths come from more than `--save-dir`: `mia/pak/pak.cpp`, direct
  `Emulator::load/save`, and loader-specific code all matter. For example,
  PlayStation expansion EEPROM uses a shared `PlayStation/<type>.eeprom` path;
  a ROM hash would miss this conflict. `Pak::save` currently writes in place.
- Managed checkpoints already publish staged directories atomically and check
  integrity, but serialization is per library object. Entries have no origin,
  and `states.root` is an unrestricted absolute setting. Copying that setting
  literally would direct a named session back into the personal library.
- `LocalServiceHost` gates transport authentication, not personal approval.
  Management commands include ROM loads, captures, script results, and plugin
  actions; gating native methods alone would leave bypasses.
- Disconnect releases a connection owner, but selected leases have independent
  owners. Revocation must also stop lease owners, nested jobs, and observers.
- Presented screenshots use `capturePage`; framebuffer/native capture follows
  a different path. Both need explicit capture acceptance, not an assumption
  that a DOM banner cannot appear in captures.
