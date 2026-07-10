# PAN-2297 — File-size baseline auto-lowering on UAT batch merge path

**Issue:** [PAN-2297](https://github.com/eltmon/overdeck/issues/2297)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent, 2026-07-04
**Part of:** epic [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) — Phase 4, review automation + guardrails

## Glossary

- **`lint-file-size.sh --update`** — the auto-lowering mode of `scripts/lint-file-size.sh` (grep anchor: `lint-file-size.sh — ceiling guard against god files`). It lowers the baseline for any file that shrank below its baselined line count, and drops files that fell at or below the ceiling. It NEVER raises entries. Running it requires no issue reference; lowering is always free.
- **`scripts/file-size-baseline.txt`** — the shrink-only ratchet baseline. Each line is `<lines> <path>`. The check mode (`npm run lint:file-size`) fails when a baselined file shrank but the baseline was not updated (stale-high entry).
- **UAT batch merge** — the code path in `POST /api/flywheel/uat-generations/:name/promote` (grep anchor: `postUatGenerationPromotePayload`). It squash-merges several feature branches to `main` in one operation and calls `firePostMergeLifecycle` for each member issue. This path eventually reaches `scripts/post-merge-deploy.sh` — the same shared deploy script used by all other merge paths.
- **`scripts/post-merge-deploy.sh`** — the single shared post-merge hook (grep anchor: `Called as a detached process by postMergeLifecycle`). It: (1) fetches `origin/main`; (2) creates a pristine build worktree (`BUILD_WT`) checked out at `origin/main`; (3) runs `bun install && npm run build` in the worktree; (4) copies `dist/` into `REPO_ROOT`; (5) restarts the server. It does NOT currently run `lint-file-size.sh --update`.
- **`postMergeLifecycle`** — `src/lib/cloister/merge-agent.ts` function (grep anchor: `export async function postMergeLifecycle`). The single entry point for all post-merge work. It spawns `scripts/post-merge-deploy.sh` as a detached child process on every merge path: normal squash-merge, UAT batch, strike (`pan done --strike`), and operator bypass.
- **BUILD_WT** — the throwaway detached git worktree created by `post-merge-deploy.sh` at `$(dirname "$REPO_ROOT")/.pan-deploy-build-$$`, checked out at `origin/main`. It is the correct location to run the auto-lower because it is in the post-merge state of main and is available before it is removed on line 101.

## Problem (verified at `Verified-Against`)

When `uat/pan-cobalt-0703` (containing [PAN-2148](https://github.com/eltmon/overdeck/issues/2148), [PAN-2181](https://github.com/eltmon/overdeck/issues/2181), [PAN-2283](https://github.com/eltmon/overdeck/issues/2283)) was promoted to `main` on 2026-07-03 (commit `ae27bcfa8a`), `src/dashboard/server/routes/workspaces/merge-ops.ts` shrank from 1925 to 1924 lines. The baseline in `scripts/file-size-baseline.txt` stayed at 1925 — the stale-high entry. This made `npm run lint:file-size` fail on main immediately after the batch merge landed.

Root cause: NO merge path runs `lint-file-size.sh --update` automatically after landing to `main`. The only trigger today is manual developer invocation. The issue was patched manually (baseline now shows 1924 at `Verified-Against`), but the structural gap remains: the next batch merge that shrinks a baselined file will produce the same failure.

**Merge paths enumerated (verified by tracing `postMergeLifecycle` callers):**

| Path | Trigger | Reaches `post-merge-deploy.sh`? |
|---|---|---|
| Normal squash-merge | `triggerMerge()` in `merge-ops.ts` (grep anchor: `await postMergeLifecycle(issueId, projectPath, branchName)` at line ~1201) | Yes |
| UAT batch promote | `postUatGenerationPromotePayload` → `promoteUatGeneration` → `firePostMerge` → `postMergeLifecycle` | Yes |
| Strike merge | `pan done --strike` → `postMergeLifecycle` in `src/cli/commands/done.ts` (grep anchor: `Strike post-merge handoff completed`) | Yes |
| Already-merged PR recovery | `merge-ops.ts:937` `await postMergeLifecycle(issueId, projectPath, branchName)` | Yes |
| Operator bypass | Calls `postMergeLifecycle` manually | Yes |

All paths converge on `postMergeLifecycle` → `scripts/post-merge-deploy.sh`. The fix in ONE place covers ALL paths.

## Requirements

- **FR-1** — `scripts/post-merge-deploy.sh` MUST run `lint-file-size.sh --update` in the `BUILD_WT` (the pristine `origin/main` worktree) after the build succeeds, before the worktree is removed.
- **FR-2** — If `lint-file-size.sh --update` lowered any baseline entries, the change MUST be committed in `BUILD_WT` and pushed to `origin/main` before the worktree is removed. The commit message MUST contain the issue ID so `lint-ratchet-audit.sh` accepts it as an audited change.
- **FR-3** — If the push fails (race condition: another push to `main` since our fetch), the script MUST log a warning and continue without exiting non-zero. The auto-lower is best-effort; the next `npm run lint` run in CI will catch the stale baseline.
- **FR-4** — If `lint-file-size.sh --update` found nothing to lower (the common case), NO commit MUST be made. The deploy path stays clean on the happy path.
- **FR-5** — A regression test MUST verify that simulating a post-merge state where a baselined file shrank results in the baseline being lowered. The test does not need to exercise the full deploy script; a unit test that runs `lint-file-size.sh --update` on a fixture directory is sufficient.
- **NFR-1** — No new explicit `any`; no new non-test source file ≥1,000 lines. The change is entirely in `scripts/post-merge-deploy.sh` (a bash script, not counted by the TypeScript ceiling).
- **NFR-2** — The commit authored during the auto-lower is attributed to the CI bot identity (same author as the current auto-commit path uses, or `panopticon-agent[bot]`). No `--no-verify` bypass; the pre-push hook runs `lint-file-size.sh` in check mode which PASSES after the `--update` run.

## Work items

### W1 — Add auto-lower step to `scripts/post-merge-deploy.sh` (FR-1, FR-2, FR-3, FR-4)

**File:** `scripts/post-merge-deploy.sh`.

Insert a new step between the build completion log (`log "Build complete. Built sha=$BUILT_SHA staged at dist.incoming."`, line 104) and the worktree removal (`git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT"`, line 101). The worktree is removed on line 101 — the auto-lower step must go BEFORE line 101.

Locate the insertion point using the grep anchor `Build complete. Built sha=` in `post-merge-deploy.sh`.

The current block (lines 95–104):

```bash
# Stage the freshly built dist into REPO_ROOT (same filesystem) so the final
# swap before restart is a near-atomic directory rename.
rm -rf "$REPO_ROOT/dist.incoming"
cp -a "$BUILD_WT/dist" "$REPO_ROOT/dist.incoming"

# Worktree no longer needed once dist is staged — remove it now.
git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
rm -rf "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
BUILD_WT=""
log "Build complete. Built sha=$BUILT_SHA staged at dist.incoming."
```

After the change (insert the auto-lower block between `cp -a` and the worktree removal):

```bash
# Stage the freshly built dist into REPO_ROOT (same filesystem) so the final
# swap before restart is a near-atomic directory rename.
rm -rf "$REPO_ROOT/dist.incoming"
cp -a "$BUILD_WT/dist" "$REPO_ROOT/dist.incoming"

# --- Auto-lower file-size baseline (PAN-2297) ---
# Run lint-file-size.sh --update in the build worktree. If any baselined file shrank,
# commit and push the lowered baseline to origin/main so the next lint:file-size check
# does not see a stale-high entry. This is best-effort: a push failure (race) is logged
# and skipped — the next CI run will catch the stale baseline.
if bash -c "cd '$BUILD_WT' && bash scripts/lint-file-size.sh --update" >> "$LOG_FILE" 2>&1; then
  if ! git -C "$BUILD_WT" diff --quiet scripts/file-size-baseline.txt 2>/dev/null; then
    log "File-size baseline lowered — committing to origin/main..."
    git -C "$BUILD_WT" config user.email "4205044+panopticon-agent[bot]@users.noreply.github.com" >> "$LOG_FILE" 2>&1 || true
    git -C "$BUILD_WT" config user.name "panopticon-agent[bot]" >> "$LOG_FILE" 2>&1 || true
    git -C "$BUILD_WT" add scripts/file-size-baseline.txt >> "$LOG_FILE" 2>&1
    git -C "$BUILD_WT" commit -m "chore(ratchet): auto-lower file-size baseline post-merge of $ISSUE_ID (PAN-2297)" >> "$LOG_FILE" 2>&1
    if git -C "$BUILD_WT" push origin HEAD:refs/heads/main >> "$LOG_FILE" 2>&1; then
      BUILT_SHA="$(git -C "$BUILD_WT" rev-parse HEAD)"
      log "Auto-lowered file-size baseline pushed to origin/main (new sha=$BUILT_SHA)"
    else
      log "WARN: Auto-lower push failed (race condition or auth — skipping). Baseline will be stale until next lint:file-size --update run."
    fi
  else
    log "File-size baseline is already current — no auto-lower needed."
  fi
else
  log "WARN: lint-file-size.sh --update failed in build worktree — skipping auto-lower."
fi

# Worktree no longer needed once dist is staged — remove it now.
git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
rm -rf "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
BUILD_WT=""
log "Build complete. Built sha=$BUILT_SHA staged at dist.incoming."
```

**Why in BUILD_WT and not REPO_ROOT:** the `BUILD_WT` is checked out at `origin/main` (post-merge state). The REPO_ROOT primary worktree may have local commits or a dirty tree (conversation agents work there). Running the lint against REPO_ROOT's working tree would measure the wrong file contents. The BUILD_WT is the authoritative, clean post-merge state.

**Why before worktree removal:** the worktree is removed unconditionally at lines 101–103. The auto-lower must happen before the removal. The `dist/` has already been staged to `REPO_ROOT/dist.incoming` so the copy is safe.

**Pre-push hook interaction:** the pre-push hook runs `bash scripts/lint-file-size.sh` (check mode, no `--update`). After the auto-lower commit, the baseline is correct; check mode passes. No `--no-verify` needed.

**Test:** `tests/scripts/lint-file-size-auto-lower.test.ts` (new file):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

describe('lint-file-size.sh --update auto-lower regression (PAN-2297)', () => {
  let tmpDir: string;
  let baselineFile: string;
  let fakeFile: string;

  beforeEach(() => {
    tmpDir = mkdirSync(join(os.tmpdir(), `pan-2297-test-${Date.now()}`), { recursive: true }) as unknown as string
      ?? join(os.tmpdir(), `pan-2297-test-${Date.now()}`);
    // Create the fixture directory structure
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    // Create a fake source file with 1500 lines (above the 1000-line ceiling)
    fakeFile = join(tmpDir, 'src', 'bigfile.ts');
    writeFileSync(fakeFile, Array(1500).fill('const x = 1;').join('\n'));
    baselineFile = join(tmpDir, 'scripts', 'file-size-baseline.txt');
    // Baseline says 1501 (file shrank from 1501 to 1500)
    writeFileSync(baselineFile, '1501 src/bigfile.ts\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--update lowers the baseline when a file shrank', () => {
    // Copy the real lint-file-size.sh into the fixture dir so it can be invoked.
    execSync(`cp scripts/lint-file-size.sh ${join(tmpDir, 'scripts', 'lint-file-size.sh')}`);
    execSync(`bash scripts/lint-file-size.sh --update`, { cwd: tmpDir, encoding: 'utf-8' });
    const content = require('node:fs').readFileSync(baselineFile, 'utf-8');
    // Baseline must now say 1500, not 1501
    expect(content).toContain('1500 src/bigfile.ts');
    expect(content).not.toContain('1501 src/bigfile.ts');
  });

  it('check mode fails on a stale-high baseline entry', () => {
    execSync(`cp scripts/lint-file-size.sh ${join(tmpDir, 'scripts', 'lint-file-size.sh')}`);
    expect(() =>
      execSync(`bash scripts/lint-file-size.sh`, { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }),
    ).toThrow(); // exits non-zero
  });

  it('check mode passes after --update lowers the baseline', () => {
    execSync(`cp scripts/lint-file-size.sh ${join(tmpDir, 'scripts', 'lint-file-size.sh')}`);
    execSync(`bash scripts/lint-file-size.sh --update`, { cwd: tmpDir });
    expect(() =>
      execSync(`bash scripts/lint-file-size.sh`, { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }),
    ).not.toThrow();
  });
});
```

This test directly verifies FR-5 (the regression guard): when a baselined file shrinks, `--update` lowers the baseline and check mode subsequently passes.

### W2 — Verify all merge paths reach the new step (implementation checkpoint)

After landing W1, trigger a test merge of a trivially modified PR with a baselined file that has been shortened by one line. Verify in `/tmp/overdeck-deploy.log` (the deploy script log, grep anchor in post-merge-deploy.sh: `LOG_FILE="/tmp/overdeck-deploy.log"`) that either:
- `"Auto-lowered file-size baseline pushed to origin/main"` appears (the lowered case), or
- `"File-size baseline is already current — no auto-lower needed."` appears (the no-change case).

This step is operator-owned (requires a test merge); document the outcome in the issue. Fallback if a test merge is not feasible at PR review: the unit test in W1 (FR-5) provides the structural guarantee; the live checkpoint is marked deferred and added as a follow-up bead.

## Explicitly out of scope

- Auto-lowering the `scripts/source-introspection-baseline.txt` or `eslint-any-allowlist.json` — those have different semantic implications and should not be auto-lowered without human review.
- Auto-lowering the `scripts/circular-deps-baseline.txt` introduced by [PAN-2230](https://github.com/eltmon/overdeck/issues/2230) — that ratchet has different semantics (a removed cycle is a deliberate fix, not a passive shrink; the developer should run `--update` explicitly).
- Adding auto-lowering to the GitHub Actions workflow — the deploy script is the shared, always-runs path.
- Fixing the baseline-enforcement logic itself (no changes to `lint-file-size.sh` other than running it).

## Intersecting repo rules (restated for the executor)

- Async only in server-reachable TypeScript. The change is in a bash script (not server code); this rule does not apply.
- No `execSync` in server-reachable code. The deploy script is a subprocess, not server code.
- No new explicit `any`; no new non-test source file ≥1,000 lines (NFR-1, NFR-2).
- Ratchet increases in `scripts/file-size-baseline.txt` require an issue reference. The auto-lower commit adds a PAN-2297 reference in its message, satisfying `lint-ratchet-audit.sh` for the commit that patches the baseline. Subsequent auto-lower commits on future merges will include the ISSUE_ID of the merged issue — which is an issue reference and satisfies the ratchet-audit requirement.
- Full gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test` (0 failed).
- Work happens in `workspaces/feature-pan-2297/`; never `git checkout` another branch inside the worktree.

## Acceptance criteria (1:1 with work items)

- **AC-1 (W1):** `scripts/post-merge-deploy.sh` runs `lint-file-size.sh --update` in `BUILD_WT` after the build; the step produces no output or a "no auto-lower needed" log on the normal path; the regression test (`lint-file-size-auto-lower.test.ts`) passes with all three cases verified. (FR-1, FR-2, FR-3, FR-4, FR-5)
- **AC-2 (W2):** Post-deploy log (`/tmp/overdeck-deploy.log`) contains either the lowered-and-pushed message or the already-current message, confirming the step ran. If a test merge is not feasible, this AC is deferred and documented in the issue. (implementation checkpoint)
- **AC-3:** `npm run lint:file-size` exits 0 against `Verified-Against` HEAD (the merge-ops.ts baseline is already correct at 1924 after the manual fix; this confirms no regression).
- **AC-4:** typecheck + lint + full suite green; no new `any`; no `execSync` in TypeScript source.
