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

# tracked text files (-I drops binary), minus lockfiles, build output, this script,
# and machine-generated DATA/HISTORY records (issue tracker, vBRIEF plan data, per-issue
# specs/continues/records/review). Those are point-in-time history, not rebrand targets.
_matches() {
  git grep -lI "$1" -- . \
    ':!*.lock' ':!*-lock.json' ':!dist' ':!**/dist/**' ':!scripts/rebrand-codemod.sh' \
    ':!.beads' ':!vbrief' ':!.pan/specs' ':!.pan/continues' ':!.pan/records' ':!.pan/review'
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

# ===========================================================================
# Family 3 — brand word:  Panopticon  ->  Overdeck   (CASE-SENSITIVE)
# Covers prose, comments, UI/log strings AND code symbols (PanopticonX -> OverdeckX).
# Case-sensitive, so it never touches lowercase panopticon / panopticon.db / PANOPTICON_.
# ===========================================================================
echo "Family 3: Panopticon -> Overdeck"
_apply 'Panopticon' 's/Panopticon/Overdeck/g'

# ===========================================================================
# Family 4 — docs domain:  panopticon-cli.com / panopticon.com  ->  overdeck.ai
# MUST run before Family 5 so the slug rename doesn't turn it into overdeck.com.
# ===========================================================================
echo "Family 4: domain -> overdeck.ai"
_apply 'panopticon-cli\.com' 's/panopticon-cli\.com/overdeck.ai/g'
_apply 'panopticon\.com'     's/panopticon\.com/overdeck.ai/g'

# ===========================================================================
# Family 5 — GitHub repo slug:  panopticon-cli  ->  overdeck
# (eltmon/panopticon-cli -> eltmon/overdeck, /Projects/panopticon-cli paths, etc.)
# Distinct from panopticon-agent[bot] (the git bot account, handled/preserved later).
# ===========================================================================
echo "Family 5: repo slug panopticon-cli -> overdeck"
_apply 'panopticon-cli' 's/panopticon-cli/overdeck/g'

# ===========================================================================
# Family 6 — lowercase catch-all:  panopticon  ->  overdeck
# EXCEPT two carve-outs (negative lookahead):
#   panopticon.db    — legacy DB filename (kept; legacy READ paths fixed in Family 7)
#   panopticon-agent — the GitHub bot account (external identity, not renamed)
# Covers: .panopticon home-dir paths, config filenames, the tmux socket, the
# desktop scheme, skill-source, internal names, and lowercase symbols.
# ===========================================================================
echo "Family 6: lowercase panopticon -> overdeck (except .db / -agent)"
_apply 'panopticon' 's/panopticon(?!\.db|-agent)/overdeck/g'
