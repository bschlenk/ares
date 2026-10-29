# Merging official ares

`./scripts/pull-upstream.sh [upstream-branch]` merges official ares into the
currently checked-out branch. The default upstream branch is `master`.
Start on a fresh topic branch with a clean working tree, including untracked
files. Commit the merge tooling separately before trying a real merge.

## What the script does

1. Changes to this repository's root and checks for a branch, a clean tree and
   an unfinished merge.
2. Creates `upstream` with `https://github.com/ares-emulator/ares.git` if absent.
   Existing HTTPS and Git-over-SSH URLs for that repository are accepted.
   An unrelated URL fails without being rewritten; inspect it before using the
   printed `git remote set-url` command. `origin` is untouched.
3. Fetches exactly `refs/heads/<branch>` without fetching tags, then merges
   `FETCH_HEAD` with `--no-edit`. This also works with custom fetch refspecs.
   Git may fast-forward, create a merge commit, or report already up to date.
4. On conflicts, automatically preserves deletions for retired paths listed in
   the script, but only when the path is absent from pre-merge `HEAD`. The list
   covers desktop-ui, Hiro, standalone genius/MIA GUI paths, Ruby video/input
   backends and specific retired CI workflows/scripts. It prints each resolution.
   Extracted runtime paths are outside this list and remain for manual review.
5. If all conflicts are resolved, commits the merge with its default message.
   Otherwise prints the remaining conflicts and commands to continue or abort,
   exits nonzero and leaves the merge open. Other failures also exit nonzero.

Beyond preserving listed intentional deletions, the script does not choose
semantic conflict resolutions, run builds, push, or update
subtrees separately. It uses normal Git configuration, including URL rewrites,
merge drivers and hooks. A successful merge command alone does not establish
that the combined code builds or behaves correctly.

## Reviewing conflicts

Record `git rev-parse HEAD`, `git rev-parse FETCH_HEAD` and
`git merge-base HEAD FETCH_HEAD` after fetching. Inspect `git status` and
`git diff --name-only --diff-filter=U`. For a conflicted file, index stages
`:1:path`, `:2:path` and `:3:path` represent the base, this fork and upstream.
Use upstream's diff from the merge base to understand the intended fix.

- Preserve emulator/core improvements while retaining Electron services,
  execution ownership, instrumentation and runtime integration.
- For modify/delete conflicts, consult
  [the retirement inventory](../electron-ui/DESKTOP-RETIREMENT.md). Desktop UI,
  Hiro, standalone MIA/genius GUI and old Ruby video/input backends were
  intentionally removed. Keep deletions where appropriate with
  `git rm -- path`; inspect whether upstream changes need porting to the
  extracted runtime or another active consumer first.
- Resolve CMake/resource/CI conflicts against the Electron build. Review new
  upstream files under retired directories even when Git reports no conflict.
- Do not accept all of one side, delete active runtime directories, or import
  the ares-64 conflict list. That fork has different supported systems and UI.

Stage explicit paths with `git add -- path` or `git rm -- path`. Review
`git diff --cached`, check that no unmerged paths remain and run
`git diff --cached --check`. Build the affected native targets and Electron UI;
run relevant service/core tests and smoke checks as described in
[electron-ui/README.md](../electron-ui/README.md). Report checks that could not
be run and any remaining behavior questions. Then use `git merge --continue`.
To discard the merge attempt, use `git merge --abort` before committing it.

## When to update the tooling

- Change the default branch or accepted remote URLs if official ares moves or
  renames its repository/branch. Add coverage for new accepted URL forms.
- Update these instructions and the retirement inventory when this fork moves
  runtime code, changes supported frontends, or adds/removes active consumers.
- If recurring conflicts justify automation, document a narrow, reviewed rule
  tied to this fork's architecture and add integration fixtures before enabling
  it. Maintain the retired-path patterns in `pull-upstream.sh` when retiring or
  restoring subsystems. The absence-in-HEAD guard protects existing files even
  within listed directories. New upstream files that merge cleanly are not
  removed by these conflict rules; review them separately. Active-code semantic
  resolutions remain manual.
- Adjust validation commands as build targets or test entry points change.

Run `bash -n scripts/pull-upstream.sh` and
`node --test scripts/tests/pull-upstream.test.js` after changing the script.
The tests use temporary local Git repositories and URL rewrites, exercising
remote creation/validation, repeated runs, alternate branches, dirty-tree
rejection, conflicts/abort, automatic deletions (alone and mixed with active
conflicts) and fetch failure without network access.
