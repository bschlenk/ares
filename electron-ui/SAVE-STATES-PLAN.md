# Save-state overhaul: requirements and implementation audit

Source: https://github.com/bschlenk/ares/issues/5. This plan records the requirements agreed with the user on October 28, 2026. The implementation audit and validation record are appended below; the requirements remain the agreed product contract.

## Start here

Read repository instructions and `electron-ui/RESUME.md`, then inspect existing state, session lifecycle, ROM identity, settings, and ROM-browser implementations. Implement the feature through existing frontend/service/native boundaries. Verify technical assumptions below before committing to a storage schema or native API design. Do not narrow the feature to N64 just because current state service contracts are N64-specific.

## Agreed experience

- Add adjacent Save State and Load State toolbar buttons. Every explicit Save creates a new permanent checkpoint; there are no overwrite slots or artificial count limits for manual saves.
- Load opens a modal consistent with the ROM browser, containing a screenshot grid for the current game's states. A button-anchored macOS-style stack is deferred.
- Opening the browser does not pause gameplay. Double-clicking a thumbnail loads immediately. Do not automatically save the position being replaced, or implement undo-load recovery in this version.
- Show permanent/manual states first, then a divider and autosaves. Sort each section by original capture timestamp, newest first. Named states show both their name and formatted capture time; unnamed states use the formatted timestamp as their label.
- Capture a screenshot for every state, representing the saved position. Do not accidentally capture a later frame while emulation advances during file I/O.
- Provide rename, delete, and Reveal in Finder (platform equivalent where appropriate). Delete moves the state and its associated screenshot/metadata to OS Trash.

## Autosaves and resuming

- Autosave on orderly game closure, switching ROMs, and app exit/window closure when that action ends the session. Respect the app's existing window lifecycle semantics. No periodic autosaving or crash/force-quit recovery is required.
- A session qualifies after at least 10 seconds of accumulated unpaused gameplay. Paused time does not count. There is no controller-input heuristic.
- Successfully loading any save state immediately qualifies the session for exit autosave; do not impose a new 10-second wait after loading. Loading a state and exiting saves the resulting position without modifying the source checkpoint.
- Nonqualifying sessions leave existing autosaves untouched.
- Retain the newest 10 autosaves per game. Publish a new autosave successfully before pruning older ones; never sacrifice recovery history to a failed save.
- Giving an autosave a nonempty name promotes it permanently and removes it from the autosave quota. Clearing its name later does not demote it. Manual/permanent saves are unlimited.
- If an exit/switch autosave fails, offer Retry, Stay in game, and Leave without saving. Staying cancels the pending exit/switch; retry repeats saving; leaving proceeds explicitly without the new save. Preserve the current session until this decision is resolved. Relevant failures include unavailable storage, permissions, full disk, and capture/write errors.
- When a game with autosaves loads, show a nonblocking invitation for its latest autosave, including its screenshot, Resume, and Choose different. Its 10-second lifetime starts when the game loads, while the game runs normally behind it.
- Resume immediately loads the suggested state and continues gameplay. Choose different opens the state browser. Opening the browser dismisses the invitation. After expiration, the user can still load that state through the browser.
- Ignoring the invitation does not protect the suggested state from ordinary retention. If the new session qualifies and ends at the title screen, that position becomes the latest autosave offered next time; older states remain in history subject to the limit.

## Identity and storage

- Store states in an app-managed per-user data directory rather than beside ROMs. Follow existing platform/profile conventions (XDG on platforms where applicable). Expose a configurable storage root in Settings.
- Changing the root switches browsing and future writes to that location. Clearly state that existing files are not moved or deleted. Switching back makes the old collection available again. No migration workflow is required.
- Group by stable game-content identity, based on decompressed game content rather than archive bytes or ROM filename/path. ROM renames and moves must retain association. Reuse existing normalized game identity when possible; verify archive and alternate-byte-order handling.
- Distinct revisions and patched content have separate collections. Identical content at different paths shares a collection.
- Use a readable folder slug plus content hash, e.g. `kirby-64-the-crystal-shards--<hash>/`. Derive the readable name from the same title displayed under the game in the ROM browser, with its existing fallback behavior. The hash determines identity. Discover existing folders by identity regardless of changed title/slug; retain the original folder slug rather than renaming directories when a ROM/title changes.
- Verify how existing identity represents multi-file/disc games and system variants. Document the chosen mapping so a single-ROM assumption does not silently misassociate those systems.

## Files and metadata

- Use stable timestamp-based filenames, with local wall-clock time and numeric timezone offset, no milliseconds. Example proposed stem: `2026-10-28T22-05-00-0400`. This is a filesystem-safe adaptation of ISO 8601, not a claim that the literal filename is standard ISO syntax.
- If multiple captures have the same second, append a collision suffix (`_2`, `_3`, etc.). Capture immediately; do not defer capture or fabricate a later timestamp. Allocate filenames without overwriting existing files.
- Local filenames sort usefully within an offset, but cannot guarantee global chronological order across timezone/DST changes. Sort the UI by the precise original timestamp in metadata.
- Store versioned metadata with a precise capture instant, local offset information, game identity, optional display name, and permanent/autosave status. Preserve existing compatibility/integrity metadata where applicable. Never rely on filesystem mtime/ctime as the original capture date.
- Renaming changes metadata only, leaving the state filename and screenshot association stable. Duplicate display names are allowed. This supersedes the earlier idea of renaming actual files.
- Verify whether `.bs<n>` is only a legacy frontend convention. Choose an appropriate extension after inspecting native serialization/loading; `.state` in this plan is illustrative, not a verified constraint.
- Treat state, screenshot, and metadata as one logical checkpoint. Define publication/recovery behavior so interrupted writes do not expose a complete-looking broken checkpoint. Do not conflate a successful raw state write with a successfully published managed checkpoint.

## Date display settings

- Default to a friendly local format like `Oct 28, 2026 @ 10:05 PM`.
- Accept a documented strftime-style format string using percent directives. Provide presets that fill the editable field, plus a live preview using the current time.
- Validate unsupported directives inline. Define the supported directive set explicitly; do not introduce an unrestricted platform-dependent parser by accident.
- Display formatting changes labels only, not filenames, capture instants, ordering, or identity.

## Technical investigation required

These are implementation questions, not reasons to reopen settled product decisions:

1. Audit save/load support across all registered systems. The target is every system supporting serialization. Report actual gaps and provide truthful unavailable states for unsupported cores.
2. Inspect serialization extension dependencies and compatibility checks; avoid changing serialized bytes merely to replace slot naming.
3. Audit normalized ROM hashing, archive-member selection, byte order, and multi-media identity.
4. Ensure snapshot and screenshot refer to the same captured position, including paused sessions, while preserving ordinary save run/pause state. Browser opening alone must never pause.
5. Integrate autosave before teardown and ROM replacement, including asynchronous quit/window-close handling, retries, cancellation, and duplicate lifecycle events. Prevent old-session work from appearing in the next game's collection.
6. Preserve existing MCP/script state APIs, ownership/epoch guards, and compatibility checks. Add managed-library behavior without silently altering arbitrary-path API semantics.

Initial inspection found `services/state-contracts.ts` has generic-looking `state.save/load/list` APIs but N64-specific snapshot/layout contracts. `services/README.md` describes immutable native snapshot pins, main-owned streaming state publication, separately published metadata, and guarded load commits. Reuse these guarantees; verify generic-core support rather than assuming it exists.

## Suggested implementation sequence

1. Read current architecture and record the technical audit, chosen identity mapping, extension, metadata schema, and exact default root in this document.
2. Implement generic native capture/load capability as needed, then managed storage, metadata, screenshot association, atomic publication, listing, rename/promotion, Trash, and retention.
3. Add storage/date settings and modal browser using existing UI patterns. Wire explicit toolbar saves and loads.
4. Add session eligibility accounting, guarded exit/switch autosave, failure actions, and the timed resume invitation.
5. Run focused tests and UI verification; update relevant user/developer documentation and record actual limitations and validation evidence.

## Acceptance and verification

- Multiple explicit saves, including within one second, preserve distinct captured positions and screenshots without overwriting. State capture preserves prior run/pause state.
- Round-trip representative supported cores and audit remaining cores; verify mismatched/incompatible states fail clearly.
- ROM rename/move and supported archive/raw equivalence retain identity; distinct game content stays separate. Folder title changes do not lose collections.
- Browser grouping/order, duplicate names, metadata-only rename, promotion, and clearing a promoted name behave as specified. Test more states than one screen without imposing a fixed slot/count limit.
- Autosave tests cover under/at the 10-second threshold, paused time exclusion, successful load eligibility, all orderly exit/switch paths, cancellation, retry, leave-without-save, and duplicate close events.
- The 11th successful autosave prunes only the oldest eligible autosave; promoted checkpoints survive. Failed publication preserves history and does not create a complete-looking broken entry.
- Resume invitation uses the latest autosave screenshot, expires from load time, loads immediately, and dismisses on browser opening. Old-session timers cannot affect a new game.
- Settings preview, directive validation, timezone/DST ordering, filename collisions, changed roots, unavailable storage, and Trash of associated artifacts are verified.
- Run relevant existing service/native/frontend checks plus targeted new tests for lifecycle and persistence guarantees. Manually inspect modal, toolbar, banner, and settings using available fixtures/media. State any private-media-dependent checks that could not run.

## Out of scope

Periodic/idleness-based saving; crash recovery; automatic pre-load backup or undo; arbitrary-file loading/import UI; moving existing files when roots change; button-anchored popover; input-based autosave eligibility; automatic folder renames after game renames. Do not remove existing arbitrary-path agent/script functionality.

## Technical audit and implementation decisions (October 28, 2026)

The starting implementation was N64-only: `StateSnapshot`, `StateLoader`, the
layout/peek contracts, and `StateArtifacts` all require N64. A native snapshot
pauses the session and publishes its raw state before a separately fallible
sidecar. Those semantics remain unchanged for arbitrary-path MCP/script callers.
Managed checkpoints use a separate `checkpoint.*` native protocol and main-owned
storage; a raw file save is never treated as a published managed checkpoint.

### Registered systems

Inspected `native/runtime/emulator/emulators.cpp` and every
`ares/*/system/serialization.cpp`. Registry entries are conditional on compiled
cores. The source audit is not a claim of media-dependent round-trip validation.

| Core | Registered frontend variants | Serialization audit |
| --- | --- | --- |
| a26 / a52 | Atari 2600 / Atari 5200 | Payload and restore callbacks |
| cv / myvision | ColecoVision / MyVision | Payload and restore callbacks |
| fc | Famicom, Famicom Disk System, Dendy; applicable Arcade boards | Payload, FDS and VS branches |
| gb / gba | Game Boy, Game Boy Color / Game Boy Advance | Payload and restore callbacks; GB fixture round-trip tested |
| md | Mega Drive, Mega 32X, Mega CD, Mega CD 32X, LaserActive (SEGA PAC) | Payload with 32X/CD branches |
| ms | Master System, Game Gear | Payload with model branches |
| msx | MSX, MSX2 | Payload including expansion and tape |
| n64 | Nintendo 64, Nintendo 64DD; applicable Arcade boards | Payload, DD/Aleck64 branches, existing guarded N64 service |
| ng / ngp | Neo Geo AES/MVS / Neo Geo Pocket/Color | Payload and restore callbacks |
| pce | PC Engine, PC Engine CD, LaserActive (NEC PAC), SuperGrafx, SuperGrafx CD | Payload; additionally validates accurate VDP setting |
| ps1 | PlayStation | Payload including disc and cards |
| sfc | Super Famicom | Payload includes coprocessors, SGB, BS Memory, Sufami Turbo, MSU1 |
| sg | SG-1000, SC-3000; applicable Arcade SG-1000A boards | Payload including SC-3000 tape |
| ws | WonderSwan, Color, Pocket Challenge V2 | Payload and restore callbacks |
| saturn | Saturn | **Unavailable:** payload method is empty (header-only state) |
| spec | ZX Spectrum, ZX Spectrum 128 | **Unavailable:** video, PSG and keyboard serialization omitted; distinct header format |
| synthetic | Test video source | **Unavailable:** no core serializer/game content |

Managed capture invokes `Node::System::serialize(true)` on the emulation thread.
Coroutine cores must synchronize to portable safe points: `Thread::serialize`
with synchronization disabled stores coroutine stacks with process-local pointers.
A same-session round trip initially hid this defect; the Electron reopen/switch
fixture exposed it. Managed saves therefore use synchronized serialization while
preserving the ordinary run/pause flag. Capture time is sampled immediately;
serialization reaches its native safe points without deferring filename allocation.
Other cores pin the latest native presentation packet after serialization without
forcing another screen refresh. Private-media checks found that refreshing again
reapplies interframe/palette processing and can change a paused image. The pin is
frozen in the capture operation, before emulation resumes or file I/O begins.
It pins immutable state bytes plus pixels before disk I/O: N64 uses the current
VI framebuffer, other cores use the current native presentation packet. The
image represents the last displayed frame at the captured core position (a core
stopped partway through a frame has not displayed its unfinished frame). Loading
preflights header/version, size and saved configuration, invokes the core's own
checks, rolls back failed restores, and invalidates epoch-owned captures/input/
debugger history. Saturn and Spectrum are rejected rather than silently exposing
unusable states. No core serialization format was changed. `.bs<n>` naming exists
only in the old frontend/service inventory; serializers consume bytes, so managed
files use `<timestamp>.state`.

### Identity mapping

Existing `session.status.game.sha256` hashes only mounted `program.rom`; main's
launch hash hashes the original file (including archive containers). Neither can
identify all supported systems. Existing APIs keep those meanings. A distinct,
versioned managed identity hashes the frontend system variant and actual core root
(including Arcade backend distinctions), plus mounted game-content
files in stable mount order and filename order, with names and sizes delimited.
System firmware paks, manifests (which contain titles), battery RAM and controller
paks are excluded. Included content: `.rom`, `.exe`, `.disk`, disk error maps,
FDS `.side*`, `.tape`, and MSU PCM. Companion mounted paks include SGB, BS Memory,
Sufami Turbo slots and N64 disk/Transfer Pak media; slot/mount names and order are
significant. Disc identity hashes MIA's logical `cd.rom` stream, covering all
mounted sectors rather than the CUE pathname or compressed CHD bytes. A changed
companion disc or system variant intentionally has a different collection.
Content is hashed once after media loading, before ordinary gameplay, then frozen
for that session; writable disk contents cannot change identity during play.

MIA chooses/decompresses cartridge archive members before mounting. N64's MIA
analysis normalizes big/little/byte-swapped ROM data before `program.rom` is
mounted. The audit fixture exposed a gap: unknown IPL3 checksum fallback restored
original byte order even when the header specified little/byte-swapped content.
The fallback now canonicalizes recognized header orders before mounting; known
CIC detection remains unchanged. SFC splits normalized ROM components after copier-header processing.
Hashing the actual mounted content shares raw/archive and alternate-byte-order
collections, independently of outer archive names, title changes and paths.
The ROM browser already rejects ambiguous multi-game ZIPs; direct native loading
retains MIA's selection semantics and hashes the member actually mounted.

### Storage and schema

Default root: `<owned Electron profile userData>/states`, i.e.
`<Electron appData>/Ares Workbench/profiles/<profile>/states` (development launches
use their existing development profile). Explicit profile directories continue
to own their defaults. This follows the existing platform/profile convention;
Electron selects appData, including XDG_CONFIG_HOME on Linux. `states.root` is an
absolute, configurable folder; changing it moves/deletes nothing.

Collections use `<readable-title-slug>--<managed-sha256>`. Discovery uses the hash
suffix, retaining the original slug when titles change. Library launches pass the
browser's displayed title. Each checkpoint is a timestamp-named directory with
`<timestamp>.state`, `<timestamp>.png`, and `<timestamp>.json`. The timestamp stem is local
wall time with numeric offset, second precision and exclusive collision suffixes.
Metadata schema 1 records precise UTC capture instant, original local offset,
game hash/system/title, name, permanent status, SHA256/length of both artifacts,
and the actual machine-configuration/loaded-firmware content fingerprint.
Unrelated core preferences and firmware file paths do not invalidate saves. State header/version checks remain
native. UI ordering uses capture instants, never filenames or file modification
times. Names change metadata only. Naming an autosave permanently promotes it.

Files are written and fsynced inside an invisible `.pending-<uuid>` directory.
Exclusive target-directory reservation prevents same-second overwrites, including
across writers. One directory rename publishes all artifacts together. Interrupted
staging/reservations are ignored, and failed publication never prunes history.
Retention runs only after commit and trashes oldest eligible checkpoint directories;
manual/promoted saves are unlimited. A Trash failure leaves extra recovery history
rather than deleting or reporting the committed capture as failed. User deletion
trashes the whole checkpoint directory, including all associated artifacts.

### Lifecycle and UI

Native monotonic accounting accumulates unpaused session time; successful native
or managed state loads qualify immediately. Main checks eligibility before
teardown, ROM replacement or quit and serializes these operations with managed UI
requests. Retry/Stay/Leave dialogs retain the native session until resolved.
Window close enters the existing asynchronous app-quit path; duplicate quit/close
requests remain blocked until teardown completes. State-browser opening never
requests a pause. Resume invitations are keyed by native session and expire ten
seconds after native readiness; browser opening dismisses them. State loads resume
immediately and do not write an undo checkpoint.

Date display uses a fixed English strftime subset: `%% %Y %y %m %B %b %d %e %H %I
%M %S %p %a %z`. `%e` is the unpadded day; `%I` is zero-padded 12-hour time. Default:
`%b %e, %Y @ %I:%M %p`. Settings offer editable presets, preview and inline validation.

## Validation record (October 29, 2026)

The configured native host reports 40 registered frontend entries via `--systems`
(recorded in `artifacts/save-states/compiled-systems.txt`). Saturn is not enabled
in this build; its unavailable disposition applies when compiled. Both registered
ZX Spectrum variants are unavailable for managed states. The remaining entries
use the generic serializer boundary; their source audit does not substitute for
media-dependent runtime checks.

Completed checks:

- `cmake --build build-electron-make --target ares-electron-host -j 4`: passed.
- `node scripts/build.js` with Node 24.22.0: all three strict TS targets, preload
  bundling and SDK generation passed. `git diff --check` passed.
- Focused Node 24.22.0 run: **53 passed, zero failed/skipped**. Includes library,
  native checkpoints, session, existing raw state artifacts/inspection/loading,
  ROM library, settings, runtime settings and focus-pause tests.
- Managed GB saves preserve paused/running state and load in a fresh native host.
  Managed N64 saves restore a distinct CPU register value into a separate host;
  artificial branch-loop media keeps the restored register stable. N64 big/little
  endian variants share identity. GB raw/ZIP variants share identity; patched
  content differs. Folder/title/path changes and storage-root changes are covered.
- Persistence tests exercise same-second collisions, more than nine permanent
  saves, duplicate names, metadata-only rename, promotion/clearing, ordering and
  ten-autosave retention. Injected ENOSPC failures at screenshot/metadata writes
  preserve all ten previous autosaves and leave no published partial checkpoint.
  Corrupted state data fails SHA256 verification before restore.
- Native qualification test excludes paused time and reaches the ten-second
  accumulated threshold; successful state loads qualify immediately. Existing
  N64 raw state/MCP load regression passed separately (one test, no skips).
- Actual Electron save-state fixture passed: toolbar saves; an unpaused 15-card
  scrolling grid; naming/promotion; Trash API association; changing roots; failed
  save choices Retry, Stay and Leave; cancelled ROM switches and window closure;
  successful ROM replacement; Choose different and Resume; real ten-second
  invitation expiry; source checkpoint still available after expiry; focus-pause
  behavior after UI loads; duplicate close/quit requests; final exit publication.
- Existing Electron settings and playback-controls fixtures passed. Modal, toolbar,
  resume banner and settings were visually inspected from captures. Toolbar capture
  explicitly exposes the hover presentation in the hidden test window. Evidence
  and logs are retained under ignored `artifacts/save-states/`.

`npm run test:save-states` runs the focused feature tests and Electron fixture after
building JS (build the native host first). The acceptance runner now includes the
Electron save-state fixture and automatically discovers the new Node tests.

Actual limits of this evidence: the complete acceptance/package lane was not
rerun; no hosted CI or Windows/Linux GUI validation was performed. GB and original
artificial N64 media were exercised, not private commercial game sessions or all
core/peripheral combinations. Optical raw/CUE/CHD equivalence, companion-disc/
SGB/BS Memory/Sufami Turbo/Transfer Pak/LaserActive combinations have the documented
mounted-media mapping and source audit, but no private-media runtime round trips.
Trash is routed through Electron's platform Trash API and stubbed in the isolated
fixture. Full-device failures are injected, not produced by filling a real disk.
Retention Trash failures preserve extra history and emit a log warning; they do
not undo a successfully published new autosave. These limits do not imply a pass
for any of those unrun checks.

### Follow-up private-media validation

The follow-up used copied private Kirby v153 media plus local Mario titles:
Super Mario Advance 4 / Super Mario Bros. 3 (GBA, verified local BIOS), Super Mario
Bros. Deluxe (GBC), and Super Mario World (SNES). Each Mario check boots to a
nonblank game screen, captures a permanent checkpoint, mutates work RAM, verifies
same-host restoration, then restores that checkpoint into a fresh native process
and verifies the RAM again. Original ROM/archive and BIOS hashes remain unchanged.
Kirby additionally verifies exact CPU register and screenshot equality across
mutation and fresh-host restoration, plus renamed/byte-swapped identity.

Private validation caught a redundant screen refresh during managed capture:
reapplying presentation filters changed paused pixels. It was removed; captured
PNGs now match the paused native presentation. Native raster dimensions remain
unchanged, while optional screenshot metadata records width, height and display
aspect. The browser/banner honor that aspect, including double-width SNES output.

The existing Kirby identity/byte-order, 36-button power/UI and memory/MCP feedback
checks passed, as did the matrix checks in both interpreter and recompiler modes
on an isolated unrestricted rerun. The first restricted matrix launch disconnected
with a native bus-write crash; the unrestricted rerun passed. No root-cause or
restricted-launch pass is claimed. Reference interoperability passed in both
v153 directions, including rejecting a mismatched 4 MiB configuration.

A private legacy v153 state also loaded when copied to an arbitrary suffix.
Numbered `.bs<n>` extensions are slot inventory conventions, not serializer
requirements. An older private v152 state was clearly rejected as
`unsupported_version` without mutating the session; renaming cannot resolve a
serializer-version incompatibility.

Reproducible opt-in checks: `npm run test:save-states-private` with explicit
`ARES_PLUGIN_TEST_ROM`/`ARES_PLUGIN_TEST_STATE`, and
`npm run test:save-states-cross-core -- /path/to/private-games.json` with entries
`{name, system, rom, bios?}`. All emulation writes use disposable copies. Evidence
is under ignored `artifacts/save-states/private/` and `cross-core/`. These checks
supersede the earlier lack of private GB-family/SNES/N64 media evidence; optical,
companion-media, physical input/audio and other-platform limits still apply.

Final evidence summary: full acceptance `run-yRHvEw` passed 24 gates and 238
fixtures in 4m21s. The later 239-test run after display-aspect metadata hit an
existing watcher initial-change timeout; its isolated unrestricted rerun passed
2/2, while the restricted attempt reported EMFILE. Final feature UI and all Mario
private checks passed. No final all-green 239-test full run is claimed. Exact
run paths/results are recorded in `artifacts/save-states/validation-summary.json`.
