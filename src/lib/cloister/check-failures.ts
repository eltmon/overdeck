/**
 * Failing checks on a PR head, read from GitHub's `statusCheckRollup`
 * (PAN-4917, moved out of pr-facts.ts). A row fails exactly when
 * `summarizeStatusCheckRollup` in pr-facts.ts counts it as failed: a completed
 * check run whose conclusion is not SUCCESS, NEUTRAL or SKIPPED, or a commit
 * status in FAILURE or ERROR.
 */
import type { IssuePullRequestData } from '../overdeck/pull-requests.js';
import { isCiTestRollupCheck } from './verification-tests-mode.js';

type RollupCheck = NonNullable<IssuePullRequestData['statusCheckRollup']>[number];

/** A failing check as the forge reported it (conclusion or status state, upper-cased). */
export interface FailedCheck {
  name: string;
  conclusion: string;
  /** A commit status's link (Dagger Cloud check page), when the check is a status. */
  targetUrl?: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

/** PAN-4917: every failing check on the head that `include` keeps, each with its conclusion. */
export function listFailedChecks(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
  include: (check: RollupCheck) => boolean = () => true,
): FailedCheck[] {
  const failed: FailedCheck[] = [];
  for (const check of rollup ?? []) {
    if (!include(check)) continue;
    const failure = (verdict: string): FailedCheck => ({
      name: check.name ?? check.context ?? '',
      conclusion: verdict,
      ...(check.targetUrl ? { targetUrl: check.targetUrl } : {}),
    });
    const status = normalize(check.status);
    const conclusion = normalize(check.conclusion);
    const state = normalize(check.state);
    if (status === 'COMPLETED' && conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) {
      failed.push(failure(conclusion));
    } else if (state === 'FAILURE' || state === 'ERROR') {
      failed.push(failure(state));
    }
  }
  return failed;
}

/** PAN-3965 (review of #3993): the CI test job's failing checks, each with its conclusion. */
export function listFailedTestChecks(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): FailedCheck[] {
  return listFailedChecks(rollup, isCiTestRollupCheck);
}
