# A3 — File-size ceiling guard

**Epic:** A (Stop the bleeding) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/a3` (already created, stacked on `codebase-health/a1`) · **Base:** `codebase-health/a1`
**Executor:** Kimi-k2.7-code (handoff conversation), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`**, do NOT open a PR, do NOT touch the pipeline. Commit on this branch; the orchestrator reviews and merges.

---

## Glossary

- **God file** — a source file so large that understanding it to make a change is itself the cost. This repo has 45 non-test `src/` files over 1,000 lines (`src/lib/cloister/deacon.ts` 7,180; `src/dashboard/server/routes/workspaces.ts` 6,638; `src/lib/agents.ts` 5,824).
- **Ceiling** — the maximum line count a *new* file may have: **1,000**.
- **Baseline** — `scripts/file-size-baseline.txt`: the current god files and their line counts. A baselined file may **shrink** but not **grow**; this is the ratchet.
- **Guard-script convention** — this repo enforces invariants with bash scripts wired into `npm run lint` (e.g. `scripts/lint-state-writes.sh`, `scripts/lint-overdeck-boundaries.sh`). A3 adds one more in exactly that style.

---

## Problem

45 non-test `src/` files exceed 1,000 lines. God files are the largest single driver of cognitive load and merge contention, and nothing stops them from growing or new ones from appearing. This sub-issue installs a ratchet: **no new file over 1,000 lines, and no baselined god file may grow.** It does NOT split any file (that is Epic B).

---

## Requirements

**FR-1** — A new guard `scripts/lint-file-size.sh` fails (exit 1) when any non-test `.ts`/`.tsx` file under `src/` that is **not** in the baseline exceeds 1,000 lines.
**FR-2** — The guard fails when any **baselined** file exceeds its recorded baseline line count (god files may shrink, never grow).
**FR-3** — The guard passes (exit 0) on the current branch with a committed `scripts/file-size-baseline.txt` capturing today's 45 offenders.
**FR-4** — The guard is wired into `npm run lint` as `lint:file-size`, and into the chained `lint` script.

**NFR-1** — Pure addition: the only changes are the new script, the new baseline file, and the `package.json` `scripts` block. No production `src/**` code is modified.
**NFR-2** — Async-safe & no execSync (this is a standalone bash script, so just standard shell). Uses `find` + `wc -l`; deterministic ordering via `sort`.
**NFR-3** — Excludes tests (`*.test.ts`, `*.test.tsx`, `**/__tests__/**`), `node_modules`, `dist`, and `.d.ts` declaration files.

---

## Proposal

### WI-1 — Create `scripts/lint-file-size.sh`

```bash
#!/usr/bin/env bash
#
# lint-file-size.sh — ceiling guard against god files (A3, codebase health).
# No NEW non-test src file may exceed CEILING lines; a BASELINED file may shrink
# but never grow. Baseline is scripts/file-size-baseline.txt ("<lines> <path>").
# Regenerate the baseline only to intentionally accept a change (see REGEN below).
#
set -euo pipefail
cd "$(dirname "$0")/.."

CEILING=1000
BASELINE="scripts/file-size-baseline.txt"

if [[ ! -f "$BASELINE" ]]; then
  echo "✖ missing $BASELINE — run the REGEN command in this script's header." >&2
  exit 1
fi

declare -A base
while read -r lines path; do
  [[ -z "${path:-}" ]] && continue
  base["$path"]=$lines
done < "$BASELINE"

fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  allowed="${base["$f"]:-}"
  if [[ -n "$allowed" ]]; then
    if (( n > allowed )); then
      echo "✖ $f grew to $n lines (baseline $allowed) — god files must shrink, not grow."
      fail=1
    fi
  elif (( n > CEILING )); then
    echo "✖ $f is $n lines (> $CEILING) — new files must stay under the ceiling."
    fail=1
  fi
done < <(
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' \
    ! -path '*/__tests__/*' ! -path '*/node_modules/*' ! -path '*/dist/*' \
    | sort
)

if (( fail )); then
  echo ""
  echo "file-size guard failed. Shrink the file, or (to intentionally accept it) regenerate the baseline:"
  echo "  REGEN: see scripts/lint-file-size.sh header / the A3 PRD"
  exit 1
fi
echo "✓ file-size guard passed (no new god files; no baselined file grew)"
```

Make it executable: `chmod +x scripts/lint-file-size.sh`.

### WI-2 — Generate `scripts/file-size-baseline.txt`

Use the **same** enumeration and counter as the guard, so the baseline and the check agree exactly:

```bash
find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' \
  ! -path '*/__tests__/*' ! -path '*/node_modules/*' ! -path '*/dist/*' -print0 \
| xargs -0 -I{} sh -c 'printf "%s %s\n" "$(wc -l < "{}")" "{}"' \
| awk '$1 > 1000' \
| sort -k2 > scripts/file-size-baseline.txt
wc -l scripts/file-size-baseline.txt   # expect ~45 entries
```

Each line is `<lines> <path>` (e.g. `7180 src/lib/cloister/deacon.ts`). Do not hand-edit; the exact set/counts produced by this command are the authoritative baseline.

### WI-3 — Wire into the lint chain

In `package.json`, add the script and append it to the chained `lint`. The current `lint` (already includes A1's eslint change on this branch) ends with `… && npm run lint:prompts`; append `&& npm run lint:file-size`:

```jsonc
"lint": "eslint src/ --ext .js,.ts,.tsx --no-inline-config && npm run lint:effect && npm run lint:permissions && npm run lint:state-writes && npm run lint:overdeck-boundaries && npm run lint:skills && npm run lint:prompts && npm run lint:file-size",
"lint:file-size": "bash scripts/lint-file-size.sh",
```

(Place `lint:file-size` next to the other `lint:*` entries.)

### WI-4 — Verify

```bash
# FR-3: green on the current branch
bash scripts/lint-file-size.sh ; echo "baseline_exit:$? (expect 0)"

# FR-2: a baselined file that grows fails — append a blank line to a god file, test, revert
printf '\n' >> src/lib/cloister/deacon.ts
bash scripts/lint-file-size.sh ; echo "grow_exit:$? (expect 1)"
git checkout -- src/lib/cloister/deacon.ts   # revert the probe (this is reverting YOUR probe edit, allowed)

# FR-1: a new >1000-line non-test file fails
yes 'export const _x = 1;' | head -1001 > src/__sizeprobe.ts
bash scripts/lint-file-size.sh ; echo "newfile_exit:$? (expect 1)"
rm src/__sizeprobe.ts

# FR-4: full lint chain still green
npm run lint ; echo "lint_exit:$? (expect 0)"
```

> Note on the revert: `git checkout -- <file>` to undo **your own** probe edit to a tracked file is fine. Do not `git checkout <branch>` (worktree-discipline) and never `git stash`.

---

## Acceptance criteria

- **AC-1 (FR-1):** a new `src/` file >1,000 lines makes `bash scripts/lint-file-size.sh` exit 1.
- **AC-2 (FR-2):** growing a baselined file (e.g. `deacon.ts`) makes the guard exit 1.
- **AC-3 (FR-3):** on the committed branch, `bash scripts/lint-file-size.sh` exits 0, and `scripts/file-size-baseline.txt` has ~45 `<lines> <path>` entries.
- **AC-4 (FR-4):** `npm run lint` exits 0 and its chain includes `lint:file-size`.
- **AC-5 (NFR-1):** `git diff --name-only origin/main..codebase-health/a3` shows only `scripts/lint-file-size.sh`, `scripts/file-size-baseline.txt`, `package.json`, and the A3 PRD doc — no production `src/**` edits.

---

## Intersecting repo rules (restated — do not assume recall)

- **No bandaids / fix the root cause:** a real guard wired into CI, matching the existing `lint-*.sh` convention — not a one-off check.
- **Surgical changes (Karpathy #3):** every changed line traces to this brief. Don't reformat `package.json` beyond the two additions.
- **Commit per coherent step**, conventional commits (commitlint + husky active), never `--no-verify`. Suggested: `chore(a3): add file-size ceiling guard + baseline`, `chore(a3): wire lint:file-size into lint`.
- **Worktree discipline:** you are in `workspaces/codebase-health-a3` on branch `codebase-health/a3`. Verify with `git branch --show-current` before editing. Never `git checkout <branch>`; never `git stash`. (`git checkout -- <file>` to revert your own probe edit is fine.)
- **A1 ratchet is live on this branch** — though A3 adds no TypeScript, so `no-explicit-any` is not a concern here.
- **Do NOT run `pan done` / `pan start` / open a PR.** Surface blockers to the orchestrator.

## Out of scope

- Splitting or refactoring any god file (that is Epic B).
- Lowering the 1,000-line ceiling or shrinking the baseline (future cleanup).
- Applying the guard outside `src/` (scripts/, packages/).
