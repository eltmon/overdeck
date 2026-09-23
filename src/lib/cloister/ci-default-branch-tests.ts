/**
 * The default branch's current test verdict, for "is this PR's red test job
 * inherited from main?" (PAN-3965, review of #3993 / #4017).
 *
 * Main's CI runs again after every push, and a run takes long enough that the
 * newest commit's test checks are often still queued or in progress. Reading
 * only that commit would see no failures while main is red, so the newest
 * commit whose test checks have all finished decisively is the verdict. A
 * cancelled or stale run says nothing about the code, so it is skipped too.
 */
import { execFile } from 'node:child_process';

import { isCiTestCheckName } from './verification-tests-mode.js';

/** How many default-branch commits to walk back for a finished test run. */
export const DEFAULT_BRANCH_LOOKBACK = 10;

/** Conclusions that are no verdict on the code: skip that commit. */
const INDECISIVE_CONCLUSIONS = new Set(['cancelled', 'stale', 'startup_failure', 'action_required']);

/** Conclusions that mean the test check is broken on the default branch. */
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out']);

interface CheckRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
}

function ghJson<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf-8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout as string) as T);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

/**
 * The test verdict of one commit's check runs: the failing test checks'
 * names, `'pending'` when a test check has not finished decisively, or
 * `'no-tests'` when the commit has no test checks at all.
 */
export function defaultBranchCommitTestVerdict(runs: readonly CheckRun[]): ReadonlySet<string> | 'pending' | 'no-tests' {
  const tests = runs.filter((run) => isCiTestCheckName(run.name));
  if (tests.length === 0) return 'no-tests';
  const undecided = tests.some((run) => run.status !== 'completed'
    || INDECISIVE_CONCLUSIONS.has((run.conclusion ?? '').toLowerCase()));
  if (undecided) return 'pending';
  return new Set(tests
    .filter((run) => FAILING_CONCLUSIONS.has((run.conclusion ?? '').toLowerCase()))
    .map((run) => run.name!));
}

/**
 * Names of the test checks failing on the newest default-branch commit whose
 * test checks all finished (`owner/repo`). An empty set when the default
 * branch runs no test checks at all (nothing there to inherit). null when the
 * verdict is unknown: every recent commit's tests are still running or were
 * cancelled, or the forge could not be read.
 */
export async function readDefaultBranchFailingTestChecks(repo: string): Promise<ReadonlySet<string> | null> {
  try {
    const shas = await ghJson<string[]>([
      'api', `repos/${repo}/commits?per_page=${DEFAULT_BRANCH_LOOKBACK}`, '--jq', '[.[].sha]',
    ]);
    let sawTestChecks = false;
    for (const sha of shas) {
      const runs = await ghJson<CheckRun[]>([
        'api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
        '--jq', '[.check_runs[] | {name, status, conclusion}]',
      ]);
      const verdict = defaultBranchCommitTestVerdict(runs);
      if (verdict === 'no-tests') continue;
      sawTestChecks = true;
      if (verdict === 'pending') continue;
      return verdict;
    }
    if (!sawTestChecks) return new Set();
    console.log(
      `[ci-failure-feedback] No finished test run in the last ${shas.length} commits of ${repo}'s default branch; its test verdict is unknown`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not read the default branch's checks for ${repo}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
