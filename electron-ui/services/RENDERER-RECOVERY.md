# Live renderer recovery

The authenticated CLI/MCP `renderer_status` and `recover_renderer` tools inspect
and repair the Electron renderer while retaining the native game. Equivalent
plugin CLI commands are `renderer-status` and `recover-renderer`; they require
an explicit instance/connection selection. The recovery tool has no plugin SDK
or model binding.

Recovery only runs for a crashed renderer or a failed recovery attempt. Concurrent
requests coalesce; a healthy renderer is not reloaded. The host reloads its page,
recreates the frame port, revokes old plugin scopes, and remounts enabled plugins
and their panel/video surfaces. It never resets or loads the game. The response
compares native session/epoch before and after and reports changes explicitly.
Renderer readiness does not imply that every plugin has finished activation;
inspect plugin status separately.

A ten-second deadline returns a failed renderer state, preserving a retry path.
There is no automatic retry loop. Native unavailability prevents a renderer-only
recovery. `app_health` includes renderer state and the last failure; plugin list
responses include renderer availability and per-plugin `unavailableReason` while
waiting for a missing renderer. Normal game/profile activation waiting remains
distinct from a renderer crash.

`app_logs` with source `plugin-import` records import start/completion/failure,
elapsed milliseconds, optional Chromium JS heap bytes and available Electron
renderer memory metrics (Electron's memory fields retain their documented KiB
units). Import deadlines are not proof of an OOM or of a plugin causing a crash.
An abrupt crash can leave a start diagnostic without a completion. Logs are
bounded by the existing app log retention policy; no game memory, tokens, model
prompts or filesystem contents are included in these diagnostics.

The disposable `tests/electron-renderer-recovery.js` and
`tests/electron-native-video.js` tests deliberately crash only their own renderer
and verify the native session/epoch survives. Unit tests cover coalescing,
timeout/retry, native session replacement and absence. This does not repair a
stalled main process or assert that every possible renderer failure has a known
cause.
