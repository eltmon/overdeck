# PAN-2230 — Circular-dependency ratchet (madge shrink-only baseline wired into lint)

**Issue:** [PAN-2230](https://github.com/eltmon/overdeck/issues/2230)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent, 2026-07-04
**Part of:** epic [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) — Phase 4, review automation + guardrails
**Status:** Implemented 2026-07-07. See **Implementation notes** below for as-built details.

## Implementation notes (as-built)

The ratchet landed in four commits:

1. `chore(deps): add madge ^8 as devDependency` — installs `madge@8.0.0`.
2. `feat(lint): add circular-dependency ratchet and baseline (PAN-2230)` — adds `scripts/lint-circular-deps.sh`, `scripts/canonicalize-circular-deps.js`, and `scripts/circular-deps-baseline.txt`.
3. `feat(lint): audit circular-deps baseline in ratchet-audit (PAN-2230)` — extends `scripts/lint-ratchet-audit.sh` to audit additions to the circular-deps baseline.
4. `feat(cli): wire lint:circular into npm run lint chain (PAN-2230)` — adds `npm run lint:circular` and appends it to `npm run lint`.

### Deviation from the original PRD

- **Baseline format:** The PRD proposed storing only the first module of each cycle. The implemented baseline stores the full canonical cycle (`src/a.ts > src/b.ts > src/c.ts`, paths sorted) so that replacing one cycle with a different cycle involving the same files is still caught as a new cycle.
- **Cycle count:** The codebase had **77** cycles at implementation time (production source only, excluding test/`__tests__`/`__mocks__`/`.d.ts` files), not 74 as estimated in the PRD.
- **Exclusions:** `lint:circular` passes `--exclude '\/(__tests__|__mocks__)\/|\.(test|spec)\.(ts|tsx)$|\.d\.ts$'` to madge so the ratchet only considers production source cycles (test files, `__tests__`/`__mocks__` directories, and `.d.ts` files are skipped).
- **Script name:** The npm script is `lint:circular` (not `lint:circular-deps`).
- **Helper script:** A small Node helper, `scripts/canonicalize-circular-deps.js`, normalizes madge JSON output. This avoids brittle multi-line `node -e` quoting inside the bash script.

### Running the guard

```bash
npm run lint:circular          # check mode
bash scripts/lint-circular-deps.sh --update  # drop removed cycles from baseline
npm run lint                   # full lint chain, includes circular check
```

### Files

- `scripts/lint-circular-deps.sh` — check/update ratchet.
- `scripts/canonicalize-circular-deps.js` — normalizes madge JSON to canonical cycle lines.
- `scripts/circular-deps-baseline.txt` — 77 canonical cycles, sorted (production source only; test/`__tests__`/`__mocks__`/`.d.ts` files excluded).
- `scripts/lint-ratchet-audit.sh` — now audits the circular baseline for issue references on additions.
- `package.json` — `lint:circular` script and inclusion in `lint`.

## Glossary

- **madge** — a Node.js tool that builds a dependency graph and reports circular import chains. Homepage: https://github.com/pahen/madge. Not installed in the repo today: `package.json` has neither `madge` nor `dependency-cruiser` in `dependencies` or `devDependencies` (grep-verified at `Verified-Against` SHA).
- **Circular dependency** — an import cycle where module A imports B, B imports C, … and C imports A. Node.js ESM rejects these in strict mode; the dashboard's circular imports are the root cause of why it cannot run from `tsx` source-mode and must always be pre-built (background context from [PAN-2230](https://github.com/eltmon/overdeck/issues/2230) issue body).
- **Shrink-only ratchet** — the pattern used by `scripts/lint-file-size.sh`: the baseline records the current "bad" count; the lint check fails if the count grows; it NEVER fails if the count shrinks; `--update` auto-lowers a shrunk baseline. This lets the current debt stand while preventing new debt.
- **Cycle list baseline** — storing the normalized first-module of each cycle (e.g. `lib/agents.ts`) rather than a bare count. More precise: adding a NEW cycle is caught even if an old cycle is removed, keeping the total count unchanged. Less churn-prone than a full path list because the first-module is shorter and more stable than the full chain. **Decision: use the cycle list (one first-module entry per cycle, deduplicated, sorted), not a bare count.** Rationale: a count-only baseline misses net-zero churn (remove one cycle, add one at the same depth → no warning). The first-module list catches this while remaining compact.
- **`lint-ratchet-audit.sh`** — `scripts/lint-ratchet-audit.sh` (grep anchor: `require issue references for ratchet increases`): enforces that any commit raising a ratchet (adding a cycle to the baseline) must include an issue reference in its message.
- **Current cycle count** — **74 cycles**, produced by running `npx madge --circular --extensions ts src/` at `Verified-Against` SHA. The full list is the initial baseline (see W2).

## Problem

The dashboard's circular ESM imports are a standing dev-loop tax: the server cannot run from source (`tsx` / `bun run src/dashboard/server/main.ts`) and must always be run from the pre-built `dist/`. Every time a developer edits dashboard server code they must rebuild before testing, and a stale `dist/` is a class of "why doesn't my fix work" incidents. The root cause is circular dependencies that were introduced incrementally with no guard. A ratchet on the cycle list stops new cycles from being introduced invisibly.

## Requirements

- **FR-1** — `npm run lint` MUST fail when a new circular import cycle is introduced into `src/` that does not appear in `scripts/circular-deps-baseline.txt`.
- **FR-2** — `npm run lint` MUST succeed (and NOT fail) when an existing cycle is removed from `src/` regardless of whether `--update` has been run, UNLESS the baseline is stale-high (same stale-entry failure mode as `lint-file-size.sh`).
- **FR-3** — Running `bash scripts/lint-circular-deps.sh --update` MUST lower the baseline to reflect removed cycles (matching the `--update` semantics of `lint-file-size.sh`).
- **FR-4** — Adding a new cycle to the baseline (raising the ratchet) MUST be rejected by `lint-ratchet-audit.sh` unless the commit message contains an issue reference. Implemented by extending `lint-ratchet-audit.sh` to audit `scripts/circular-deps-baseline.txt`.
- **FR-5** — The initial baseline is populated from the 74 cycles found at `Verified-Against`. The baseline format is one first-module string per line (madge-derived, deduplicated, sorted).
- **NFR-1** — `madge` is added as a `devDependency` in `package.json`, installed via `bun add --dev madge`. The lint script invokes it via `node_modules/.bin/madge` so it is available in CI without a separate install step.
- **NFR-2** — No new explicit `any`; no new non-test source file ≥1,000 lines. New bash scripts are exempt from the TypeScript ceiling.

## Work items

### W1 — Install madge as devDependency (NFR-1)

**File:** `package.json` and `bun.lock`.

```bash
bun add --dev madge
```

Verify:
```bash
node_modules/.bin/madge --version
```

No unit test for the install step — W3 integration-tests it by running the script.

### W2 — `scripts/lint-circular-deps.sh` (FR-1, FR-2, FR-3, FR-5)

**File:** `scripts/lint-circular-deps.sh` (new file). Mirror the structure of `scripts/lint-file-size.sh` (grep anchor: `lint-file-size.sh — ceiling guard against god files`) exactly — same `set -euo pipefail`, same `cd "$(dirname "$0")/.."`, same check/update mode pattern, same stale-baseline detection:

```bash
#!/usr/bin/env bash
#
# lint-circular-deps.sh — shrink-only ratchet on circular ESM import cycles (PAN-2230).
# Baseline is scripts/circular-deps-baseline.txt (one first-module string per cycle, sorted).
# Check mode fails if a NEW cycle appears that is not in the baseline.
# --update lowers the baseline when cycles are removed; never adds new entries.
# Adding entries requires a manual, audited edit with an issue reference (lint-ratchet-audit.sh).
#
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-circular-deps.sh [--update]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

BASELINE="scripts/circular-deps-baseline.txt"
MADGE="node_modules/.bin/madge"

if [[ ! -f "$MADGE" ]]; then
  echo "✖ madge not found at $MADGE — run: bun install" >&2
  exit 1
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "✖ missing $BASELINE — run this after seeding: node_modules/.bin/madge --circular --extensions ts src/ | grep -E '^\s*[0-9]+\)' | sed 's/^[[:space:]]*[0-9]*) //;s/ > .*//' | sort -u > scripts/circular-deps-baseline.txt" >&2
  exit 1
fi

# Produce current cycle set: first-module of each cycle, deduplicated, sorted.
current_cycles() {
  "$MADGE" --circular --extensions ts src/ 2>/dev/null \
    | grep -E '^\s*[0-9]+\)' \
    | sed 's/^[[:space:]]*[0-9]*) //' \
    | sed 's/ > .*//' \
    | sort -u
}

if [[ "$MODE" == "update" ]]; then
  tmp=$(mktemp)
  current=$(current_cycles)
  lowered=0
  unchanged=0

  while IFS= read -r cycle; do
    [[ -z "$cycle" ]] && continue
    if echo "$current" | grep -qxF "$cycle"; then
      echo "$cycle" >> "$tmp"
      (( ++unchanged ))
    else
      (( ++lowered ))
      # Cycle no longer present — drop from baseline (lowering the ratchet)
    fi
  done < "$BASELINE"

  sort -u "$tmp" > "$BASELINE"
  rm -f "$tmp"
  echo "✓ baseline updated: $lowered removed, $unchanged unchanged"
  exit 0
fi

# Check mode
declare -A baselined
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  baselined["$line"]=1
done < "$BASELINE"

fail=0
stale=0

while IFS= read -r cycle; do
  [[ -z "$cycle" ]] && continue
  if [[ -z "${baselined[$cycle]:-}" ]]; then
    echo "✖ new circular dependency introduced: $cycle"
    echo "  Remove the cycle or add it to the baseline in an issue-referenced commit."
    fail=1
  fi
done < <(current_cycles)

# Stale check: baseline entries that no longer exist in codebase.
while IFS= read -r cycle; do
  [[ -z "$cycle" ]] && continue
  if ! current_cycles | grep -qxF "$cycle"; then
    echo "✖ stale baseline: cycle '$cycle' is gone — run: bash scripts/lint-circular-deps.sh --update"
    stale=1
  fi
done < "$BASELINE"

if (( fail || stale )); then
  echo ""
  if (( fail )); then
    echo "circular-dep guard failed. Remove the new cycle, or add it to the baseline in an issue-referenced commit."
  fi
  if (( stale )); then
    echo "circular-dep guard found stale entries. Update the baseline:"
    echo "  bash scripts/lint-circular-deps.sh --update"
  fi
  exit 1
fi

echo "✓ circular-dep guard passed (no new cycles; baseline is current)"
```

**Initial baseline population (run during W2 implementation, before committing):**

```bash
node_modules/.bin/madge --circular --extensions ts src/ 2>/dev/null \
  | grep -E '^\s*[0-9]+\)' \
  | sed 's/^[[:space:]]*[0-9]*) //;s/ > .*//' \
  | sort -u > scripts/circular-deps-baseline.txt
```

At `Verified-Against`, this produces 74 entries. Commit `scripts/circular-deps-baseline.txt` alongside the script.

**Test:** `tests/scripts/lint-circular-deps.test.ts` (new file):

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('lint-circular-deps.sh', () => {
  it('exits 0 in check mode against the current codebase', () => {
    expect(() =>
      execSync('bash scripts/lint-circular-deps.sh', { encoding: 'utf-8', stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('exits 0 with --update when baseline is already current', () => {
    expect(() =>
      execSync('bash scripts/lint-circular-deps.sh --update', { encoding: 'utf-8', stdio: 'pipe' }),
    ).not.toThrow();
  });
});
```

These tests run real madge on real `src/` — they are integration-level and may take ~5s. No fake timers needed (no delays involved).

### W3 — Wire into `npm run lint` chain (FR-1)

**File:** `package.json`.

Current `"lint"` script (grep anchor: `lint:ratchet-audit`):

```
eslint src/ --ext .js,.ts,.tsx --no-inline-config && npm run lint:effect && npm run lint:permissions && npm run lint:state-writes && npm run lint:overdeck-boundaries && npm run lint:skills && npm run lint:prompts && npm run lint:file-size && npm run lint:source-introspection && npm run lint:ratchet-audit
```

After (append `&& npm run lint:circular-deps`):

```
eslint src/ --ext .js,.ts,.tsx --no-inline-config && npm run lint:effect && npm run lint:permissions && npm run lint:state-writes && npm run lint:overdeck-boundaries && npm run lint:skills && npm run lint:prompts && npm run lint:file-size && npm run lint:source-introspection && npm run lint:ratchet-audit && npm run lint:circular-deps
```

New script entry to add in `package.json`:

```json
"lint:circular-deps": "bash scripts/lint-circular-deps.sh"
```

**Verify:** `npm run lint:circular-deps` exits 0 locally.

### W4 — Extend `lint-ratchet-audit.sh` to audit the circular-deps baseline (FR-4)

**File:** `scripts/lint-ratchet-audit.sh`.

`lint-ratchet-audit.sh` currently audits `scripts/file-size-baseline.txt` and `eslint-any-allowlist.json`. Extend it to also audit `scripts/circular-deps-baseline.txt`.

The existing `baseline_increases_for_commit` function uses `awk` on `<lines> <path>` format. The circular-deps baseline has a different format (one string per line, no numeric prefix). Add a new `circular_increases_for_commit` function alongside it.

**Step 1:** add helper functions after the `allowlist_increases_for_commit` function (grep anchor: `allowlist_increases_for_commit`):

```bash
circular_baseline_at() {
  local rev="$1"
  { git show "$rev:$CIRCULAR_BASELINE" 2>/dev/null || true; } | sort -u
}

parent_circular_baseline_at() {
  for parent in "$@"; do
    circular_baseline_at "$parent"
  done | sort -u
}

circular_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  parent_circular_baseline_at "$@" > "$old_file"
  circular_baseline_at "$commit" > "$new_file"
  comm -13 "$old_file" "$new_file" | sed 's/^/circular baseline added: /'
  rm -f "$old_file" "$new_file"
}
```

**Step 2:** declare `CIRCULAR_BASELINE` near the top of the file alongside `BASELINE` and `ALLOWLIST` (grep anchor: `BASELINE="scripts/file-size-baseline.txt"`):

```bash
CIRCULAR_BASELINE="scripts/circular-deps-baseline.txt"
```

**Step 3:** in `audit_commit`, extend the `increases` computation (grep anchor: `local increases`):

**Before:**
```bash
local increases
increases=$(
  baseline_increases_for_commit "$commit" "${parents[@]}"
  allowlist_increases_for_commit "$commit" "${parents[@]}"
)
```

**After:**
```bash
local increases
increases=$(
  baseline_increases_for_commit "$commit" "${parents[@]}"
  allowlist_increases_for_commit "$commit" "${parents[@]}"
  circular_increases_for_commit "$commit" "${parents[@]}"
)
```

**Step 4:** extend both `for file in` loops at the bottom of the script (grep anchor: `for file in "$BASELINE" "$ALLOWLIST"`):

**Before (appears twice):**
```bash
for file in "$BASELINE" "$ALLOWLIST"; do
```

**After:**
```bash
for file in "$BASELINE" "$ALLOWLIST" "$CIRCULAR_BASELINE"; do
```

**Test:** the existing `lint-ratchet-audit.sh` test suite (if any) plus the new test in W2:

```ts
it('ratchet-audit exits 0 with the seeded circular-deps baseline', () => {
  expect(() =>
    execSync('bash scripts/lint-ratchet-audit.sh', { encoding: 'utf-8', stdio: 'pipe' }),
  ).not.toThrow();
});
```

## Explicitly out of scope

- Removing any of the 74 existing cycles — that is follow-up work the ratchet protects; cycle-breaking is a separate campaign.
- Reporting on cycle health in the dashboard UI.
- Integrating madge into the CI GitHub Actions workflow directly (the `npm run lint` step in CI runs `lint:circular-deps`).
- `dependency-cruiser` — madge is the simpler tool and sufficient for the shrink-only ratchet.

## Intersecting repo rules (restated for the executor)

- Ratchet increases (adding a cycle to `scripts/circular-deps-baseline.txt`) require an issue reference in the commit message — `lint-ratchet-audit.sh` enforces this after W4 lands.
- No new explicit `any`.
- Async only in server-reachable code. New bash scripts are not server-reachable.
- Full gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test` (0 failed).
- Work happens in `workspaces/feature-pan-2230/`; never `git checkout` another branch inside the worktree.

## Acceptance criteria (1:1 with work items)

- **AC-1 (W1):** `node_modules/.bin/madge --version` prints a version string; `package.json` `devDependencies` contains `madge`. (NFR-1)
- **AC-2 (W2):** `bash scripts/lint-circular-deps.sh` exits 0 against the seeded baseline; `scripts/circular-deps-baseline.txt` contains exactly 74 entries; `--update` is a no-op when the baseline is already current; the integration test passes. (FR-1, FR-2, FR-3, FR-5)
- **AC-3 (W3):** `npm run lint:circular-deps` exits 0; `npm run lint` chain includes `lint:circular-deps` and exits 0. (FR-1)
- **AC-4 (W4):** `bash scripts/lint-ratchet-audit.sh` exits 0 against the current HEAD; a synthetic commit adding a line without an issue ref exits non-zero (verify manually or in test). (FR-4)
- **AC-5:** typecheck + lint + full suite green; no new `any`.
