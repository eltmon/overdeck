#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/SKILL.md"
SPEC="$ROOT/references/spec.md"

require_grep() {
  local pattern="$1"
  local file="$2"
  local label="$3"

  if grep -Eq "$pattern" "$file"; then
    printf 'ok - %s\n' "$label"
    return 0
  fi

  printf 'not ok - %s\n' "$label" >&2
  printf 'missing pattern: %s in %s\n' "$pattern" "$file" >&2
  return 1
}

for command in init author convert sync study retro extract validate lint embed; do
  require_grep "^## \`/okf ${command}" "$SKILL" "SKILL.md documents /okf ${command}"
done

require_grep 'read `index.md` first' "$SKILL" "reading rule: read index first"
require_grep 'load only relevant concepts' "$SKILL" "reading rule: load only relevant concepts"
require_grep 'answer only from loaded concepts' "$SKILL" "reading rule: answer only from loaded concepts"
require_grep 'cite concept IDs' "$SKILL" "reading rule: cite concept IDs"
require_grep 'never invent missing knowledge' "$SKILL" "reading rule: never invent"

require_grep 'ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a' "$SPEC" "spec includes upstream source commit SHA"
require_grep 'Apache-2.0' "$SPEC" "spec includes Apache-2.0 attribution"
require_grep '^# Open Knowledge Format \(OKF\)' "$SPEC" "spec includes vendored OKF text"

if grep -RInE 'from +(overdeck|pan)|import +(overdeck|pan)|require\(["'\''](overdeck|pan)' "$ROOT" --include='*.py' --include='*.js' --include='*.ts' --include='*.sh'; then
  printf 'not ok - no Overdeck code dependency under skills/okf\n' >&2
  exit 1
fi
printf 'ok - no Overdeck code dependency under skills/okf\n'

printf 'ok - okf scaffold selftest complete\n'
