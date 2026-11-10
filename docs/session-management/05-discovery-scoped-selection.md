# Task 5: Discovery and scoped selection

Status: **Not started**. Depends on tasks 1–4; coordinate activation with task 6.

Read [the shared preamble](README.md) first. The existing task 1 launch helper
already probes authenticated `app_status` without native inspection. Extend this
into typed discovery and selection rather than adding a second targeting model.
Wire access operations to the task 6 controller; keep protected operations closed
until that controller exists. Preserve legacy explicit instance targeting while
adding persistent session selection.

## Requirements

Introduce typed management messages separate from native game-service methods.
Discovery is authenticated local metadata access, but it does not require an
external gameplay grant. It must never request native `session.status` as a
probe, create a prompt, change focus, or launch an app.

Advertise instance UUID, kind, persistent session ID/name, opened order, cached
game title/system, loaded/running/paused state, app readiness, and approval state.
Keep this minimal allowlist distinct from game inspection. Preserve private
endpoint-file validation and schema/build negotiation.

Assign a monotonic open sequence under a namespace lock to avoid timestamp ties.
Default resolution chooses the earliest-opened live personal instance. Ignore
named instances for default targeting. Explicit instance selection is pinned to
that UUID; losing it reports disconnection instead of silently choosing another.
Bind any multi-request operation and its cancellation to its initial target and
native identity. Never retry a mutation against a replacement app.

No personal app open, including when only named sessions exist: automatic
default launch opens a new personal app and requires approval. Explicit named
open creates/reuses a session and needs no approval. `agent: true`, a launch flag,
or an environment variable must never turn personal data into an implicitly
authorized workspace.

Proposed public interface, implemented once through the shared tool registry:

| Operation | Behavior |
| --- | --- |
| `sessions_list` | Persisted named sessions plus running instances, including stopped names |
| `session_open(name)` | Create or reopen named storage and return target information |
| `session_select(instance_id or name)` | Resolve a target and return an opaque selection handle |
| `access_request/status/wait` | Request approval or inspect/wait for its state on a personal target |
| `session_reset(name, mode)` | Offline reset with returned recovery ID |
| `session_recovery_list` / `session_restore` | Inspect and restore archived generations |
| `checkpoint_list/load/...` | Managed-library operations, separate from path state tools |

CLI selection: add `ARES_TARGET` for an exported handle scoped to a shell/script
environment; emit safe structured selection results and document usage. Retain
explicit instance targeting and a documented compatibility route for
`ARES_INSTANCE_NAME`/`--instance-name`. Selection precedence is explicit call
target, scoped environment/startup target, then personal default; contradictory
explicit flags should error rather than guess. Names do not change meaning based
on focus. A stopped explicitly selected name may be reopened; a selected instance
UUID never identifies its replacement.

MCP selection: every target-dependent tool accepts an optional opaque `target`
handle. Runtime open/select returns one; retain it across subsequent tool calls
without repeating a session name. A server startup default is immutable, not
modified by runtime selection. Request-local context binds the handle/client
through nested awaits and cancellation. A bounded client pool is keyed by target;
never mutate a singleton client's current target/identity. Include target scope
in operation, artifact, and lease references. Do not interpret a connection as a
conversation or expose an adapter-global mutable selection. Test two interleaved
callers sharing one MCP adapter.

---

Previous: [Task 4: Managed states and recovery](04-managed-states-recovery.md) · Next: [Task 6: Approval, cancellation, and revocation](06-approval-cancellation-revocation.md)
