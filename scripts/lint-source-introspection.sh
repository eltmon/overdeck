#!/usr/bin/env bash
#
# lint-source-introspection.sh — guard against tests that read source text and
# regex it instead of exercising runtime behavior. Baseline is
# scripts/source-introspection-baseline.txt ("<count> <path>").
# Check mode fails on new offender files, count increases, and stale baseline
# entries. Run with --update to lower stale entries/drop resolved files.
# --update never raises or adds entries; --regen accepts the full current set.
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ "${1:-}" == "--regen" ]]; then
  MODE=regen
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-source-introspection.sh [--update|--regen]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

BASELINE="scripts/source-introspection-baseline.txt"

scan_current() {
  {
    if [[ -d tests ]]; then
      find tests -type f \( -name '*.ts' -o -name '*.tsx' \)
    fi
    if [[ -d src ]]; then
      find src -type f \( -path '*/__tests__/*.ts' -o -path '*/__tests__/*.tsx' -o -name '*.test.ts' -o -name '*.test.tsx' \)
    fi
  } | sort -u | while IFS= read -r path; do
    count=$(
      perl -0ne '
        my $count = 0;
        my $source = $_;
        while ($source =~ /\b(?:[A-Za-z_\$][A-Za-z0-9_\$]*\.)?readFile(?:Sync)?\s*\(/g) {
          my $start = pos($source);
          my $i = $start;
          my $depth = 1;
          my $quote = "";
          my $apos = chr(39);

          while ($i < length($source) && $depth > 0) {
            my $ch = substr($source, $i, 1);
            if ($quote ne "") {
              if ($ch eq "\\") {
                $i += 2;
                next;
              }
              if ($ch eq $quote) {
                $quote = "";
              }
              ++$i;
              next;
            }
            if ($ch eq "\"" || $ch eq $apos) {
              $quote = $ch;
            } elsif ($ch eq "(") {
              ++$depth;
            } elsif ($ch eq ")") {
              --$depth;
            }
            ++$i;
          }

          my $args = substr($source, $start, $i - $start - 1);
          if ($args =~ /"(?:\\.|[^"\\])*?\.tsx?"|\x27(?:\\.|[^\x27\\])*?\.tsx?\x27/s) {
            ++$count;
          }
        }
        print $count;
      ' "$path"
    )
    if (( count > 0 )); then
      printf '%s %s\n' "$count" "$path"
    fi
  done | sort -k2
}

if [[ "$MODE" == "regen" ]]; then
  scan_current > "$BASELINE"
  echo "✓ source-introspection baseline regenerated: $(wc -l < "$BASELINE") offender files"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "✗ missing $BASELINE — run: bash scripts/lint-source-introspection.sh --regen" >&2
  exit 1
fi

declare -A base
while read -r count path; do
  [[ -z "${path:-}" ]] && continue
  base["$path"]=$count
done < "$BASELINE"

tmp_current=$(mktemp)
scan_current > "$tmp_current"

declare -A current
while read -r count path; do
  [[ -z "${path:-}" ]] && continue
  current["$path"]=$count
done < "$tmp_current"

if [[ "$MODE" == "update" ]]; then
  tmp=$(mktemp)
  lowered=0
  dropped=0
  unchanged=0

  while read -r allowed path; do
    [[ -z "${path:-}" ]] && continue

    n="${current["$path"]:-0}"
    if (( n == 0 )); then
      (( ++dropped ))
    elif (( n < allowed )); then
      printf '%s %s\n' "$n" "$path" >> "$tmp"
      (( ++lowered ))
    else
      printf '%s %s\n' "$allowed" "$path" >> "$tmp"
      (( ++unchanged ))
    fi
  done < "$BASELINE"

  sort -k2 "$tmp" > "$BASELINE"
  rm -f "$tmp" "$tmp_current"
  echo "✓ source-introspection baseline updated: $lowered lowered, $dropped dropped, $unchanged unchanged"
  exit 0
fi

fail=0
stale=0

while read -r count path; do
  [[ -z "${path:-}" ]] && continue
  allowed="${base["$path"]:-}"
  if [[ -z "$allowed" ]]; then
    echo "✗ $path has $count source-introspection read(s) but is not baselined."
    fail=1
  elif (( count > allowed )); then
    echo "✗ $path has $count source-introspection read(s) (baseline $allowed) — tests must exercise behavior, not source text."
    fail=1
  elif (( count < allowed )); then
    echo "✗ stale baseline: $path has $count source-introspection read(s) but is baselined at $allowed — run: bash scripts/lint-source-introspection.sh --update"
    stale=1
  fi
done < "$tmp_current"

while read -r allowed path; do
  [[ -z "${path:-}" ]] && continue

  n="${current["$path"]:-0}"
  if (( n == 0 )); then
    echo "✗ stale baseline: $path no longer has source-introspection reads — run: bash scripts/lint-source-introspection.sh --update"
    stale=1
  fi
done < "$BASELINE"

rm -f "$tmp_current"

if (( fail || stale )); then
  echo ""
  if (( fail )); then
    echo "source-introspection guard failed. Rewrite the test to exercise runtime behavior, or use --regen only in an audited accept-new-offender commit."
  fi
  if (( stale )); then
    echo "source-introspection guard found stale baseline entries. Update the baseline:"
    echo "  bash scripts/lint-source-introspection.sh --update"
  fi
  exit 1
fi

echo "✓ source-introspection guard passed (no new source-text tests; baseline is current)"
