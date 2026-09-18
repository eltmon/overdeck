/**
 * How many times verification has failed on the code as it stands (PAN-3917).
 *
 * The circuit breaker used to read `verificationCycleCount` off the review row,
 * a counter three writers incremented and a patrol reset. The per-run artifacts
 * the runner already writes — `<workspace>/.overdeck/verification/<ranAt>-<head8>.json`
 * — answer the same question without a counter: how many failed runs are
 * recorded against the current HEAD.
 *
 * This is strictly better behaviour, not just a re-point. The stored counter
 * needed an explicit reset whenever the agent pushed a fix; a head-scoped count
 * resets itself the moment the commit changes, so real progress always buys a
 * fresh set of attempts and a no-progress loop still trips the breaker.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { VerificationArtifact } from './verification-artifact.js';

const RUNS_RELATIVE_DIR = join('.overdeck', 'verification');

export interface VerificationCycleState {
  /** Failed verification runs recorded against this exact HEAD. */
  cycleCount: number;
  /** The gate the most recent failed run at this HEAD stopped on. */
  lastFailedCheck?: string;
}

/**
 * Count the failed runs recorded for `head8`. An unreadable or absent run
 * directory reports zero cycles — the breaker must never trip on a missing
 * artifact, only on evidence of repeated failure.
 */
export function readVerificationCycleState(
  workspacePath: string,
  head8: string | undefined,
): VerificationCycleState {
  if (!head8) return { cycleCount: 0 };
  const runsDir = join(workspacePath, RUNS_RELATIVE_DIR);
  if (!existsSync(runsDir)) return { cycleCount: 0 };

  let files: string[];
  try {
    files = readdirSync(runsDir).filter((name) => name.endsWith(`-${head8}.json`)).sort();
  } catch {
    return { cycleCount: 0 };
  }

  let cycleCount = 0;
  let lastFailedCheck: string | undefined;
  for (const name of files) {
    let artifact: VerificationArtifact;
    try {
      artifact = JSON.parse(readFileSync(join(runsDir, name), 'utf-8')) as VerificationArtifact;
    } catch {
      continue;
    }
    if (artifact.outcome !== 'failed') continue;
    cycleCount += 1;
    lastFailedCheck = artifact.failedCheck ?? lastFailedCheck;
  }

  return lastFailedCheck ? { cycleCount, lastFailedCheck } : { cycleCount };
}
