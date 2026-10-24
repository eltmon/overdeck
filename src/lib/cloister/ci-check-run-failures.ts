/**
 * PAN-4534: the failing checks on a PR head, read from the head's check runs.
 *
 * The CI failure relay fires on the failing shard's `check_run` event, while
 * the workflow run is usually still `in_progress` (other jobs are running), so
 * a "completed failed workflow runs" lookup finds nothing and the agent got
 * feedback that named no failing test. Check runs conclude per job, so the
 * failing shard is visible at once. For each failing GitHub Actions job the
 * job log is fetched (retried with bounded backoff while GitHub has not
 * published it yet) and the Vitest failure section is extracted from it.
 * See docs/PIPELINE-GATES.md, "CI failure feedback".
 */
import { execFile } from 'node:child_process';

/** One failing check run on the head. */
export interface CheckRunFailure {
  name: string;
  /** The Actions job id (a GitHub Actions check run's id is its job id). */
  jobId?: number;
  /** Where a human reads the check: its details page. */
  url?: string;
  excerpt: string;
}

interface GhCheckRun {
  id: number;
  name: string;
  conclusion: string | null;
  details_url?: string | null;
  html_url?: string | null;
  app?: { slug?: string } | null;
}

/**
 * Check-run conclusions that are a failure of the job itself. `cancelled`,
 * `stale`, `action_required` and `startup_failure` say the job did not run to
 * a verdict (a superseded run is cancelled), so they are not reported.
 */
export const FAILED_CHECK_RUN_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out']);

/** `gh api --jq` projection: one check run per line, without its `output`. */
const CHECK_RUN_FIELDS = '.check_runs[] | {id, name, conclusion, details_url, html_url, app: {slug: .app.slug}}';

/**
 * The names of the failing check runs on `ref` (every page), or none when they
 * cannot be read. The relay compares job names with these to mark a failure
 * inherited from main.
 */
export async function listFailingCheckRunNames(owner: string, repo: string, ref: string): Promise<string[]> {
  try {
    const stdout = await gh(['api', '--paginate', `repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`, '--jq', '.check_runs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name']);
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Waits between one job's log reads: about two minutes per job (PAN-4534). */
export const JOB_LOG_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 45_000] as const;

const EXCERPT_MAX_CHARS = 2_000;

function gh(args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf-8', timeout: 30_000, maxBuffer }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout as string);
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drop an aggregate gate job (the `test` job that only echoes
 * `test-shard: failure`) when a job it aggregates failed too. A failing check
 * `X` goes only with evidence: another failing check is `X-…`, `X (…)` or
 * `X / …`, and X's own log reports that check's job as `<job>: failure`. A
 * same-prefix check that failed on its own, or one with no log, is kept.
 */
export function withoutAggregateChecks<T extends { name: string; log?: string }>(failures: T[]): T[] {
  const reportsFailure = (log: string | undefined, child: string) => {
    const job = child.replace(/ \(.*\)$/, '').split(' / ')[0]!;
    return log !== undefined && new RegExp(`(^|\\s)${job.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*failure`, 'm').test(log);
  };
  return failures.filter((failure) => !failures.some((other) => other !== failure
    && [`${failure.name}-`, `${failure.name} (`, `${failure.name} / `].some((prefix) => other.name.startsWith(prefix))
    && reportsFailure(failure.log, other.name)));
}

/**
 * The part of a job log that names the failure: from the first Vitest `FAIL`
 * line, through the `❯ file:line` frames, to the `Test Files … failed`
 * summary, at most ~2000 characters. A log with no Vitest failure gives its
 * tail, where a failing step's error is.
 */
export function extractTestFailureExcerpt(log: string, maxChars = EXCERPT_MAX_CHARS): string {
  // Actions prefixes every line with an ISO timestamp.
  const lines = log.split(/\r?\n/).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, ''));
  const first = lines.findIndex((line) => /(^|\s)FAIL\s/.test(line));
  if (first < 0) return lines.join('\n').trim().slice(-maxChars).trim();
  const summary = lines.findIndex((line, index) => index > first && /Test Files\s.*\bfailed\b/.test(line));
  const section = lines.slice(first, summary >= 0 ? summary + 1 : undefined).join('\n').trim();
  if (section.length <= maxChars) return section;
  const summaryLine = summary >= 0 ? lines[summary]!.trim() : '';
  const head = section.slice(0, maxChars - summaryLine.length - 6).trimEnd();
  return summaryLine ? `${head}\n…\n${summaryLine}` : head;
}

/** A job's log, retried while GitHub has not published it; '' when it never appears. */
async function readJobLog(owner: string, repo: string, jobId: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const log = await gh(['api', `repos/${owner}/${repo}/actions/jobs/${jobId}/logs`], 16 * 1024 * 1024);
      if (log.trim()) return log;
    } catch { /* 404 until the job's log is published */ }
    const delay = JOB_LOG_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return '';
    await sleep(delay);
  }
}

/**
 * The failing check runs on `headSha`, aggregates dropped, each Actions job
 * with its log excerpt. Null when the check runs cannot be read, so the
 * caller can fall back to its workflow-run lookup.
 */
export async function collectCheckRunFailures(owner: string, repo: string, headSha: string): Promise<CheckRunFailure[] | null> {
  let checkRuns: GhCheckRun[];
  try {
    // Every page: a commit can carry more than 100 check runs.
    // Only the fields used here: a check run's `output` text can run to 64 KB.
    const stdout = await gh(['api', '--paginate', `repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`, '--jq', CHECK_RUN_FIELDS]);
    checkRuns = stdout.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as GhCheckRun);
  } catch (err) {
    console.warn(`[ci-failure-feedback] Could not read check runs for ${headSha.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const failing: Array<CheckRunFailure & { log?: string }> = [];
  for (const run of checkRuns.filter((candidate) => FAILED_CHECK_RUN_CONCLUSIONS.has(candidate.conclusion ?? ''))) {
    const isActionsJob = run.app?.slug === 'github-actions';
    const log = isActionsJob ? await readJobLog(owner, repo, run.id) : '';
    failing.push({
      name: run.name,
      ...(isActionsJob ? { jobId: run.id } : {}),
      ...(run.details_url || run.html_url ? { url: (run.details_url || run.html_url)! } : {}),
      excerpt: log ? extractTestFailureExcerpt(log) : '',
      ...(log ? { log } : {}),
    });
  }
  return withoutAggregateChecks(failing).map(({ log: _log, ...failure }) => failure);
}
