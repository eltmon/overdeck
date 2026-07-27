/**
 * Review convergence detection and cycle tracking.
 * Detects when a review loop is not making progress and should be gated.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PAN_DIRNAME, WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/types.js';
import { countSynthesisBlockingFindings, findBlockingFindings } from '../review-findings.js';

export interface ReviewCycleEntry {
  cycle: number;
  runId: string;
  atCommit?: string;
  blockingCount: number;
  recordedAt: string;
}

export const REVIEW_CONVERGENCE_MIN_CYCLES = 3;

/**
 * Find the latest review run directory in a workspace.
 * Looks for 'agent-*-review-*' directories under .pan/review, falling back to .overdeck/review.
 * Returns null if no run directory is found.
 */
export function findLatestReviewRunDir(workspacePath: string): string | null {
  const paths = [
    join(workspacePath, PAN_DIRNAME, 'review'),
    join(workspacePath, WORKSPACE_RUNTIME_DIRNAME, 'review'),
  ];

  for (const reviewDir of paths) {
    if (!existsSync(reviewDir)) continue;

    try {
      const entries = readdirSync(reviewDir);
      const reviewDirs = entries.filter(name => /^agent-.*-review-/.test(name));
      if (reviewDirs.length === 0) continue;

      // Sort by mtime descending (newest first)
      const sorted = reviewDirs
        .map(name => ({ name, mtime: statSync(join(reviewDir, name)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      return join(reviewDir, sorted[0].name);
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Count blocking findings for a specific review run.
 * First tries synthesis.md '## Blocking Findings' heading count,
 * falls back to summing findBlockingFindings across .md report files,
 * returns null if no artifacts exist.
 */
export function countBlockingFindingsForRun(runDir: string): number | null {
  const synthesisPath = join(runDir, 'synthesis.md');

  // Try synthesis first
  if (existsSync(synthesisPath)) {
    try {
      const synthBody = readFileSync(synthesisPath, 'utf8');
      const count = countSynthesisBlockingFindings(synthBody);
      if (count > 0 || synthBody.includes('## Blocking Findings')) {
        return count;
      }
    } catch {
      // Fall through to report sum
    }
  }

  // Fall back to report sum
  try {
    const entries = readdirSync(runDir);
    const reportFiles = entries.filter(name => name.endsWith('.md') && name !== 'synthesis.md');

    if (reportFiles.length === 0) return null;

    let totalCount = 0;
    for (const file of reportFiles) {
      const content = readFileSync(join(runDir, file), 'utf8');
      const findings = findBlockingFindings(content);
      totalCount += findings.length;
    }

    return totalCount;
  } catch {
    return null;
  }
}

/**
 * Evaluate whether a review cycle series is converging.
 * Returns 'not-converging' when:
 *   - counts.length >= 3 AND the series shows a reversal (count[n-1] > count[n-2]), OR
 *   - the last two transitions are both non-decreases (going backwards)
 * Otherwise returns 'converging'.
 */
export function evaluateReviewConvergence(counts: number[]): 'converging' | 'not-converging' {
  if (counts.length < REVIEW_CONVERGENCE_MIN_CYCLES) {
    return 'converging';
  }

  const n = counts.length;

  // Check for reversal: the latest value > previous value (an increase after decreases)
  const hasReversal = counts[n - 1] > counts[n - 2];
  if (hasReversal) {
    return 'not-converging';
  }

  // Check for two consecutive non-decreases (stall):
  // counts[n-3] <= counts[n-2] AND counts[n-2] <= counts[n-1]
  const isFirstNonDecreasing = counts[n - 2] >= counts[n - 3];
  const isSecondNonDecreasing = counts[n - 1] >= counts[n - 2];
  if (isFirstNonDecreasing && isSecondNonDecreasing) {
    return 'not-converging';
  }

  return 'converging';
}
