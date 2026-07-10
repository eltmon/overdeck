# PAN-2375 — Tame auto-commit churn: 10-min debounce, auto-push policy, divergence surfaced in `pan doctor`

**Issue:** [PAN-2375](https://github.com/eltmon/overdeck/issues/2375)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent, 2026-07-04
**Part of:** [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) CI/CD reliability epic (Phase 3)

## Glossary

- **Auto-commit** — the mechanism in `src/lib/pan-dir/auto-commit.ts` that commits `.pan/` and `.beads/` state files to local `main` automatically. Exposed as `queueAutoCommit()` and `queueBeadsAutoCommit()`.
- **Debounce window** — the timer delay (`DEBOUNCE_MS`) after the last `queueAutoCommit()` call before the commit actually fires. Currently 2,000ms (2 seconds). Each new call within the window resets the timer.
- **`QueuedCommit`** — the internal interface in `auto-commit.ts` holding `paths`, `subjects`, `timer`, and `repoRoot?` for a pending coalesced commit.
- **`doCommit()`** — the internal Effect in `auto-commit.ts` that stages and commits the queued paths. It already runs `git fetch origin main` (for observability only) and explicitly does NOT push.
- **`flushInner()`** — called when the debounce timer fires or `flushAutoCommits()` is invoked manually. Clears the pending queue, adds the task to the serializer chain, calls `doCommit()`.
- **`serializer`** — the module-level `Promise<unknown>` chain in `auto-commit.ts` that ensures commits for the same `projectRoot` never run concurrently.
- **Auto-push** — the new behavior introduced by this fix: after a successful commit, push to `origin` with `--ff-only` to keep local main aligned. On rejection (someone else pushed), fetch + rebase state-only files and retry once. On conflict: log loudly and do not push (human must resolve).
- **Flush window** — the maximum time between commits for the same project root. Fixed at 10 minutes after the last-queued write, regardless of whether writes keep arriving (via a wall-clock max-age guard).
- **`pan doctor`** — the CLI command (`src/cli/commands/doctor.ts`) that checks system health. The new check reports when local `main` is ahead of `origin/main` by more than `DIVERGENCE_WARN_THRESHOLD` commits.
- **`DIVERGENCE_WARN_THRESHOLD`** — the commit-count threshold above which `pan doctor` warns about local/remote divergence. Decision: 5 commits (approximately 50 minutes of churn at the post-fix 10-min cadence, or 1 landed-but-not-pushed flush).
- **Two-door git mirror** — the architectural principle (from the `single-source-of-truth` rule) that canonical state (per-issue records, vBRIEF specs, beads exports) is durably mirrored to git so it travels with the repo across machines. State commits must ride `main` — NOT a dedicated branch — for this mirror to function. (See decision in the Dedicated-branch section.)

## Problem (verified 2026-07-04)

`src/lib/pan-dir/auto-commit.ts` commits at `DEBOUNCE_MS = 2_000` (2 seconds after the last queued write). Under normal Overdeck operation, writes arrive continuously from the Deacon's patrol, planning agents, and beads exports. The 2-second debounce fires ~30 times per hour.

**Evidence:**
- 64 `chore(beads)`/`chore(state)` commits in the last 24 hours (one commit every ~2 min under load).
- `git rev-list --left-right --count origin/main...HEAD` showed `origin=1..2, HEAD=61` on 2026-07-04 (local main 61 commits ahead of origin, 2 commits behind on landed fixes).
- There is currently NO push after commit (verified: `doCommit()` in `auto-commit.ts` has a comment "Refresh origin/main opportunistically for observability only. Background auto-commit must not integrate remote changes" and explicitly does not call `git push`).

**Consequences (from issue):**
1. `pan reload` deploys stale code (PAN-2095 root condition — local HEAD diverged from `origin/main`).
2. Any agent or operator auditing from disk sees a different codebase than `origin/main`.
3. Human push requires rebasing dozens of noise commits.
4. History polluted with ~60 noise commits/day on `main`.

**Verified code** (auto-commit.ts, `DEBOUNCE_MS` constant):
```ts
const DEBOUNCE_MS = 2_000;
```

**Verified code** (auto-commit.ts, `doCommit`, fetch-only comment):
```ts
    // Refresh origin/main opportunistically for observability only. Background
    // auto-commit must not integrate remote changes: rebase rewrites history,
    // and even a fast-forward merge would move the shared primary worktree HEAD.
    // Fetch is safe with a dirty working tree because it updates only remote refs.
    yield* runGit(['fetch', 'origin', 'main'], gitRoot).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.void,
        onFailure: () => Effect.void, // best-effort; network may be down
      }),
    );
```

## Decision: dedicated state branch vs. riding `main`

The issue asks whether to move state commits off `main` to a dedicated branch (e.g., `state/main`). Decision: **NO — state commits must ride `main`**.

Rationale:
- The two-door git mirror (`single-source-of-truth` rule) requires that `.pan/` and `.beads/` state travels with the repo. `git clone` or `git fetch` of `main` must include the state.
- A dedicated `state/main` branch would require every machine, workspace, and agent to fetch an extra ref. The Deacon's startup reconcile, `pan sync-main`, and `findSpecByIssue()` all resolve state from the default fetch ref tree.
- The churn problem is fixed by debounce (10 min) and auto-push (keeping local == origin), not by branch segregation.
- If branch segregation becomes desirable (e.g., to exclude state from CI triggers), a separate issue should be filed with a concrete plan — the scope here is cadence and push policy only.

This decision is recorded here so the work agent does not re-evaluate it.

## Requirements

- **FR-1** — `DEBOUNCE_MS` must be increased to 10 minutes (`10 * 60 * 1000`). Add a **max-age guard**: if a flush has been pending for ≥10 minutes (wall-clock since first `queueAutoCommit` call in this window), fire the commit immediately on the next call, even if writes are still arriving. This prevents indefinite deferral under continuous write load.
- **FR-2** — After a successful `git commit`, `doCommit()` must attempt `git push origin main --ff-only`. On success: done. On non-zero exit (someone else pushed first): run `git fetch origin main`, then `git rebase origin/main --onto origin/main HEAD~<n>` where `n` = the number of state-only commits being pushed (or simpler: rebase the state commits only), and retry push once. On second failure or conflict: log a loud warning (`[pan-dir/auto-commit] push failed — local main ahead of origin by N commits`) and do NOT throw (best-effort).
- **FR-3** — Push must only be attempted when the commit was on `main` (the branch check `branchResult !== 'main'` already exists — push must be inside the same guard).
- **FR-4** — On process shutdown (SIGTERM, SIGINT), any pending debounced commit must be flushed synchronously or via a final async flush before exit.
- **FR-5** — `pan doctor` must include a new check: `git fetch origin main` (best-effort), then `git rev-list --left-right --count origin/main...HEAD`. If local main is ahead by more than `DIVERGENCE_WARN_THRESHOLD` (5), emit a `warn` check result with the count and a fix message.
- **NFR-1** — No `execSync` anywhere in auto-commit.ts or doctor.ts additions. All git operations must use the existing `runGit()` Effect in `auto-commit.ts`, or `execAsync` (promisified `exec`) in `doctor.ts`.
- **NFR-2** — No new explicit `any`. No new files ≥1,000 lines. `auto-commit.ts` is currently ~330 lines; additions must keep it under 500.
- **NFR-3** — Fake timers for any new test that exercises the debounce or max-age guard. No real `setTimeout` sleeps.

## Work items

### W1 — Increase debounce to 10 min and add max-age guard (FR-1)

**File:** `src/lib/pan-dir/auto-commit.ts`

**Step 1: Update `DEBOUNCE_MS` and add `MAX_DEBOUNCE_MS`.**

Grep anchor:
```ts
const DEBOUNCE_MS = 2_000;
```

Replace with:
```ts
/** Debounce: wait this long after the last write before committing. */
const DEBOUNCE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Max-age guard: if a flush has been pending longer than this since the first
 * write in the window, fire immediately on the next queueAutoCommit call.
 * Prevents indefinite deferral under continuous write load.
 */
const MAX_DEBOUNCE_MS = 10 * 60 * 1000; // same as DEBOUNCE_MS — flush on first call after window opens
```

**Step 2: Add `firstQueuedAt` to `QueuedCommit`.**

Grep anchor:
```ts
interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout;
  /** PAN-1908: git checkout to commit into (defaults to projectRoot). */
  repoRoot?: string;
}
```

After:
```ts
interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout;
  /** PAN-1908: git checkout to commit into (defaults to projectRoot). */
  repoRoot?: string;
  /** Wall-clock time of the first queueAutoCommit call in this flush window. */
  firstQueuedAt: number;
}
```

**Step 3: Update `queueAutoCommit()` to set `firstQueuedAt` and apply the max-age guard.**

Grep anchor (inside `queueAutoCommit`):
```ts
  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach((p) => existing.paths.add(p));
    existing.subjects.push(subject);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS);
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS),
    repoRoot,
  });
```

Replace with:
```ts
  const now = Date.now();
  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach((p) => existing.paths.add(p));
    existing.subjects.push(subject);
    // Max-age guard: if the window has been open ≥ MAX_DEBOUNCE_MS, flush now.
    if (now - existing.firstQueuedAt >= MAX_DEBOUNCE_MS) {
      clearTimeout(existing.timer);
      void flushInner(projectRoot);
      return;
    }
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS);
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS),
    repoRoot,
    firstQueuedAt: now,
  });
```

**Step 4: Add shutdown flush.** Near the bottom of `auto-commit.ts`, add:

```ts
/**
 * Register process-exit handlers to flush pending commits on shutdown.
 * Called once at module load. SIGTERM is the standard Deacon shutdown signal.
 */
function registerShutdownFlush(): void {
  const flush = () => {
    for (const projectRoot of pending.keys()) {
      // flushPromise is async; on SIGTERM we can only start it and hope the
      // process waits long enough (Node's default behavior on SIGTERM is
      // immediate exit unless a listener is registered). Register a listener
      // that extends the shutdown window.
      void flushPromise(projectRoot);
    }
  };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
  process.once('beforeExit', flush);
}

registerShutdownFlush();
```

### W2 — Auto-push after successful commit (FR-2, FR-3)

**File:** `src/lib/pan-dir/auto-commit.ts`

Modify `doCommit()`. After the `git commit` succeeds (grep anchor: `return { committed: true };`), add the push logic:

```ts
    // Successful commit — attempt ff-only push to keep local main aligned with origin.
    // Best-effort: failures are logged but never thrown.
    const PUSH_MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= PUSH_MAX_RETRIES; attempt++) {
      const pushResult = yield* runGit(['push', 'origin', 'main', '--ff-only'], gitRoot).pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.succeed({ ok: true as const }),
          onFailure: (err) => Effect.succeed({ ok: false as const, reason: err.stderr || err._tag }),
        }),
      );
      if (pushResult.ok) break;
      if (attempt < PUSH_MAX_RETRIES) {
        // Fetch + rebase to incorporate remote state commits, then retry push.
        console.warn(`[pan-dir/auto-commit] push rejected (${pushResult.reason}) — fetching + rebasing before retry`);
        yield* runGit(['fetch', 'origin', 'main'], gitRoot).pipe(
          Effect.matchEffect({ onSuccess: () => Effect.void, onFailure: () => Effect.void }),
        );
        // Rebase our commits onto the fresh origin/main. State commits are
        // always clean (no production code) so rebase conflicts are rare.
        yield* runGit(['rebase', 'origin/main'], gitRoot).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.void,
            onFailure: (rebErr) => {
              console.warn(`[pan-dir/auto-commit] rebase failed (${rebErr.stderr || rebErr._tag}) — aborting push`);
              return runGit(['rebase', '--abort'], gitRoot).pipe(
                Effect.matchEffect({ onSuccess: () => Effect.void, onFailure: () => Effect.void }),
              );
            },
          }),
        );
      } else {
        // Second failure — surface loudly, do not push.
        const ahead = yield* runGit(['rev-list', '--count', 'origin/main..HEAD'], gitRoot).pipe(
          Effect.matchEffect({ onSuccess: (r) => Effect.succeed(r.stdout.trim()), onFailure: () => Effect.succeed('?') }),
        );
        console.warn(`[pan-dir/auto-commit] push failed after retry — local main ahead of origin by ${ahead} commit(s). Run: git push origin main`);
      }
    }

    return { committed: true };
```

Place this block immediately before the final `return { committed: true };` line (grep anchor: `return { committed: true };`).

### W3 — Tests for W1 and W2 (FR-1, FR-2)

**New test file:** `tests/unit/lib/pan-dir/auto-commit-debounce.test.ts`

Key test cases (use `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`):

```ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('auto-commit debounce and max-age guard', () => {
  it('coalesces writes within the 10-min window into one flush', async () => {
    // Mock runGit / doCommit to count commit calls
    // Queue 5 writes in rapid succession
    // Advance fake timers by 9 minutes → no flush yet
    // Advance by 1 more minute → flush fires once
    // Assert: commit called exactly once with all 5 paths coalesced
  });

  it('fires immediately when MAX_DEBOUNCE_MS elapsed since firstQueuedAt', async () => {
    // Queue first write (sets firstQueuedAt = t0)
    // Advance fake time by MAX_DEBOUNCE_MS
    // Queue second write → should trigger immediate flush (max-age guard)
    // Assert: flush fires without waiting for timer
  });

  it('push is attempted after successful commit (ff-only)', async () => {
    // Mock git push to succeed
    // Queue + flush
    // Assert: git push called with ['push', 'origin', 'main', '--ff-only']
  });

  it('retries push with rebase on first rejection, succeeds on second', async () => {
    // Mock git push: fail first → succeed second
    // Mock git rebase: succeed
    // Assert: rebase called once, push called twice
  });

  it('surfaces loud warning and does not throw on second push failure', async () => {
    // Mock git push: fail twice
    // Mock git rebase: succeed
    // Assert: no exception thrown; console.warn called with 'push failed after retry'
  });
});
```

These tests MUST use `vi.useFakeTimers()`. Real 10-minute delays in tests are forbidden by the fake-timers repo rule.

### W4 — `pan doctor` divergence check (FR-5)

**File:** `src/cli/commands/doctor.ts`

**Step 1: Add `checkOriginMainDivergence` function.** The doctor command structure: each check is a `CheckResult`. Find the section that runs all checks (grep anchor: `checks.push(await checkClosedIssueOrphanAgentDirs(...)`). Add before printing results.

**New function** (add near the other `check*` functions, e.g., after `checkOrphanProposedSpecs`):

```ts
const DIVERGENCE_WARN_THRESHOLD = 5;

/**
 * Check whether local main has diverged from origin/main. Reports when
 * local main is ahead by more than DIVERGENCE_WARN_THRESHOLD commits (the
 * sign that auto-push is failing or hasn't run yet).
 */
export async function checkOriginMainDivergence(projectRoot: string): Promise<CheckResult> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  try {
    // Fetch is best-effort — skip on network failure
    await execAsync('git fetch origin main --quiet', { cwd: projectRoot, timeout: 10_000 }).catch(() => {});
    const { stdout } = await execAsync(
      'git rev-list --left-right --count origin/main...HEAD',
      { cwd: projectRoot, timeout: 5_000 }
    );
    const [behind, ahead] = stdout.trim().split('\t').map(Number);
    const aheadSafe = isNaN(ahead) ? 0 : ahead;
    const behindSafe = isNaN(behind) ? 0 : behind;
    if (aheadSafe > DIVERGENCE_WARN_THRESHOLD) {
      return {
        name: 'Main/Origin Divergence',
        status: 'warn',
        message: `Local main is ${aheadSafe} commits ahead of origin/main (${behindSafe} behind). Auto-push may be failing.`,
        fix: 'Run: git push origin main --ff-only  (or wait for next auto-commit flush to push)',
      };
    }
    return {
      name: 'Main/Origin Divergence',
      status: 'ok',
      message: aheadSafe === 0
        ? 'Local main is aligned with origin/main'
        : `Local main is ${aheadSafe} commit(s) ahead of origin/main (within threshold)`,
    };
  } catch (e) {
    return {
      name: 'Main/Origin Divergence',
      status: 'warn',
      message: `Could not check divergence: ${(e as Error).message}`,
      fix: 'Ensure git and network are available',
    };
  }
}
```

**Step 2: Call `checkOriginMainDivergence` in `doctorCommand`.** Grep anchor:
```ts
  checks.push(checkOrphanProposedSpecs());
```

After that line:
```ts
  // Check local main divergence from origin (auto-commit push health).
  const cwd = process.cwd();
  if (existsSync(join(cwd, '.git'))) {
    checks.push(await checkOriginMainDivergence(cwd));
  }
```

Note: `existsSync` and `join` are already imported in `doctor.ts` (grep: `existsSync` appears multiple times). The `promisify` / `exec` are dynamically imported inside the function to avoid adding new top-level imports.

**Test for W4:** `tests/unit/lib/doctor/origin-divergence.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

describe('checkOriginMainDivergence', () => {
  it('returns warn when ahead > DIVERGENCE_WARN_THRESHOLD', async () => {
    // Mock execAsync to return '0\t10' (0 behind, 10 ahead)
    // Assert: status === 'warn', message contains '10 commits ahead'
  });

  it('returns ok when ahead <= DIVERGENCE_WARN_THRESHOLD', async () => {
    // Mock execAsync to return '0\t3'
    // Assert: status === 'ok'
  });

  it('returns ok when fully aligned', async () => {
    // Mock execAsync to return '0\t0'
    // Assert: status === 'ok', message contains 'aligned'
  });

  it('returns warn (non-fatal) when git command fails', async () => {
    // Mock execAsync to throw
    // Assert: status === 'warn', no exception thrown
  });
});
```

## Re-verify at execution

- **`runGit` return type:** the existing `runGit()` in `auto-commit.ts` returns `Effect.Effect<GitResult, GitError>` where `GitResult = { stdout: string; stderr: string; exitCode: number }`. The `stdout` field is the trimmed output. Verify `r.stdout.trim()` is the right access pattern for the ahead count.
- **Rebase safety:** `git rebase origin/main` in the auto-push path assumes the state commits are clean (no production code). If a non-state file was accidentally included in an auto-commit (excluded by `isAutoCommitExcludedPath()` — verify the exclusion list still covers all production paths), a rebase conflict is still possible. The rebase-abort fallback handles this: it surfaces a warning without destroying state.
- **`registerShutdownFlush` and test isolation:** the module-level `registerShutdownFlush()` call runs once at module load. In tests, ensure `vi.resetModules()` is called in `beforeEach` so each test gets a fresh module without accumulated signal handlers. Or mock `process.once` to prevent handler accumulation.

## Explicitly out of scope

- Moving state commits to a dedicated branch (decision: NO, recorded in the decision section above).
- Changing the `chore(state): batch update N pan/beads file(s)` commit message format (it is the correct batch message; the debounce reduces frequency, the message is fine).
- Fixing PAN-2095 (`pan reload` stale build) — that is a separate issue and separate PRD. The two are belt-and-suspenders: this PRD prevents divergence; PAN-2095 handles the case where divergence still occurs.
- Adding a dashboard health indicator for auto-push state (separate UX concern).
- Changing `queueBeadsAutoCommit()` — it calls `queueAutoCommit()`, which already gets the new debounce.

## Intersecting repo rules (restated for the executor)

- **Fake timers:** all tests that exercise the 10-minute debounce or max-age guard MUST use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`. Real 10-minute delays in tests are categorically forbidden. This is restated because the debounce change (2s → 10min) dramatically raises the stakes for real-timer tests.
- **Async only:** all new git operations use `runGit()` (Effect + ChildProcess) or `promisify(exec)` — never `execSync`.
- **No new explicit `any`:** type all new parameters and return types explicitly.
- **Full gates before `pan done`:** `npm run typecheck`, `npm run lint`, `npm test` (0 failures).
- **Commit often on `main`:** this work happens on a feature workspace. After each coherent bead, commit to the workspace branch. Do not let a large uncommitted change accumulate.

## Acceptance criteria (map 1:1 to work items)

- **AC-1 (W1):** `DEBOUNCE_MS` is `10 * 60 * 1000`. `QueuedCommit` has `firstQueuedAt`. The max-age guard fires immediately when `Date.now() - firstQueuedAt >= MAX_DEBOUNCE_MS`. Fake-timer test proves coalescing behavior.
- **AC-2 (W2):** After a successful commit, `git push origin main --ff-only` is called. On rejection: rebase + retry once. On second failure: loud warning, no exception. All paths tested with fake timers + mocked git.
- **AC-3 (W3):** All test cases in `auto-commit-debounce.test.ts` pass with `vi.useFakeTimers()`. No real 10-min delays.
- **AC-4 (W4):** `pan doctor` includes a `'Main/Origin Divergence'` check. Ahead > 5 → `warn`. Aligned → `ok`. Tests in `origin-divergence.test.ts` pass.
- **AC-5:** typecheck + lint + full suite green; no new `any`; no `execSync`; no real-timer tests for debounce; `auto-commit.ts` ≤500 lines after changes.
