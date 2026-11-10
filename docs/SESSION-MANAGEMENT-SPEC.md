# Named sessions, personal windows, and external access

Status: agreed product behavior, ready for implementation planning.

Source: [GitHub issue #37](https://github.com/bschlenk/ares/issues/37) and the subsequent requirements discussion with the repository owner. This document supersedes the issue's tentative wording and intermediate suggestions from that discussion.

## Objective

Make it clear which ares window an agent is using, make named sessions easy to reuse through CLI and MCP, and allow personal gameplay alongside isolated agent work. A user must be able to open another personal window even when the only running ares instance was launched by an agent.

Implement the behavior below. Command spelling, storage layout, and process architecture are implementation choices unless explicitly specified. Do not treat the illustrative API descriptions as existing commands. No implementation accompanies this spec.

## Terminology

- **Personal window:** a normal ares window using the shared personal settings and game data. There can be multiple personal windows, playing different games.
- **Named session:** a persistent, explicitly named workspace created through CLI or MCP, with independent settings and writable game data. A session may be reopened after its app closes.
- **App instance:** one running app/process instance, distinct from a persisted named session.
- **Native session/epoch:** existing runtime identities used to invalidate stale operations after game loads and state changes. Do not conflate them with the user-facing session name.
- **In-game save:** battery RAM, memory cards, and other persistent storage used by a game. This is distinct from an emulator save state.
- **Managed save state:** an entry in ares's in-app checkpoint/save-state library. Explicit state-file imports and exports are separate.
- **External client:** a CLI or MCP client. A connection ID identifies a connection, not a human, agent, or conversation.

## Personal windows

Add **File → New Window**, available from personal and named-session windows. It creates an additional personal window rather than focusing an existing one. Dock clicks continue to focus the particular app instance represented by that icon.

Personal windows share the same settings and persistent game data. They do not create independent personal profiles or save histories. Reopening personal ares must show the user's normal saves, regardless of which personal window previously played the game.

Coordinate shared settings persistence so concurrent personal windows do not corrupt settings or silently overwrite unrelated changes.

### Save ownership

Only one personal window may run a game that owns a particular writable save location at a time. Determine conflicts from the actual persistent storage the games would write, rather than only display titles or ROM paths. Two ROM versions using different saves may run together; duplicate ROM files pointing at the same saves may not.

Acquire ownership before loading a game with conflicting writable data. Release it on unload and app exit, and recover ownership after crashes without leaving permanent stale locks. Account for games that use several persistent files or shared peripherals/storage. Prevent overlapping writers across personal windows.

Named sessions have different writable storage and may run the same game simultaneously with personal windows or other named sessions.

The exact human-facing conflict dialog is an implementation choice. It must explain which window owns the conflicting data. Do not silently close, replace, or transfer another window's game.

## Named-session lifecycle and data

Only CLI and MCP create named sessions. Explicit creation implies authorization for external access; there is no approval prompt or revoke button for named sessions.

Opening a name that already exists reuses its persisted settings and game data. Reopening an already running name targets that session rather than creating another writer to its data. Multiple external clients may connect to it; preserve existing operation ownership and contention rules.

### Settings

On first creation, copy personal settings into the named session. Subsequent settings changes are independent in either direction. Ordinary reopen does not recopy personal settings.

### In-game saves

Initialize saves lazily, when a named session first loads a game:

1. If the session already has initialized storage for that game, use it.
2. Otherwise, copy the personal in-game save data if it exists.
3. Otherwise, initialize fresh game storage.

All subsequent game writes go to the named session's private storage. Later personal progress does not replace session progress. No session writes are automatically promoted back to personal storage.

Record initialization independently of whether the game has created a save file. A deliberately fresh game must not unexpectedly inherit personal saves on a later launch merely because its save file is absent.

“Copy on write” describes the desired isolation/inheritance behavior, not a requirement to use filesystem reflinks or a lazy filesystem overlay. Ordinary copies are acceptable. Ensure copies are consistent with ares's save writes; do not assume an ordinary copy is a transaction. Flushing the currently running personal game's in-memory save data is acceptable but not required. Inheriting the absolute latest unflushed progress is not a product requirement.

### Emulator save states

Named sessions can discover and load personal managed save states. New managed states belong to the named session; personal windows do not list or inherit named-session states. Clearly identify the origin of listed states. Session-local rename, delete, retention, or overwrite operations must not modify personal entries.

Inherited states are available for explicit selection; they are not automatically loaded. Keep them available even in the “start empty” reset mode. Preserve existing ROM/configuration compatibility checks.

Explicit state-file import/export remains supported. Existing MCP `state_load` and `state_save` commands take file paths; managed-library discovery is a separate concern. Session ownership of the managed library is not a blanket prohibition on user-requested file exports.

### Reset and recovery

Offer two explicit whole-session reset modes:

- **Fresh clone of personal:** reset settings from current personal settings and clear game initialization so games inherit current personal saves on their next load.
- **Start empty:** use default settings and fresh in-game saves without inheriting personal in-game saves. Persist that policy so later game loads do not accidentally inherit saves. Personal managed save states remain available to load explicitly.

These operate on the entire named session, not one game. Refuse either reset while that named session is running. Do not silently stop a running app to reset it.

Before replacing session data, archive the previous data in a recovery area. Provide a discoverable **Restore previous data** action. Personal saves and settings must never be erased or replaced by a named-session reset. Restoring must also avoid concurrent writes; refuse while the target session is running. Preserve the displaced current data when restoring rather than silently destroying it.

Archive format, retention, and recovery UI placement are implementation choices. Do not silently introduce automatic permanent deletion of backups.

## External access to personal windows

An agent may explicitly attach to a personal window and operate on its real settings and saves, but only after in-app approval.

### Target selection

Support listing running windows/sessions and explicitly selecting one. Discovery should provide enough information to distinguish them, including name when present, personal versus named type, loaded game, running/paused state, and a stable identifier for the current instance.

Without explicit selection, target the earliest-opened running personal window. Do not choose whichever window happens to have focus, and do not silently target an unrelated named session. Personal windows need internal identities, but users do not have to assign names to them.

When targeting an existing personal window, identify it in the client's pending-approval information so the agent can tell which game/window is waiting.

### Approval

Show a nonblocking in-app Allow/Deny request. It must not take over gameplay or pause the game merely because access was requested. Before Allow, game inspection and control are not authorized. Minimal discovery/approval status information must remain available to make selection and approval possible.

Allow authorizes **all external clients for that window**, including reads and mutations, rather than one particular connection or agent identity. The user is deliberately allowing those clients to modify real personal data. Authorization lasts until explicitly revoked or the window closes; short-lived CLI connections do not require repeated approval.

A CLI command can wait for approval. MCP may also wait, but client timeouts/cancellation must be handled. Provide a usable way to inspect/retry pending approval. Do not execute a canceled command later when approval arrives, or silently replay mutations after reconnecting. Deduplicate simultaneous requests so clients do not flood the window with prompts.

### Revoke

While personal external access is authorized, show an authorization banner with an explicit **Revoke** control. This replaces the earlier idea of a dismissible recent-activity banner.

On Revoke:

- Remove authorization for all external clients to that window.
- Stop active automation and release held/overridden inputs.
- Reject queued external commands and pause gameplay.
- Require fresh approval before further external inspection/control.

Apply this across the actual external control paths, including long-running operations and leases. Connection reuse or a new CLI invocation must not bypass revocation.

## Identification and banner presentation

Named-session window titles must retain the session name alongside useful game/app identification, including across ROM changes, renderer reloads, and empty-game views. Show the name when hovering its Dock icon where platform support permits. Report any macOS limitation honestly; verify packaged behavior, not just development Electron behavior.

A named session's banner identifies the session permanently, has no dismiss/revoke control, and does not depend on the latest client activity. Human gameplay in that window does not remove its name or banner.

Both session and personal-authorization banners follow the bottom playback toolbar's existing show/hide behavior. “Permanent” means the named-session indicator remains present whenever that UI is visible, not that it overrides toolbar auto-hide. Keep a personal window's Revoke action reachable when controls are revealed.

Do not include these banners in game screenshots or recordings produced by ares, including supported presented/framebuffer capture paths. This requirement concerns ares's game captures, not arbitrary operating-system desktop screenshots.

## CLI and MCP interface requirements

Keep both CLI and MCP. Expose a coherent session model for listing, creating/opening, selecting, resetting, and restoring named sessions, as well as selecting personal windows and handling approval.

Do not require agents to repeat a session name on every command. CLI selection can use a scoped environment variable or equivalent mechanism. MCP must support selecting/creating a session at runtime without requiring the user to rewrite MCP configuration for every session.

Exact syntax and tool schemas remain implementation choices. Document the scope and lifetime of selection. Avoid a machine-global “current session” that redirects unrelated agents. Account for concurrent callers and the possibility that conversations share one MCP adapter; do not assume a connection is a unique agent identity. Preserve explicit instance targeting and stale-native-session protections.

The existing automatic-launch behavior should remain useful when no app is open. Define and document that case consistently with the authorization model: a newly created named session is implicitly authorized; a personal window uses approval. Do not create an implicit bypass by classifying an existing personal window as agent-owned.

## Current code map and implementation constraints

Read repository instructions before editing. Preserve upstream paths for upstream-derived runtime code and keep Electron adapters in `electron-ui/`. Do not restore retired desktop GUI code. New JavaScript ES modules use `.js`, not `.mjs` or `.cjs` helpers.

Relevant starting points (verify against current HEAD):

- [`electron-ui/main.ts`](../electron-ui/main.ts): profile setup, per-profile single-instance lock, app/window naming, game lifecycle, UI checkpoint IPC.
- [`electron-ui/profile.ts`](../electron-ui/profile.ts): current profile layout and private-save containment. Existing rules deliberately forbid independently locked profiles from sharing writable saves. Supporting personal multiwindow requires revisiting ownership deliberately, not simply removing this guard.
- [`electron-ui/launcher.ts`](../electron-ui/launcher.ts): app launch behavior.
- [`electron-ui/services/automatic-client.ts`](../electron-ui/services/automatic-client.ts): discovery, named targeting, automatic launch. Currently errors on multiple live automatically discovered apps.
- [`electron-ui/services/local-endpoint.ts`](../electron-ui/services/local-endpoint.ts): service metadata, instance-name claims, authenticated connections, connection ownership.
- [`electron-ui/services/session-router.ts`](../electron-ui/services/session-router.ts), [`owner-leases.ts`](../electron-ui/services/owner-leases.ts): execution routing and ownership.
- [`electron-ui/cli.ts`](../electron-ui/cli.ts): shared tool registry and `ARES_INSTANCE_NAME` targeting.
- [`electron-ui/mcp/server.ts`](../electron-ui/mcp/server.ts): long-lived adapter and existing `--instance-name` / explicit-instance targeting.
- [`electron-ui/mcp/state-tools.ts`](../electron-ui/mcp/state-tools.ts): path-based state tools, currently described as N64 state services.
- [`electron-ui/services/checkpoint-library.ts`](../electron-ui/services/checkpoint-library.ts), [`checkpoints.ts`](../electron-ui/services/checkpoints.ts), [`electron-ui/ui/checkpoints.ts`](../electron-ui/ui/checkpoints.ts): managed save states.
- [`electron-ui/ui/playback-idle.ts`](../electron-ui/ui/playback-idle.ts): existing toolbar visibility behavior.
- [`desktop-ui/emulator/`](../desktop-ui/emulator/): active loaders and runtime save paths. Audit actual save destinations, including peripherals, rather than assuming one file per ROM.
- [`electron-ui/ACCEPTANCE.md`](../electron-ui/ACCEPTANCE.md), [`electron-ui/package.json`](../electron-ui/package.json): validation lanes and scripts.

Named targeting currently exists, but that does not establish the persistence, isolation, approval, and selection behavior specified here. Discovery currently creates probe connections; ensure probes cannot accidentally authorize access, trigger gameplay mutations, or cause prompt storms.

## Acceptance criteria

1. Starting with only an agent-created named session open, File → New Window opens a usable personal window. Another invocation opens an additional personal window. Dock clicks focus the corresponding instance.
2. Personal windows share normal settings/saves. Different games can run concurrently. Games with overlapping writable save locations cannot; duplicate paths, symlinks, races, unload, and crash recovery cannot produce two writers.
3. Two named sessions and a personal window can run the same game while writing independent save data. Reopening each named session preserves its data and settings.
4. First-load inheritance uses personal in-game saves when present, stays fresh when absent, and does not recopy on later loads. A game with initialized but absent save files does not unexpectedly inherit later.
5. Named-session settings initially match personal settings and then diverge independently.
6. Named sessions list/load personal managed states and write their own managed states. Personal listings exclude named-session states. Session deletion/retention actions cannot delete inherited personal entries. Explicit file state tools still work.
7. Both reset modes refuse while running, preserve previous data for recovery, and leave personal data intact. Start-empty remains empty across future game loads; both modes still offer personal managed states. Restore previous data works without destroying displaced data.
8. Default external targeting chooses the earliest-opened personal window. Explicit listing/selection can choose another personal or named instance. CLI and MCP can reuse a selection without repeating its name per operation or changing unrelated callers' targets.
9. A personal window continues gameplay while approval is pending. Allow enables all external clients for that window without reapproval per CLI process; Deny/cancel/timeout cannot cause a delayed command to execute.
10. Revoke stops active external work, releases inputs, rejects queued work, pauses, and blocks subsequent reads/mutations until reapproved. Closing/reopening a personal window does not retain its grant. Explicitly created named sessions need no approval and have no revoke control.
11. Names survive game/title changes and renderer reloads. Banners follow toolbar visibility and are absent from supported game screenshots/video. Test Dock naming in a packaged macOS app and document any platform limit.

Use meaningful automated coverage for storage isolation, concurrent ownership, approval/revocation, cancellation, reset/recovery, and target selection. Run relevant existing checks, plus packaged/manual UI acceptance for behavior automated tests cannot establish. Record exact checks and remaining limits; do not claim unrun checks passed.

## Handoff guidance

This is a substantial expansion of the original label request. Plan implementation in reviewable stages: persistent named-session storage/lifecycle; coordinated personal windows; discovery/selection and approval; identification/capture behavior. The final behavior must satisfy the full spec even if delivered incrementally.

Do not reopen settled product questions merely because implementation offers alternatives. Investigate the repository and choose routine architecture/API details. Surface a new question only if a concrete constraint forces a meaningful change to these agreed behaviors.
