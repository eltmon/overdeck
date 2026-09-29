#!/usr/bin/env bash
#
# guard-allowlist-raise.sh — refuse agent pushes that raise a file-size ceiling.
# A failing file-size guard (scripts/lint-file-size.sh) is fixed by shrinking
# the file. Raising scripts/file-size-allowlist.txt is an operator decision:
# this guard refuses it for agent pushers (scripts/lib/pusher-identity.sh),
# with OVERDECK_OPERATOR_PUSH=1 as the escape hatch — see
# docs/codebase-health/A3-file-size-guard.md.
#
# Usage: bash scripts/guard-allowlist-raise.sh --range <base>..<head> [--prior <sha>]
#
# --prior grandfathers whatever is already on the remote branch tip: without
# it, an operator raise pushed to a feature branch would be re-refused on
# every later agent push of that same branch (e.g. pan done, sync-main).
#
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pusher-identity.sh

CEILING=1000  # keep in step with scripts/lint-file-size.sh CEILING
ALLOWLIST="scripts/file-size-allowlist.txt"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

if [[ "${OVERDECK_OPERATOR_PUSH:-}" == "1" ]]; then
  exit 0
fi

RANGE=""
HAVE_RANGE=0
PRIOR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      RANGE="${2:-}"
      HAVE_RANGE=1
      shift "$(( $# < 2 ? 1 : 2 ))"
      ;;
    --prior)
      PRIOR="${2:-}"
      shift "$(( $# < 2 ? 1 : 2 ))"
      ;;
    *)
      echo "usage: bash scripts/guard-allowlist-raise.sh --range <base>..<head> [--prior <sha>]" >&2
      exit 2
      ;;
  esac
done

if [[ "$HAVE_RANGE" -ne 1 || -z "$RANGE" || "$RANGE" != *..* || "$RANGE" == ..* || "$RANGE" == *.. ]]; then
  echo "✖ allowlist raise guard: missing or undeterminable push range '$RANGE'; refusing because this is a trust gate." >&2
  exit 1
fi

if ! overdeck_pusher_is_agent; then
  exit 0
fi

BASE="${RANGE%%..*}"
HEAD="${RANGE##*..}"
if ! git rev-parse -q --verify "${BASE}^{commit}" >/dev/null || ! git rev-parse -q --verify "${HEAD}^{commit}" >/dev/null; then
  echo "✖ allowlist raise guard: cannot resolve push range '$RANGE'; refusing because this is a trust gate." >&2
  exit 1
fi

if [[ -z "$(git diff --name-only "$RANGE" -- "$ALLOWLIST" 2>/dev/null || true)" ]]; then
  exit 0
fi

# Prints "<path>\t<cap>" for the last (winning) row per path at $1.
caps_at() {
  local rev="$1"
  local line
  declare -A caps
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([0-9]+)[[:space:]]+([^[:space:]#]+)[[:space:]]+#[[:space:]]*${ISSUE_REF_RE}[[:space:]]*$ ]]; then
      caps["${BASH_REMATCH[2]}"]="${BASH_REMATCH[1]}"
    fi
  done < <(git show "$rev:$ALLOWLIST" 2>/dev/null || true)
  for path in "${!caps[@]}"; do
    printf '%s\t%s\n' "$path" "${caps[$path]}"
  done
}

cap_at() {
  caps_at "$1" | awk -F'\t' -v p="$2" '$1 == p { print $2; exit }'
}

allowance_at() {
  local rev="$1" path="$2" cap
  cap=$(cap_at "$rev" "$path")
  if [[ -n "$cap" ]]; then
    echo "$cap"
    return
  fi
  if git cat-file -e "${rev}:${path}" 2>/dev/null; then
    local n
    n=$(git show "${rev}:${path}" | wc -l)
    if (( n > CEILING )); then
      echo "$n"
    else
      echo "$CEILING"
    fi
  else
    echo "$CEILING"
  fi
}

priors=("$BASE")
if [[ -n "$PRIOR" ]] && [[ ! "$PRIOR" =~ ^0+$ ]] && git cat-file -e "${PRIOR}^{commit}" 2>/dev/null; then
  priors+=("$PRIOR")
fi

raised=()
while IFS=$'\t' read -r path head_cap; do
  [[ -z "$path" ]] && continue
  prior_allowance=0
  for rev in "${priors[@]}"; do
    a=$(allowance_at "$rev" "$path")
    if (( a > prior_allowance )); then
      prior_allowance=$a
    fi
  done
  if (( head_cap > prior_allowance )); then
    raised+=("$path $prior_allowance → $head_cap")
  fi
done < <(caps_at "$HEAD")

if (( ${#raised[@]} > 0 )); then
  echo "✖ allowlist raise guard: this push raises file-size ceilings, and agents may not raise them:" >&2
  for row in "${raised[@]}"; do
    echo "  $row" >&2
  done
  echo "A failing file-size guard is fixed by shrinking the file, not by raising its cap." >&2
  echo "Raising a ceiling is an operator decision made in its own commit and pushed with" >&2
  echo "OVERDECK_OPERATOR_PUSH=1 git push … — see docs/codebase-health/A3-file-size-guard.md." >&2
  exit 1
fi

exit 0
