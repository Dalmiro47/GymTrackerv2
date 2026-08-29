#!/usr/bin/env bash
# SessionStart hook: warn when the local default branch is behind origin,
# so a new feature branch is never started from stale code.
# Prints nothing when up to date. Must never break session startup:
# any failure (offline, missing branch, not a repo) exits quietly.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

git fetch origin main --quiet 2>/dev/null || exit 0
git rev-parse --verify --quiet main >/dev/null 2>&1 || exit 0

behind=$(git rev-list --count main..origin/main 2>/dev/null) || exit 0

if [ "${behind:-0}" -gt 0 ]; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  cat <<EOF
WARNING - OUTDATED LOCAL MAIN: local 'main' is ${behind} commit(s) behind origin/main (current branch: ${branch}).
Before starting any new work, sync it first:
  git checkout main && git pull origin main
Then create the feature branch from the fresh main.
Claude: do NOT start code changes from the stale main. Tell the user their local main is behind GitHub and offer to run the sync above before anything else.
EOF
fi
exit 0
