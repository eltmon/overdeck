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

import { Effect } from 'effect';

import { saveAgentState, type AgentState } from '../agents/agent-state.js';
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

/**
 * Restore a review parent's active run metadata from its round artifacts
 * (PAN-3917: inlined from the deleted `review-run-recovery.ts`, which sat in
 * Appendix A but only ever read the directories this module already owns).
 *
 * Recovery is deliberately fail-closed: it restores a run id only when exactly
 * one round directory belongs to this parent and postdates its start, so an
 * ambiguous workspace never gets the convoy pointed at the wrong round.
 */
export async function resolveReviewParentRunState(
  parent: AgentState,
  options: { persistCurrent?: boolean } = {},
): Promise<AgentState | null> {
  if (!parent.workspace) return null;

  const runId = parent.reviewRunId ?? findRecoverableRunId(parent);
  if (!runId) return null;

  const contextManifestPath = parent.reviewContextManifestPath
    ?? join(parent.workspace, PAN_DIRNAME, 'review', runId, 'context.json');
  const resolved = {
    ...parent,
    reviewRunId: runId,
    ...(existsSync(contextManifestPath) ? { reviewContextManifestPath: contextManifestPath } : {}),
  };
  const changed = resolved.reviewRunId !== parent.reviewRunId
    || resolved.reviewContextManifestPath !== parent.reviewContextManifestPath;

  if (changed || options.persistCurrent) {
    await Effect.runPromise(saveAgentState(resolved));
  }

  return resolved;
}

function findRecoverableRunId(parent: AgentState): string | null {
  const startedAt = Date.parse(parent.startedAt);
  if (!Number.isFinite(startedAt)) return null;

  const reviewRoot = join(parent.workspace, PAN_DIRNAME, 'review');
  if (!existsSync(reviewRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(reviewRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${parent.id}-`))
      .map(entry => entry.name);
  } catch {
    return null;
  }

  const matching = entries.filter((name) => {
    try {
      return statSync(join(reviewRoot, name)).mtimeMs >= startedAt;
    } catch {
      return false;
    }
  });

  return matching.length === 1 ? matching[0]! : null;
}
