#!/bin/sh
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
    echo "Resolve conflicts, stage the resolved files, then run: git merge --continue" >&2
    echo "To cancel the merge, run: git merge --abort" >&2
  fi
  exit 1
fi
