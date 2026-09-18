/**
 * Review rounds read from their own artifacts (PAN-3917, FR-7).
 *
 * Convergence used to be judged from `reviewCycleHistory`, an array appended to
 * the `review_status` row by a reconciler, plus a `stuckReason` written beside
 * it. Both were copies of something already on disk: every review round leaves
 * `.pan/review/<runId>/` with the four reviewer reports and a synthesis. Count
 * the blocking findings per round, in order, and the series is the history —
 * with nothing to append, reset, or repair.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PAN_DIRNAME, WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/types.js';
import { countBlockingFindingsForRun, evaluateReviewConvergence } from './review-convergence.js';

export interface ReviewRound {
  runId: string;
  runDir: string;
  blockingCount: number;
}

function reviewRootFor(workspacePath: string): string | null {
  for (const root of [
    join(workspacePath, PAN_DIRNAME, 'review'),
    join(workspacePath, WORKSPACE_RUNTIME_DIRNAME, 'review'),
  ]) {
    if (existsSync(root)) return root;
  }
  return null;
}

/** Every review run directory in a workspace, oldest first. */
export function listReviewRunDirs(workspacePath: string): string[] {
  const root = reviewRootFor(workspacePath);
  if (!root) return [];
  try {
    return readdirSync(root)
      .filter((name) => /^agent-.*-review-/.test(name))
      .map((name) => ({ path: join(root, name), mtime: statSync(join(root, name)).mtime.getTime() }))
      .sort((a, b) => a.mtime - b.mtime)
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

/**
 * The blocking-finding count for each completed review round, oldest first.
 * Rounds with no readable artifacts are skipped — they carry no evidence either
 * way and must not be counted as "zero findings".
 */
export function reviewCycleSeries(workspacePath: string): ReviewRound[] {
  const rounds: ReviewRound[] = [];
  for (const runDir of listReviewRunDirs(workspacePath)) {
    const blockingCount = countBlockingFindingsForRun(runDir);
    if (blockingCount === null) continue;
    rounds.push({ runId: runDir.split('/').pop() ?? runDir, runDir, blockingCount });
  }
  return rounds;
}

export interface ReviewConvergence {
  converging: boolean;
  counts: number[];
  /** `3 → 2 → 4`, for an operator-facing message. Empty when there are no rounds. */
  series: string;
}

/** Is the review loop making progress, judged from the round artifacts alone? */
export function assessReviewConvergence(workspacePath: string | undefined): ReviewConvergence {
  const counts = workspacePath ? reviewCycleSeries(workspacePath).map((round) => round.blockingCount) : [];
  return {
    converging: evaluateReviewConvergence(counts) === 'converging',
    counts,
    series: counts.join(' → '),
  };
}
