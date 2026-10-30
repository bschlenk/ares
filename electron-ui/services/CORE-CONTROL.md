# Cross-core digital input and elapsed frames

The common adapter discovers `Node::Input::Button` children, grouped by their
parent device path. It preserves the core's exact names. There are no GB masks,
Pokémon addresses or per-core button tables. Discover ports after each session
change; IDs are deterministic for that loaded node topology. Analog axes,
relative mouse motion, triggers and rumble are outside this digital contract.
The existing `n64.input.*` API remains available on N64. It and generic digital
holds reject competing mutations rather than overriding each other.

## Discovery and permissions

`session.status` returns `implemented_services` (native registry), `capabilities`
(services supported by the current core), `unavailable_services` (omitted service
reasons), and `support.input`, `support.elapsed_frames`, `support.observers` and
`support.n64`. Support means implemented for this core, not permission granted or
currently free of competing operations. Plugin status adds `plugin_grants`, the
manifest's actual grants. Input mutation uses the existing `session.control`
capability. Description/state and passive waits use `session.read`. Read-only
observers use `memory.read`. No player/model binding is added automatically.

## Actual SDK/native services

All use the normal `ctx.services.request(method, params)` result envelope:

| Service | Parameters | Result |
| --- | --- | --- |
| `input.describe` / `input.state` | none | ports with `port`, `path`, `buttons`, `held`, `owner`, `start_frame`, `latched_frame`, `expires_frame`; epoch/frame and limits |
| `input.set` | `{port, buttons: string[], leaseFrames, leaseMs}` | full digital state |
| `input.release` | `{port}`; 0 means all this owner's ports | full digital state |
| `clock.waitStart` | `{frames, timeoutMs}` | elapsed wait handle/status |
| `clock.waitRead` / `clock.waitCancel` | `{waitId}` | elapsed wait status |

Button names are case-sensitive (`A`, `B`, `Start`, `Select`, `Up`, `Down`, `Left`,
`Right` on GB). Combinations replace the entire held set. Leases require 1–600
native frames and 1–10,000 wall milliseconds; the first bound reached releases
input, including while paused. Native frame submission is the lease boundary.
`start_frame` identifies when the override became eligible at the safe point.
`latched_frame` stays null until the core first polls an overridden button, then
records that actual native coordinate. The core retains its normal handling of
opposing directions.

Waits accept 0–600 frames and a 1–60,000 ms wall deadline. Results include
`wait_id`, `owner`, `epoch`, `start_frame`, `target_frame`, `frame`,
`elapsed_frames`, `frame_kind`, `state` and `reason`. Reasons are
`frames_elapsed`, `deadline`, `cancelled`, `reset`, or `host_input`. A terminal
read/cancel consumes the handle; zero-frame waits finish immediately. At most
32 outstanding waits exist. Unread handles expire within two minutes. Cancel
also releases that owner's digital holds. Disconnect/unload releases only that
owner's resources. Requests carry session and epoch; never retry a stale input
mutation in a new epoch. ROM replacement starts a new native session.

A press can use `input.set` with a frame lease, followed by `clock.waitStart` and
polling `clock.waitRead`, then `input.release` in `finally`. Use the plugin scope's
abort signal to cancel the wait and release input on script cancellation. The
native lease bounds the hold even if JS fails. The game keeps running throughout.
Polling timers determine delivery latency only; elapsed counts come from native
frame events. No exclusive `execution.runFrames` call is involved.

For non-N64 cores the clock is `primary-screen-frame`: submissions of the first
screen discovered in the shared node graph, counted synchronously on the core
thread before asynchronous rendering. It counts LCD-off GB frames too. Secondary
screens do not advance the clock. N64 keeps `vi`; the synthetic fixture keeps
`synthetic-vi`. Coordinates are monotonic within a session/epoch, reset to zero
on reset/state restoration, and do not imply that the renderer displayed every
frame. Paused refreshes do not run the core or count elapsed frames.

Existing `scripts.observe` / `ctx.scope.onFrame` now work on the common primary
screen boundary. Their synchronous read-only callback returns serialized frozen
data, with existing work/output quotas, skipped counters and plugin cleanup.
The historical `boundary: 'vi'` default selects this common completed-frame event
on non-N64 cores; `vi_origin` remains N64-only. Generic frame references add
`frame`/`frame_kind`; `vi` remains null outside N64. Memory reads made later via
ordinary requests are safe-point samples, not frozen presentation snapshots.

## MCP and CLI

The shared MCP/CLI tool registry exposes `input_describe`, `input_state`,
`input_set`, `input_release` and `wait_frames`. `emu_status` supplies discovery.
CLI examples:

```sh
ares call input_describe
ares call wait_frames --frames 30 --timeout_ms 3000
```

`input_set` needs a retained CLI `owner_lease` and `ARES_OWNER_LEASE` across calls,
just like existing connection-owned resources; otherwise disconnect immediately
revokes it. MCP retains its connection owner. Existing `controller_*` tools retain
their explicitly N64-only semantics.

## Limits of this slice

The implementation uses shared interfaces for every loaded core with digital
button nodes and a primary screen. Generated GB and NES programs verify the same
API against actual controller reads. This is not an acceptance claim for every
core/peripheral. Controller hot-plug topology changes require rediscovery in a
new session; analog/peripheral injection needs a future shared contract.

The follow-up [GB display-state format](GB-DISPLAY-STATE.md) adds atomic PPU
observations through the same generic memory capture contract. The [Electron/local-model infrastructure follow-up](LOCAL-MODELS.md) upgrades
the runtime while explicitly reporting that no model provider is configured.
Durable plugin storage and journal/checkpoint transactions remain separate work. Existing generic checkpoints and cartridge saves are unchanged.
A model's `availability()` result is not proof of a working inference backend.

## Validation (2026-10-29)

- Native host and CPU fixture built; all three strict TS targets and generated SDK declarations built.
- Complete sequential Node suite: 245 passed, zero failures, one optional verified-Kirby/private-ROM test skipped. Run with normal macOS device access; the restricted sandbox cannot supply Metal and file-watcher access required by existing tests.
- Final latch-metadata refinement: 12 focused protocol/native/GB/NES/MCP/plugin-admission/schema/session checks passed, no skips.
- Disposable actual Electron session and plugin lifecycle tests passed (`ELECTRON_SESSION_PASS`, `PLUGIN_UI_PASS`). The full suite also exercises native checkpoint round trips and N64 input/debug/runtime behavior.
- No private ROM, save or credential was added. No live user instance was selected or controlled. Packaging/signing, every-core/peripheral acceptance and a real local model backend were not validated in this slice.
