#!/usr/bin/env bash
# Mirror sync-sources/skills/okf/ to the standalone eltmon/okf repo.
#
# Overdeck is the canonical working home of the /okf skill; eltmon/okf is the
# public standalone distribution. This script subtree-splits the skill
# directory's history and pushes it to the mirror. It is deterministic: the
# split of the same history always yields the same commits, so repeated runs
# are fast-forwards unless someone pushed to eltmon/okf directly.
#
# Usage: scripts/mirror-okf-skill.sh [--dry-run]
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
MIRROR_REMOTE="${OKF_MIRROR_REMOTE:-https://github.com/eltmon/okf.git}"
SPLIT_BRANCH="okf-mirror-split"
PREFIX="sync-sources/skills/okf"

cd "$REPO_ROOT"

current_tree="$(git rev-parse "origin/main:${PREFIX}")"
mirror_tip="$(git ls-remote "$MIRROR_REMOTE" refs/heads/main | cut -f1 || true)"

if [[ -n "$mirror_tip" ]] && git cat-file -e "$mirror_tip" 2>/dev/null; then
  mirrored_tree="$(git rev-parse "${mirror_tip}^{tree}")"
  if [[ "$mirrored_tree" == "$current_tree" ]]; then
    echo "okf mirror is up to date (tree ${current_tree:0:12})"
    exit 0
  fi
fi

echo "Splitting ${PREFIX} from origin/main..."
split_sha="$(git subtree split --prefix="$PREFIX" origin/main)"
echo "Split head: $split_sha"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Dry run — would push $split_sha to ${MIRROR_REMOTE} refs/heads/main"
  exit 0
fi

git push "$MIRROR_REMOTE" "${split_sha}:refs/heads/main"
echo "Mirrored ${PREFIX} -> ${MIRROR_REMOTE} main"
