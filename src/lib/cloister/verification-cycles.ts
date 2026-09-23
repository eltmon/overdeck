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

/** Failed verification attempts allowed before the work agent is paused. */
export const VERIFICATION_MAX_CYCLES = 3;
/** Repeat failures on the same check that count as "no progress". */
export const NO_PROGRESS_REPEAT_THRESHOLD = 2;

export function isFinalVerificationAttempt(cycleCount: number): boolean {
  return cycleCount >= VERIFICATION_MAX_CYCLES;
}

/**
 * PAN-3917: "no progress" is read from the per-run verification artifacts at
 * the current HEAD, not from a stored cycle counter and its notes string.
 */
export function shouldEscalateVerificationFailure(
  cycles: VerificationCycleState,
  failedCheck: string,
  cycleCount: number,
): boolean {
  if (isFinalVerificationAttempt(cycleCount)) return true;
  return cycleCount >= NO_PROGRESS_REPEAT_THRESHOLD && cycles.lastFailedCheck === failedCheck;
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

function readRunArtifacts(workspacePath: string): Array<{ name: string; artifact: VerificationArtifact }> {
  const runsDir = join(workspacePath, RUNS_RELATIVE_DIR);
  if (!existsSync(runsDir)) return [];
  let files: string[];
  try {
    files = readdirSync(runsDir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const runs: Array<{ name: string; artifact: VerificationArtifact }> = [];
  for (const name of files) {
    try {
      runs.push({ name, artifact: JSON.parse(readFileSync(join(runsDir, name), 'utf-8')) as VerificationArtifact });
    } catch {
      // An unreadable run is evidence of nothing.
    }
  }
  return runs;
}

/** CI test-job results (`via: 'ci'`), newest first, with the head each was recorded for. */
function readCiRuns(workspacePath: string): Array<{ head8: string; outcome: VerificationArtifact['outcome']; ranAt: string }> {
  return readRunArtifacts(workspacePath)
    .filter(({ artifact }) => artifact.via === 'ci')
    .map(({ name, artifact }) => ({
      head8: artifact.head8 ?? name.replace(/\.json$/, '').split('-').pop() ?? '',
      outcome: artifact.outcome,
      ranAt: artifact.ranAt,
    }))
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}

/** The newest CI test-job result recorded for `head8`, if any (PAN-3965). */
export function readLatestCiTestResult(
  workspacePath: string,
  head8: string | undefined,
): 'passed' | 'failed' | undefined {
  if (!head8) return undefined;
  const latest = readCiRuns(workspacePath).find((run) => run.head8 === head8);
  return latest?.outcome === 'passed' || latest?.outcome === 'failed' ? latest.outcome : undefined;
}

/**
 * PAN-3965: consecutive PR heads whose CI test job failed, newest first,
 * stopping at the first head whose CI test job passed.
 *
 * The per-head count above resets on every commit, and CI runs once per head,
 * so on its own it could never reach the attempt budget for a branch that
 * keeps pushing red tests. This reads the same per-run artifacts across heads;
 * a green CI test job on a head is the reset.
 */
export function readCiTestFailureStreak(workspacePath: string): VerificationCycleState {
  const seen = new Set<string>();
  let cycleCount = 0;
  for (const run of readCiRuns(workspacePath)) {
    if (seen.has(run.head8)) continue;
    seen.add(run.head8);
    if (run.outcome !== 'failed') break;
    cycleCount += 1;
  }
  return cycleCount > 0 ? { cycleCount, lastFailedCheck: 'test' } : { cycleCount };
}
