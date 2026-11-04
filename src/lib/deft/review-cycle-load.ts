/**
 * Load the inputs of Deft's review-cycle view model (PAN-4849 WI-21, BD-5).
 *
 * Uses Overdeck's existing, cached PR loaders (pull request, check runs,
 * discussions), one local `git log` of the branch's fix-batch commits with
 * async `execFile`, and the fs-only Deft state reader, then calls the pure
 * `deriveDeftReviewCycle`. A failing loader becomes an `errors` entry and an
 * empty value; this function never throws.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeftIssueState, DeftReviewCycle } from '@overdeck/contracts';
import { fetchIssueDiscussions } from '../overdeck/discussions.js';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { fetchIssueCheckRuns, fetchIssuePullRequest } from '../overdeck/pull-requests.js';
import { directiveBaseRef } from './archive.js';
import { type DeftReviewCycleInput, deriveDeftReviewCycle } from './review-cycle.js';
import { readDeftIssueState } from './state-reader.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const FIX_BATCH_SUBJECT = 'fix: address Greptile review findings';

type FixCommit = DeftReviewCycleInput['fixCommits'][number];

export interface DeftReviewCycleLoadDeps {
  workspacePath: (issueId: string) => string | null;
  pullRequest: (issueId: string) => Promise<{ number: number; headRefOid?: string } | null>;
  checkRuns: (issueId: string) => Promise<DeftReviewCycleInput['checkRuns']>;
  discussions: (issueId: string) => Promise<DeftReviewCycleInput['discussions']>;
  fixCommits: (worktree: string) => Promise<FixCommit[]>;
  readState: (worktree: string, issueId: string) => Promise<DeftIssueState>;
  now: () => number;
}

/** Fix-batch commits on the branch since the base ref, oldest first. */
export async function listFixBatchCommits(worktree: string): Promise<FixCommit[]> {
  const range = `${await directiveBaseRef(worktree)}..HEAD`;
  const { stdout } = await execFileAsync('git', ['log', '--reverse', '--format=%H%x1f%cI%x1f%s', range], {
    cwd: worktree,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout.split('\n').flatMap(line => {
    const [sha, committedAt, subject] = line.split('\x1f');
    return sha && committedAt && subject?.startsWith(FIX_BATCH_SUBJECT) ? [{ sha, subject, committedAt }] : [];
  });
}

export const defaultDeftReviewCycleLoadDeps: DeftReviewCycleLoadDeps = {
  workspacePath: getIssueWorkspacePath,
  pullRequest: async issueId => (await fetchIssuePullRequest(issueId)).pr,
  checkRuns: async issueId =>
    (await fetchIssueCheckRuns(issueId)).checkRuns.map(run => ({ name: run.name, status: run.status, conclusion: run.conclusion ?? null })),
  discussions: async issueId =>
    (await fetchIssueDiscussions(issueId)).items
      .filter(item => item.source.startsWith('github-pr-'))
      .map(item => ({ source: item.source, author: item.author, body: item.body, createdAt: item.createdAt })),
  fixCommits: listFixBatchCommits,
  readState: (worktree, issueId) => readDeftIssueState(worktree, issueId),
  now: Date.now,
};

const EMPTY_STATE: Pick<DeftIssueState, 'policy' | 'reviewerConfigPresent' | 'heartbeats' | 'cleanRecords'> = {
  policy: { raw: {}, requireHumanMerge: 'unknown', reviewers: null, minGreptileConfidence: 4 },
  reviewerConfigPresent: false,
  heartbeats: [],
  cleanRecords: [],
};

export async function loadDeftReviewCycle(
  issueId: string,
  deps: DeftReviewCycleLoadDeps = defaultDeftReviewCycleLoadDeps,
): Promise<DeftReviewCycle> {
  const errors: string[] = [];
  const attempt = async <T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      errors.push(`${label} failed: ${(error as Error).message}`);
      return fallback;
    }
  };
  const worktree = deps.workspacePath(issueId);
  const [pr, checkRuns, discussions, fixCommits, state] = await Promise.all([
    attempt('pull request', () => deps.pullRequest(issueId), null),
    attempt('check runs', () => deps.checkRuns(issueId), []),
    attempt('discussions', () => deps.discussions(issueId), []),
    worktree ? attempt('git log', () => deps.fixCommits(worktree), []) : Promise.resolve([]),
    worktree ? attempt('deft state', () => deps.readState(worktree, issueId), EMPTY_STATE) : Promise.resolve(EMPTY_STATE),
  ]);
  const cycle = deriveDeftReviewCycle(
    { issueId, prNumber: pr?.number ?? null, headSha: pr?.headRefOid ?? null, discussions, checkRuns, fixCommits, state },
    deps.now(),
  );
  return { ...cycle, errors: [...cycle.errors, ...errors] };
}
