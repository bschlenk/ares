# Repository conventions

- Use `.js` for JavaScript ES modules inside packages with `"type": "module"`. Never use `.mjs` when the package already declares module mode.
- Write new Node helper scripts as ES modules using `.js` and `import`/`export`; do not add CommonJS `.cjs` helpers.

## Upstream merges

- Read [scripts/UPSTREAM.md](scripts/UPSTREAM.md) before running or resolving an upstream merge. Use `scripts/pull-upstream.sh` on a clean topic branch.
- Inspect the merge base and both sides of each conflict. Preserve upstream core fixes and this fork's Electron/runtime behavior; do not apply blanket `ours`/`theirs` resolutions or copy another fork's deletion list.
- The script automatically preserves conflicts for listed retired paths absent from `HEAD`. Maintain those rules as subsystems are retired or restored. Keep retired desktop/Hiro/standalone GUI paths deleted unless a live consumer requires them. Consult `electron-ui/DESKTOP-RETIREMENT.md`; port relevant loader/input/settings fixes in the active `desktop-ui/emulator/`, `desktop-ui/input/` and `desktop-ui/settings/` paths rather than restoring the old frontend.
- Review cleanly merged changes too, especially CMake, resources, CI and newly added files under retired directories. Resolve build/API changes at their active consumers.
- Stage explicit resolved paths, inspect the staged diff, run the relevant checks, and report the upstream commit, resolutions and validation limits. Keep infrastructure work and the actual upstream merge in separate commits. Do not finish a merge with unresolved conflicts or claim unrun checks passed.

- Preserve upstream paths for upstream-derived code; keep Electron-specific adapters under `electron-ui/`. `desktop-ui/` contains active headless runtime sources, not just retired GUI files. See `desktop-ui/README.md`.
