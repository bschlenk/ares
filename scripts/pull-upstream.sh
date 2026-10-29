#!/bin/bash
# Merge official ares changes into the current branch.
set -eu

cd "$(dirname "$0")/.."

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [upstream-branch]" >&2
  exit 1
fi
branch=${1:-master}

if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "Check out a branch before merging upstream." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash all changes (including untracked files) before merging upstream." >&2
  exit 1
fi
if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "Finish or abort the current merge before merging upstream." >&2
  exit 1
fi

# Read the configured URL rather than a URL expanded by Git's insteadOf rules.
if url=$(git config --get remote.upstream.url); then
  case "$url" in
    https://github.com/ares-emulator/ares|https://github.com/ares-emulator/ares.git|git@github.com:ares-emulator/ares|git@github.com:ares-emulator/ares.git|ssh://git@github.com/ares-emulator/ares|ssh://git@github.com/ares-emulator/ares.git) ;;
    *)
      echo "Remote 'upstream' points to '$url', expected ares-emulator/ares." >&2
      echo "Check it, then run: git remote set-url upstream https://github.com/ares-emulator/ares.git" >&2
      exit 1
      ;;
  esac
else
  git remote add upstream https://github.com/ares-emulator/ares.git
fi

echo "Fetching upstream branch $branch..."
# Merge exactly the fetched branch, even with a custom remote fetch refspec.
git fetch --no-tags upstream "refs/heads/$branch"
echo "Merging upstream/$branch into the current branch..."
if git merge --no-edit FETCH_HEAD; then
  echo "Upstream merge complete."
else
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    # Only resolve retired paths that are absent from our pre-merge tree.
    # NUL delimiters preserve spaces and other special characters in paths.
    deleted=()
    while IFS= read -r -d '' path; do
      case "$path" in
        desktop-ui/cmake/*|desktop-ui/game-browser/*|desktop-ui/presentation/*|desktop-ui/program/*|desktop-ui/resource/*|desktop-ui/settings/audio.cpp|desktop-ui/settings/cores.cpp|desktop-ui/settings/developer.cpp|desktop-ui/settings/emulators.cpp|desktop-ui/settings/firmware.cpp|desktop-ui/settings/home.cpp|desktop-ui/settings/hotkeys.cpp|desktop-ui/settings/importexport.cpp|desktop-ui/settings/input.cpp|desktop-ui/settings/options.cpp|desktop-ui/settings/paths.cpp|desktop-ui/settings/video.cpp|desktop-ui/input/hotkeys.cpp|desktop-ui/tools/*|desktop-ui/CMakeLists.txt|desktop-ui/desktop-ui.cpp|desktop-ui/macos-fix-jit.cpp|hiro/*|tools/genius/*|mia/program/*|mia/cmake/*|ruby/video/*|ruby/input/*|.github/workflows/build.yml|.github/workflows/build-aux.yml|.github/workflows/pr.yml|.github/workflows/push.yml|.github/workflows/release.yml|.github/scripts/build_macos.sh|.github/scripts/build_ubuntu.sh|.github/scripts/build_windows.sh|.github/scripts/package_artifacts.sh)
          if ! git cat-file -e "HEAD:$path" 2>/dev/null; then
            deleted+=("$path")
          fi
          ;;
      esac
    done < <(git --no-optional-locks diff --name-only --diff-filter=U -z)

    if [ "${#deleted[@]}" -gt 0 ]; then
      git rm -f -- "${deleted[@]}"
      printf 'Preserved intentional deletion: %s\n' "${deleted[@]}"
    fi

    if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
      git commit --no-edit
      echo "Upstream merge complete (intentional deletions preserved)."
      exit 0
    fi
    echo "Remaining conflicts:" >&2
    git diff --name-only --diff-filter=U >&2
    echo "Resolve conflicts, stage the resolved files, then run: git merge --continue" >&2
    echo "To cancel the merge, run: git merge --abort" >&2
  fi
  exit 1
fi
