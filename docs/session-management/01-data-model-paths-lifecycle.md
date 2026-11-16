# Task 1: Data model, paths, and lifecycle

Status: **Complete — foundation**, commit `7a2216451`.

Read [the shared preamble](README.md) first. This file preserves task 1's original
requirements for review and later integration; do not redo the task from scratch.
Implementation and validation are recorded in
[the implementation report](../../electron-ui/sessions/IMPLEMENTATION.md) and
[the data-root audit](../../electron-ui/sessions/DATA-ROOT-AUDIT.md).
The actual layout is resolved by `sessions/context.ts` and `repository.ts`; the
layout below is the original architectural suggestion, not a second path contract.
Native writer lifetime protection, game-save inheritance, personal multiwindow,
and the remaining shared-store coordination belong to subsequent tasks. Named
game loads intentionally remain disabled until task 2.

## Requirements

Add `electron-ui/sessions/` modules for contracts, path resolution, repository,
launching, lifecycle locks, and recovery. Extract startup path selection from
`main.ts` into a typed `AppContext` consumed by services:

```ts
type AppContext = {
  kind: 'personal' | 'named';
  instanceId: string;
  sessionId?: string;
  sessionName?: string;
  personalRoot: string;
  dataRoot: string;
  runtimeRoot: string;
};
```

Keep today's default profile as the personal data root so existing saves remain
in place. Treat explicit `ARES_PROFILE`/`ARES_PROFILE_DIR` test and embedding
roots as separate data namespaces. Put sessions and recovery alongside that
namespace in a versioned management directory, with a stable registry location.
Use validated names mapped to UUIDs; never interpolate unchecked names into paths.

Suggested layout:

```text
profiles/default/                    existing personal settings/saves/states
session-management/<namespace>/
  registry.json                     name -> persistent session UUID
  locks/                            stable kernel-lock files, outside generations
  instances/<instance-uuid>/         private Electron/browser data and runtime files
  sessions/<session-uuid>/
    session.json                    schema, ID, name, current generation
    generations/<generation-uuid>/
      data.json                     inheritance policy and initialization ledger
      settings/                     copied settings and imported configuration
      saves/                        private writable resource backing files
      states/                       session-owned managed library
      ...                           other owned persistent profile data
    recovery.json                   archived generations and transaction metadata
```

Use private directory/file permissions and existing validated metadata readers.
Do not serialize endpoint credentials into persistent session manifests.

Creation/open sequence:

1. Lock the namespace registry, validate/resolve the name, and reserve a UUID
   only if absent. Publish a complete initial generation and registry entry
   transactionally; recover incomplete creation without exposing partial data.
2. For a new session, take a coordinated personal settings snapshot. Copy saved
   values and imported BML configuration, preserving unknown/plugin settings.
   Read-only ROM/firmware paths may remain shared. Rebase owned writable paths,
   including `states.root`, and record their personal source separately.
3. Acquire the session lifecycle lock before resolving its current generation.
   Only one app may own a session regardless of service directory or checkout.
   A duplicate open resolves the existing instance, waiting for startup when
   necessary; it never starts a second writer.
4. Give every process its own Electron `userData`/`sessionData` runtime root.
   Route durable settings, plugins, workspace data, and saves explicitly to the
   logical data root rather than relying on `app.getPath('userData')` everywhere.
5. Advertise startup/readiness independently of game load. A locked session
   with an unavailable endpoint is reported as busy/unreachable, never stolen.

Retain save containment checks for named sessions. Overrides must not point into
personal data, another session, recovery generations, or escaping symlinks.
Audit all current user-data consumers, including plugin storage, workspace,
paired recovery, artwork, and imported settings. Shared personal persistent JSON
stores need coordination; caches/logs/runtime snapshots can be instance-local.
Browser local storage must not become the authoritative shared personal store.

---

Previous: [Shared preamble](README.md) · Next: [Task 2: Actual storage ownership and inheritance](02-storage-ownership-inheritance.md)
