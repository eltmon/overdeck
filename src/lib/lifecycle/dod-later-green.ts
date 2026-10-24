/**
 * PAN-3202 / PAN-4618: the later-green-default-branch-run fallback evidence
 * form for DoD row 6 (main verification). Split out of dod-gate.ts to keep it
 * under the file-size guard (never raise `scripts/file-size-allowlist.txt`).
 */
import type { CommitCheckRuns } from '../overdeck/pull-requests.js';
import type { LifecycleContext } from './types.js';

/**
 * PAN-3202: how many CI-bearing default-branch heads above the merge commit are
 * probed for the later-green-run evidence form. The tip of main is often mid-CI,
 * so a single candidate would usually read as pending; five reaches back far
 * enough to find the newest concluded green head without turning one row into a
 * check-run storm.
 */
export const LATER_GREEN_CANDIDATE_LIMIT = 5;

/**
 * PAN-4618: most default-branch commits are bookkeeping pushes (`.pan/**`,
 * `.overdeck/memory/**`) that CI skips entirely, so they carry no CI run and
 * are skipped for free rather than spending the probe budget above. 50 reaches
 * past a long run of bookkeeping commits to find five that actually ran CI.
 */
export const LATER_GREEN_SCAN_LIMIT = 50;

/**
 * PAN-3202: the fallback evidence form for DoD row 6. When a merge lands inside a
 * red-main window, the merge commit's own check-runs can never turn green, so the
 * row was permanently unsatisfiable even after main went green hundreds of times
 * with the commit included. A later default-branch head whose check-runs all
 * concluded green, and which contains the merge commit, is strictly stronger
 * evidence than the original run: it proves main is healthy *with* the merge in it,
 * which is exactly what "verified on main" means. Row 7 (deploy) already reasons
 * this way through the same containment relation.
 */
export function requiredChecksOutcome(checks: CommitCheckRuns, required: string[]): {
  missing: string[];
  unsuccessful: string[];
} {
  return {
    missing: required.filter(check => !checks.names.includes(check)),
    unsuccessful: required.filter(check => checks.names.includes(check) && !checks.successful.includes(check)),
  };
}

export function hasRequiredChecksGreen(checks: CommitCheckRuns, required: string[]): boolean {
  const outcome = requiredChecksOutcome(checks, required);
  return outcome.missing.length === 0 && outcome.unsuccessful.length === 0;
}

export interface LaterGreenDeps {
  readCheckRuns: (ctx: LifecycleContext, commit: string) => Promise<CommitCheckRuns>;
  readContainingDefaultBranchCommits: (ctx: LifecycleContext, mergeCommit: string) => Promise<string[]>;
}

export async function findLaterGreenDefaultBranchRun(
  ctx: LifecycleContext,
  mergeCommit: string,
  required: string[],
  deps: LaterGreenDeps,
): Promise<{ run: { sha: string; total: number } | null; note: string }> {
  let candidates: string[];
  try {
    candidates = await deps.readContainingDefaultBranchCommits(ctx, mergeCommit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { run: null, note: `later-run evidence unavailable: ${message}` };
  }

  let probed = 0;
  for (const sha of candidates.slice(0, LATER_GREEN_SCAN_LIMIT)) {
    if (probed >= LATER_GREEN_CANDIDATE_LIMIT) break;
    try {
      const checks = await deps.readCheckRuns(ctx, sha);
      // PAN-4618: a commit missing a required check carries no CI run (a
      // bookkeeping push) and is no evidence either way — skip it for free.
      if (requiredChecksOutcome(checks, required).missing.length > 0) continue;
      probed += 1;
      if (hasRequiredChecksGreen(checks, required)) {
        return { run: { sha, total: checks.total }, note: '' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { run: null, note: `later-run evidence unavailable: ${message}` };
    }
  }
  return {
    run: null,
    note: candidates.length === 0
      ? 'no later default-branch commit contains the merge'
      : `no green CI run among the ${probed} newest default-branch commit(s) with a CI run containing the merge`,
  };
}
