#!/usr/bin/env bash
#
# Overdeck rebrand codemod — PAN-1964
# Mechanical Panopticon -> Overdeck rename across the source tree.
# Built and applied one token-family at a time; idempotent and re-runnable.
# Run from anywhere inside the repo.
#
# CARVE-OUTS (this script must NEVER rename these):
#   * PAN- / MIN- issue prefixes        — tracker identity, not the brand
#   * panopticon.db                      — legacy DB filename (rollback / --seed-from-legacy)
#   * the legacy ~/.panopticon home in rollback/import READ paths
#       (handled separately as a hand-edit: a dedicated legacy-home resolver)
#   * lockfiles, dist/, generated output, and this script itself
#
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# tracked text files (-I drops binary), minus lockfiles, build output, and THIS script
_matches() {
  git grep -lI "$1" -- . \
    ':!*.lock' ':!*-lock.json' ':!dist' ':!**/dist/**' ':!scripts/rebrand-codemod.sh'
}

# _apply <grep-pattern> <perl-expr>
_apply() {
  local pat="$1" expr="$2"; local -a f
  mapfile -t f < <(_matches "$pat")
  if [ "${#f[@]}" -gt 0 ]; then
    perl -i -pe "$expr" "${f[@]}"
    echo "  applied to ${#f[@]} files: $expr"
  else
    echo "  no matches for: $pat"
  fi
}

# ===========================================================================
# Family 1 — environment variables:  PANOPTICON_*  ->  OVERDECK_*
# Distinct SCREAMING_CASE token; no collision with PAN- / panopticon.db / Panopticon.
# ===========================================================================
echo "Family 1: PANOPTICON_ -> OVERDECK_"
_apply 'PANOPTICON_' 's/PANOPTICON_/OVERDECK_/g'

# ===========================================================================
# Family 2 — package scope:  @panctl/*  ->  @overdeck/*
# Renames the 4 workspace package names + all imports/deps. The bare `panctl`
# bin name is NOT here (handled in the CLI family). Run `bun install` after to
# re-link the workspace under the new scope.
# ===========================================================================
echo "Family 2: @panctl -> @overdeck"
_apply '@panctl' 's/\@panctl/\@overdeck/g'
