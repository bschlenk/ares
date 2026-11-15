# Agent + human session access test

Use this runbook to validate [PR #40](https://github.com/bschlenk/ares/pull/40)
and [issue #37](https://github.com/bschlenk/ares/issues/37). This is a live,
coordinated test: the agent drives CLI/MCP, and the human watches the actual app
and operates Allow, Deny and Revoke. Do not mark human observations passed from
automation alone. Allow about 15–25 minutes; Dock checks need a packaged macOS app.

## Instructions to the testing agent

Read this whole document before starting. Announce each numbered phase and wait
at every **HUMAN CHECKPOINT**. Record PASS, FAIL or SKIP for each phase, with the
human's observation. A timeout or silence is not confirmation. Stop on a wrong
target, unexpected personal mutation, missing approval gate or ineffective Revoke;
retain the error/evidence rather than attempting to bypass or repair the behavior.

Use the real public CLI/MCP tools. Do not click permission controls on the human's
behalf, invoke private IPC/main exports, inject auto-approval code, edit grant
state, or run the automated test fixtures as a substitute for this exercise.
Only the human grants, denies and revokes personal access through the app UI.

Personal Allow grants all external clients access to real settings and saves.
For this test, the permitted personal actions are status/input reads, pause/resume
and one human-approved harmless input. Do not replace/close the personal ROM,
reset/restore data, load states, write memory/settings or manage plugins. Ordinary
gameplay can save progress; the human must choose a suitable game and safe moment.

## Setup and target selection

- Have the human run the PR build, with **Settings → Agent Integration** enabled.
  Confirm the revision and executable used. If their main window is an older
  build, have them arrange the switch; do not silently replace a running game.
- Ask which existing **personal/main window** to test and which ROM the agent may
  load into a separate named session. Have the human choose a harmless button
  later, after input discovery. Leave other external clients idle during the run.
- Keep the personal game focused while checking continued gameplay. If
  pause-on-focus-loss is enabled, distinguish that pause from an access request;
  the agent must not silently change the preference.
- Examples below use installed `ares` and `jq`. MCP agents use the same tool
  names/fields and retain the returned handles. Use the matching packaged helpers
  for packaged testing. Do not mix a development app with packaged Dock claims.

Use explicit targets on **every** gameplay/access call; focus is not selection.
Do not replace a pinned instance handle when a window exits. Unqualified discovery
is safe; unqualified gameplay could select or launch another personal window.

Use a dedicated test shell, keeping the agreed profile/service directory. Clear
only that shell's inherited target/lease selectors before discovery:

```sh
unset ARES_TARGET ARES_INSTANCE_NAME ARES_OWNER_LEASE
ares call sessions_list
# Human identifies the intended personal row by cached game title + instance UUID.
PERSONAL_TARGET="$(ares call session_select --instance_id 'CONFIRMED_UUID' | jq -er .target)"
NAMED_TARGET="$(ares call session_open --name manual-37-UNIQUE | jq -er .target)"
```

Replace `CONFIRMED_UUID`, `manual-37-UNIQUE` and the ROM path before executing.
Keep `PERSONAL_TARGET` and `NAMED_TARGET` separate; do not set a global current
session. Record the two instance UUIDs and the named session name. If discovery
is ambiguous, ask the human to identify the window before any protected call.

**HUMAN CHECKPOINT:** confirm which window is personal and which is named, and
confirm the personal grant is currently off. If already allowed, the human clicks
Revoke, then resumes gameplay themselves before the next phase.

## 1. Control the named session; inspect its identity

```sh
ares call load_rom --target "$NAMED_TARGET" --path '/ABSOLUTE/APPROVED/ROM'
ares call resume --target "$NAMED_TARGET"
```

Have the human watch while the agent pauses and resumes that named window using
`pause` / `resume` with its explicit target. Do not control the personal window.

**HUMAN CHECKPOINT:** verify the named window's title includes the session name;
revealing the bottom playback toolbar shows `Session: <name>`. It has no dismiss
or Revoke action and no Allow/Deny prompt. The personal game is unaffected.
Move the pointer away, wait for idle, then reveal controls again: the banner must
follow the toolbar's hide/reveal behavior and retain the same name.

Have the human use **View → Reload Interface**. Verify title/banner return and
the same named game continues. If a second approved ROM is available, the agent
may load it in the named window: the name must survive the game-title change.
The agent may close the named ROM to check the empty view, then reload it; never
use the personal target for this. Leave the named window running as a comparison.

## 2. Attempt personal access without approval; then Deny

```sh
ares call emu_status --target "$PERSONAL_TARGET"  # must fail: access_required
# No retries of protected operations while waiting for the human.
ares call access_request --target "$PERSONAL_TARGET" --timeout_ms 60000
```

**HUMAN CHECKPOINT:** identify the request in the intended personal window. Play
with the physical controller while it is pending. The request must not grab focus,
block gameplay or pause the game just because it appeared. No prompt should appear
in the named window. Click **Deny** and confirm the prompt goes away.

The agent checks `access_status` (expect `unapproved`) and retries `emu_status`
once (expect `access_required`). The personal game must still be unchanged by the
agent. A connection/target handle must not substitute for Allow.

## 3. Cancel a waiting command; prove it does not execute later

Coordinate before starting this command; run it in a cancellable terminal/tool:

```sh
ares call pause --target "$PERSONAL_TARGET" --wait-access
```

**HUMAN CHECKPOINT:** confirm a request appears and gameplay continues. Do not
click Allow yet. Tell the agent to cancel the waiting CLI with SIGINT/Ctrl+C.
Cancel within the CLI's 30-second approval window; a timeout is a different case.
The agent waits for its exit (expected status 130) and checks `access_status`.
With no other requester, it should return to `unapproved` and the prompt disappear.
Do not leave this command or a retry running in the background.

The agent now makes a **new** `access_request` with the same explicit personal
target, then waits. The human clicks **Allow**. Confirm the cancelled `pause` does
not execute when this new grant arrives: gameplay should continue. An MCP agent
may use a cancellable `access_wait` instead; record that the queued-CLI-pause case
was skipped unless the actual waiting CLI command above was exercised.

## 4. Approved personal access and the authorization banner

The agent calls `emu_status` twice using separate CLI invocations, both explicitly
targeted. Both should succeed without another prompt. Record the loaded game and
native session/epoch; this test must not replace that game.

**HUMAN CHECKPOINT:** reveal the personal toolbar. It must explain access to real
personal settings/saves and show **Revoke**. The named window still shows its
session banner with no Revoke. Check idle hide/reveal in the personal window.
Use keyboard Tab navigation to reach Revoke: keyboard focus must reveal controls
and keep the action visible. If macOS keyboard-navigation settings prevent
reaching buttons, record the setting and do not mark keyboard access passed.

Have the human reload the personal interface. The authorization banner must
return, the same game must remain, and another targeted status call must succeed
without renewed approval. The grant is window-wide, not a grant per CLI process.

## 5. Revoke while the agent is actually holding an input

The agent calls `input_describe` on the personal target. Have the human approve
one available port/button with a harmless visible effect at the current game
position. Use its exact discovered spelling; do not assume N64 button names.
If no supported digital input is available, mark this held-input case SKIP and
still test Revoke during ordinary agent-resumed gameplay.

Create a durable owner so closing the short CLI does not release the input first:

```sh
PERSONAL_LEASE="$(ares call owner_lease --target "$PERSONAL_TARGET" \
  --action create --name manual-revoke --seconds 120 | jq -er '.lease_ref // .lease_id')"
ares call resume --target "$PERSONAL_TARGET"
# Replace PORT_NUMBER and the JSON button array with the approved discovered input.
ARES_OWNER_LEASE="$PERSONAL_LEASE" ares call input_set --target "$PERSONAL_TARGET" \
  --port PORT_NUMBER --buttons '["APPROVED_BUTTON"]' --lease_frames 600 --lease_ms 10000
```

**HUMAN CHECKPOINT, arranged BEFORE input starts:** keep the toolbar revealed and
be ready to click Revoke. The agent announces when the hold is active. Take hands
off the controller briefly so physical input does not end/obscure the test. Confirm
the agent's input is visible, then click **Revoke within five seconds**, before
its ten-second/frame lease can expire. If it expired first, the case is inconclusive;
repeat only after a fresh human grant and a fresh owner lease.

Expected: agent input stops, gameplay pauses, and the authorization banner/Revoke
control disappears after cleanup. The separate named session remains running and
controllable. Check that moving the pointer or changing focus does not auto-resume
the revoked personal game. The human may explicitly resume and play afterward.

The agent immediately tries `emu_status` and `resume` on the personal target, once
each; both must fail with `access_required` (or `access_revoking` during cleanup).
Confirm `access_status` settles to `unapproved`; persistent `revoking` is not a pass.
Use only discovery/access status afterward; do not bypass the gate to inspect
native input or frame counters. The human verifies paused/no continued movement.

## 6. Fresh approval cannot revive the old owner

With the human ready, request access again and wait for a fresh **Allow** click.
Read personal `emu_status` and `input_state`: confirm the same game is still loaded,
no external input hold remains, and no old command resumes itself. Then try:

```sh
ares call owner_lease --target "$PERSONAL_TARGET" --action use --lease_id "$PERSONAL_LEASE"
```

Expect `owner_lease_expired`; never substitute a newly created lease for this check.
If phase 5 had no lease, mark this check SKIP. The human revokes again, verifies
blocked status once more, and decides whether to resume gameplay. The agent stops
personal operations. Leave the named test session open or close it only as agreed;
do not delete/reset its data or modify the human's personal files during cleanup.

## Optional packaged release checks

- With multiple packaged windows visible, hover each Dock icon and record the
  exact displayed name. Click each icon and record which instance activates.
  Named window titles must retain their names. A fixed bundle Dock hover name is
  a measured platform limitation to record, not permission to rewrite the bundle.
- If the human chooses a named-only startup, use File → New Window twice and
  confirm two usable personal windows open, with no inherited personal grant.
  Do not close an existing personal game merely to arrange this case.
- Capture the named game using `ui_screenshot` (new absolute output path) while
  its banner is revealed; verify app chrome is excluded and game/plugin overlays
  remain. Use an OS screenshot separately to document the visible banner; OS
  screenshots are expected to include it. Do not confuse the two capture types.

## Report back

Record build/revision, packaged vs development, macOS version, controller/core,
named name/UUID, personal UUID/game, and PASS/FAIL/SKIP for phases 1–6 and each
optional case. Include exact errors, which window changed, and human observations
of pending gameplay, banner text/visibility, keyboard Revoke, input release and
pause. Attach approved screenshots where useful; do not include endpoint tokens
or full opaque target/lease handles. List inconclusive timing cases and unrun
checks explicitly. Do not close issue #37 or mark the draft PR ready automatically.
