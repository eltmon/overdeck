/**
 * The default branch's current test verdict, for "is this PR's red test job
 * inherited from main?" (PAN-3965, review of #3993 / #4017).
 *
 * Most main pushes are bookkeeping commits (`.pan/**`, `.overdeck/memory/**`)
 * that CI skips entirely (PAN-4618), so the newest commit carrying a decisive
 * test run is often many commits back. A commit with no test checks at all
 * (bookkeeping, or a guard-only workflow like `reject-planning-paths`) or one
 * whose test checks were cancelled/stale tells us nothing about the code, so
 * both are skipped for free and do not count against the walk-back budget.
 * Only a commit whose test checks are genuinely still running counts against
 * that budget (`DEFAULT_BRANCH_LOOKBACK`) — those are the ones a concurrency
 * group (PAN-4618) keeps cancelling in favor of the newest push, so walking
 * past more than a handful of them stops being useful.
 *
 * Commit statuses (Dagger Cloud checks) count alongside check runs: each is
 * read through `commitStatusAsCheckRun` and judged by the same verdict
 * (PAN-4589).
 */
import { execFile } from 'node:child_process';

import { isCiTestCheckName, isDaggerCloudTestCheck } from './verification-tests-mode.js';

/** How many default-branch commits with a still-running test check to walk back past. */
const DEFAULT_BRANCH_LOOKBACK = 10;

/** Commits fetched per page when scanning for a decisive test verdict (GitHub's per-page max). */
const DEFAULT_BRANCH_COMMIT_WINDOW = 100;

/** Conclusions that are no verdict on the code: skip that commit. */
const INDECISIVE_CONCLUSIONS = new Set(['cancelled', 'stale', 'startup_failure', 'action_required']);

/** Conclusions that mean the test check is broken on the default branch. */
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out']);

interface CheckRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
  targetUrl?: string;
}

interface CommitStatus {
  name?: string;
  state?: string;
  targetUrl?: string | null;
}

/** PAN-4589: a commit status as a check run, so one verdict reads both. `error` is a failure (D4). */
export function commitStatusAsCheckRun(status: CommitStatus): CheckRun {
  const state = (status.state ?? '').toLowerCase();
  return {
    name: status.name,
    status: state === 'pending' ? 'in_progress' : 'completed',
    conclusion: state === 'pending' ? null : state === 'error' ? 'failure' : state,
    ...(status.targetUrl ? { targetUrl: status.targetUrl } : {}),
  };
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

/** Like `ghJson`, but each stdout line is one page's array; pages are flattened. */
function ghJsonPages<T>(args: string[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf-8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        const pages = (stdout as string).split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T[]);
        resolve(pages.flat());
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

/**
 * The test verdict of one commit's check runs: the failing test checks'
 * names, `'pending'` when a test check is still running, `'indecisive'` when
 * every test check completed but at least one's conclusion carries no
 * verdict on the code (cancelled, stale, …), or `'no-tests'` when the commit
 * has no test checks at all.
 */
export function defaultBranchCommitTestVerdict(runs: readonly CheckRun[]): ReadonlySet<string> | 'pending' | 'indecisive' | 'no-tests' {
  const tests = runs.filter((run) => isCiTestCheckName(run.name) || isDaggerCloudTestCheck(run.name, run.targetUrl));
  if (tests.length === 0) return 'no-tests';
  if (tests.some((run) => run.status !== 'completed')) return 'pending';
  if (tests.some((run) => INDECISIVE_CONCLUSIONS.has((run.conclusion ?? '').toLowerCase()))) return 'indecisive';
  return new Set(tests
    .filter((run) => FAILING_CONCLUSIONS.has((run.conclusion ?? '').toLowerCase()))
    .map((run) => run.name!));
}

/**
 * Names of the test checks failing on the newest default-branch commit whose
 * test checks all finished (`owner/repo`). Walks up to `DEFAULT_BRANCH_COMMIT_WINDOW`
 * commits back, skipping `'no-tests'` and `'indecisive'` commits for free, but
 * giving up after `DEFAULT_BRANCH_LOOKBACK` commits whose test checks are
 * genuinely still running. An empty set when the window's commits carry no
 * test checks at all (nothing there to inherit) and the window reached the
 * branch's actual history (fewer than `DEFAULT_BRANCH_COMMIT_WINDOW` commits
 * came back). null when the verdict is unknown: too many recent commits are
 * still running, every commit seen had an indecisive conclusion, a full
 * window of commits carried no test checks (there may be more history behind
 * it), or the forge could not be read.
 */
export async function readDefaultBranchFailingTestChecks(repo: string): Promise<ReadonlySet<string> | null> {
  try {
    const shas = await ghJson<string[]>([
      'api', `repos/${repo}/commits?per_page=${DEFAULT_BRANCH_COMMIT_WINDOW}`, '--jq', '[.[].sha]',
    ]);
    let sawTestChecks = false;
    let pendingCommits = 0;
    let examined = 0;
    for (const sha of shas) {
      if (pendingCommits >= DEFAULT_BRANCH_LOOKBACK) break;
      examined += 1;
      const [runs, statuses] = await Promise.all([
        ghJson<CheckRun[]>([
          'api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
          '--jq', '[.check_runs[] | {name, status, conclusion}]',
        ]),
        ghJsonPages<CommitStatus>([
          'api', '--paginate', `repos/${repo}/commits/${sha}/status?per_page=100`,
          '--jq', '[.statuses[] | {name: .context, state, targetUrl: .target_url}]',
        ]),
      ]);
      const verdict = defaultBranchCommitTestVerdict([...runs, ...statuses.map(commitStatusAsCheckRun)]);
      if (verdict === 'no-tests') continue;
      sawTestChecks = true;
      if (verdict === 'indecisive') continue;
      if (verdict === 'pending') {
        pendingCommits += 1;
        continue;
      }
      return verdict;
    }
    if (!sawTestChecks) {
      if (shas.length < DEFAULT_BRANCH_COMMIT_WINDOW) return new Set();
      console.log(
        `[ci-failure-feedback] No test checks in a full page of ${shas.length} commits of ${repo}'s default branch; its test verdict is unknown`,
      );
      return null;
    }
    console.log(
      `[ci-failure-feedback] No finished test run in the last ${examined} commits of ${repo}'s default branch; its test verdict is unknown`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not read the default branch's checks for ${repo}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
