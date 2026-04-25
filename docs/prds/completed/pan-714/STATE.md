# PAN-714 — Planning State

## Issue
**Title:** fix(pan-705 followup): clean up stale `.claude/skills/` references and add unit tests for `doneCommand`/`approveCommand`
**URL:** https://github.com/eltmon/panopticon-cli/issues/714
**Type:** Cleanup + test debt (follow-up from PAN-705 command taxonomy reorg)

## Problem

Two unrelated gaps surfaced by the PAN-705 command taxonomy reorg (PR #708):

### 1. Stale project-level `.claude/skills/`

The repo tracks 26 skill directories under `.claude/skills/` (separate from the canonical `skills/` source-of-truth distributed by `pan sync`). These drifted:

- **Stale command refs** — files reference `pan work list` (renamed to `pan issues`), `pan cloister start` / `pan specialists wake` (moved under `pan admin *`). Affected: `pan-tracker`, `pan-help`, `pan-setup`, `pan-quickstart`, `pan-projects`, `pan-up`, `pan-plan`, `pan-issue`, `test-specialist-workflow`.
- **Orphan skills** — 5 entries only exist in `.claude/skills/` and were removed from canonical `skills/`: `hume-evi`, `pan-dashboard-restart`, `rebase-and-submit`, `test-specialist-workflow`, `update-panopticon-docs`.
- **Missing new skills** — 56 canonical skills in `skills/` are NOT mirrored into `.claude/skills/`, including every new PAN-705 name (`pan-issues`, `pan-admin`, etc.).
- **Structural bugs** — nested duplicates: `pan-new-project/pan-new-project/SKILL.md`, `work-complete/work-complete/SKILL.md`.
- **Content drift** — `plan`, `pan-oversee`, `pan-skill-creator`, `pan-new-project` differ between the two trees.

**Root cause:** `pan sync` only maintains `~/.claude/skills/` (user-level). It does not touch project-level `.claude/skills/`. The project tree is hand-maintained and decays silently.

**User intent verified:** All 26 tracked entries under `.claude/skills/` are panopticon-managed — no user-authored or non-panopticon skills exist in that tree, so deleting/overwriting is safe.

### 2. No unit tests for `doneCommand` / `approveCommand`

- `src/cli/commands/work/done.ts` — 535 lines. `doneCommand` tangles: pre-flight checks (open beads, uncommitted changes w/ monorepo+polyrepo branches, vBRIEF AC completeness), rebase-and-push, Linear/GitHub tracker update, review-artifact creation, auto-review HTTP trigger with self-healing reset/retry. **Zero tests.**
- `src/cli/commands/work/approve.ts` — 214 lines. `approveCommand` wraps `findPRForBranch`, `mergePR`, `updateLinearStatus`. **Zero tests.**
- Existing test convention (`tests/cli/commands/work/reopen.test.ts`) is: export pure helpers from the command file, import them in tests via dynamic import, assert on pure behavior.

## Approach

### Skills cleanup — regenerate + prevent future drift

**Why not just "delete `.claude/skills/` entirely":** Agents running under Claude Code inside this repo may not have user-level `~/.claude/skills/` populated (e.g., fresh clones, CI sandboxes). Project-level skills are a useful safety net — the problem is the drift, not the existence of the directory.

**Why not "surgical edits only":** Leaves structural bugs (nested dirs, orphans, 56 missing new skills) and the drift will recur the next time `skills/` changes.

**Chosen:**
1. Regenerate `.claude/skills/` as an exact mirror of canonical `skills/` (delete stale tree, copy current, preserve `.gitignore`).
2. Extend `pan sync` so it *also* populates project-level `.claude/skills/` from `./skills/` when run inside a repo that has a top-level `skills/` directory with SKILL.md files (i.e., the panopticon-cli repo itself). This makes drift self-healing: any future rename in `skills/` + a `pan sync` run will push the change into `.claude/skills/` automatically.

### Tests — extract pure helpers AND add command-level behavior tests

User chose "both" over "helpers only" or "command-level only". Plan:

1. **Extract pre-flight checks from `done.ts` into `src/lib/work/done-preflight.ts`:**
   - `checkOpenBeads(workspacePath, issueId): Promise<string[]>` — runs `bd list --status open`, returns failure lines.
   - `checkUncommittedChanges(workspacePath): Promise<string[]>` — detects mono vs polyrepo via top-level `.git`, walks sub-dirs when polyrepo, returns failure lines.
   - `checkVBriefACStatus(workspacePath): string[]` — wraps `getVBriefACStatus`, returns failure lines.
   - `runPreflightChecks(workspacePath, issueId): Promise<string[]>` — composes all three and also triggers the existing `syncBeadStatusToVBrief` pass before the AC check. Consumers call this and decide whether to fail.
   - `doneCommand` becomes: `if (!options.force) { const failures = await runPreflightChecks(...); if (failures.length) { print + exit(1); } }`.
2. **Extract approve helpers:** `findPRForBranch`, `mergePR`, `updateLinearStatus` in `approve.ts` already live at module scope but aren't exported. Export them and make them injectable enough to unit-test (the existing `checkGhCli` / `execSync` boundaries are acceptable — tests mock `child_process`).
3. **Unit tests** for extracted helpers — one test file per helper file, covering happy / failure / edge cases.
4. **Command-level tests** for `doneCommand` and `approveCommand`: `--force` bypass, shadow-mode skip, issue-id normalization (`agent-pan-714` / `PAN-714` / `pan-714`), Linear vs GitHub branch selection, dashboard-unreachable graceful path.

### Test scope — which behaviors must be covered (agent judgment)

- Pre-flight checks (all three: beads / git mono+polyrepo / vBRIEF AC) — highest value, most complex logic, most likely to regress.
- `--force` bypasses all pre-flight checks.
- Shadow mode skips the tracker update path (Linear + GitHub).
- Issue-id normalization: `agent-pan-714` → `PAN-714`, case-insensitive.
- `approveCommand`: `findPRForBranch` returns null / PR object; `updateLinearStatus` finds state / state-missing error path.

**Out of scope:** Rebase/push end-to-end (already tested indirectly via `rebase-helper` tests), auto-review HTTP path (tests would mock `http.request` with low leverage), artifact creation (covered by `review-artifacts` module tests).

## Constraints

- **No scope creep.** This is a cleanup issue. Do not rewrite `doneCommand`; only extract pre-flight checks. Do not restructure `approveCommand`; only export and test the helpers it already has.
- **Preserve existing behavior exactly.** Pre-flight extraction must produce identical failure output and exit codes. Add a snapshot/golden-output test for one failing-pre-flight run to lock this in.
- **Don't break `pan sync` for non-panopticon projects.** The new project-level `.claude/skills/` mirror must only activate when a top-level `./skills/` directory exists with at least one `SKILL.md` descendant. Every other project behaves exactly as before.
- **Keep `.gitignore` inside `.claude/skills/`** — it ignores Panopticon-managed symlinks created by older `pan sync` versions.
- **Vitest + existing test conventions only.** No new test frameworks.

## Out of scope

- `src/cli/commands/specialists/done.ts` (156 lines, also untested) — not mentioned in the issue. Separate follow-up.
- `work/done.ts` auto-review self-healing path (complex HTTP mocking, low value).
- Refactoring `doneCommand` beyond pre-flight extraction.
- Touching the user-level `~/.claude/skills/` sync path.

## Acceptance signals

- `rg -n "pan work list|pan cloister start|pan specialists wake" .claude/skills/` returns zero matches.
- `diff -r skills/ .claude/skills/` returns only the `.gitignore` as an exception (or `.claude/skills/` is a strict superset with just `.gitignore` extra).
- `pan sync` run inside panopticon-cli reports "synced N project-level skills" and produces no diff on a clean tree.
- `npm run test -- tests/cli/commands/work/done` and `tests/cli/commands/work/approve` both pass with >0 assertions.
- `npm run typecheck` and `npm run lint` pass.
