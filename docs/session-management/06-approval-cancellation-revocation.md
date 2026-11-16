# Task 6: Approval, cancellation, and revocation

Status: **Complete (renderer plugin management gated)**. Depends on tasks 1–5.
Implementation commit: **`9d0b7ada2`** (`feat(sessions): add personal approval and native revocation barrier`).

Read [the shared preamble](README.md) first. Audit both transport management and
native routing; transport authentication, ownership and approval are separate.
Only activate the integrated access/multiwindow behavior when the revoke barrier,
queued-operation guards and cancellation tests below pass.

## Requirements

Add a main-owned `ExternalAccessController` per instance. Personal state is
`unapproved`, `pending`, `authorized`, or `revoking`, with a monotonically
increasing grant generation. Grants exist only in memory and survive renderer
reloads, never app close/reopen. Named instances bypass prompting by session kind,
not by transport or ownership claims.

Use a small explicit preapproval method allowlist: target discovery, minimal
readiness, access request/status/wait/cancel, and necessary transport negotiation.
Everything else, including reads, captures, artifact retrieval, plugin management,
ROM changes and owner leases, requires the gate. `agent.enabled` controls service
availability; it cannot substitute for personal approval. A copied disabled
personal integration setting must not prevent explicitly opened named sessions
from providing their authorized session interface.

Render one nonmodal Allow/Deny request for a pending personal window. Identify
the instance/game in client pending information and UI. Do not focus the window,
capture controller input, or pause gameplay on request. Deduplicate prompt state
per window while tracking bounded individual waiters. Allow grants all external
clients; Deny resolves current waiters and requires an explicit retry for another
request. Enforce bounds so probes/waiters cannot exhaust the host connection quota.

Separate waiting for access from executing commands. A convenience CLI wait keeps
its intended command client-side until authorized. Add request cancellation and
deadlines to management calls as well as native calls; the existing MCP wrapper
only wraps `client.request`. Aborted waiters detach immediately. Guard again after
every relevant await and just before dispatch/commit. Never store mutations for
execution when Allow is clicked and never replay them on reconnect. Only remove
a pending prompt when no remaining explicit requester needs it.

Revoke sequence, serialized in main:

1. Close the gate immediately and increment generation. Reject queued requests;
   invalidate all external owner leases and target-bound continuations for this
   grant. Do not let a quick reapproval revive old work.
2. Abort external scripts, batches and their child owners, observers, input clips,
   recordings, waiters, pending loads, and in-progress artifact publication.
   Recheck generation before filesystem commits so late results cannot publish.
3. Issue privileged internal owner release/cancel for every external owner,
   including leases surviving disconnect. This cleanup cannot require the grant
   that was just revoked. Preserve human UI/plugin ownership separately.
4. Acknowledge a native revoke barrier: stop active external execution, clear
   held/overridden inputs, and pause. Add a native aggregate cleanup primitive
   if per-owner release cannot make that guarantee atomically. Prevent a late
   focus-pause continuation from resuming gameplay after the barrier.
5. Publish unapproved state and remove the authorization banner. Block new
   approvals until cleanup finishes. If the host is unresponsive, keep access
   closed and terminate/recover it as needed; do not report successful cleanup
   while it might still execute externally owned work.

Carry a grant generation/abort context from the external boundary through router
helpers and queued main operations. Connection reuse and replacement sockets
still pass the same per-window gate. Keep existing native session/epoch validation
and contention checks after approval; authorization does not override ownership.

---

Previous: [Task 5: Discovery and scoped selection](05-discovery-scoped-selection.md) · Next: [Task 7: Identification, toolbar, and captures](07-identification-toolbar-captures.md)

## Implementation and deliberate limits

`ExternalAccessController` owns memory-only window grants, bounded explicit
requesters, deadlines, Deny/cancel, monotonic generations and serialized revocation.
The authenticated boundary carries its guard through main queues, native helpers,
script/batch descendants and file/checkpoint commit points. Allow/Deny is nonmodal;
the personal authorization indicator exposes Revoke. Named services bypass prompts
by session kind, including when copied settings disabled integration.

The native aggregate barrier uses a reserved main-only owner on `session.pause`.
It releases every registered external owner at one safe point, stops execution and
pauses without depending on the revoked grant. Native child owners and detached
input jobs retain external classification. Focus-pause continuations drain before
the barrier and lose their resume entitlement. Barrier failure keeps access closed.

Personal renderer plugin mutation/delegation remains deliberately gated with
`plugin_management_requires_named_session`: `add`, `enable`, `reload`,
`resetStartup`, `open`, and `command` can otherwise escape into the human plugin's
shared SDK callbacks. Named sessions retain the complete interface. This is a
compatibility limit, not a claim that per-invocation plugin provenance is solved.
Human-owned plugins and observers are preserved by the external cleanup barrier.

CLI/MCP expose real `access_request/status/wait/cancel`. Explicit short requests
remain pending until Allow/Deny, cancellation or deadline; waiting callers detach
on disconnect/abort. `--wait-access` keeps CLI intent client-side. A cancelled
native start is cancelled by its exact operation ID even if cancellation precedes
its acknowledgement. No command is queued for execution on Allow.

Evidence and exact commands: [implementation report](../../electron-ui/sessions/IMPLEMENTATION.md)
and [acceptance record](../../electron-ui/ACCEPTANCE.md). Task 7 still owns persistent
named identification and final toolbar/capture presentation. Packaged/manual Dock,
physical-controller approval interaction and final full-spec acceptance remain
unrun; issue #37 remains open.
