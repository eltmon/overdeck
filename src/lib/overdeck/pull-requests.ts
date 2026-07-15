import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { githubPrLookupSource, lookupPullRequestNumberForBranch } from '../github-pr-lookup.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import {
  getCachedIssuePrTabResponse,
  getIssuePrTabCacheGeneration,
  setCachedIssuePrTabResponse,
} from '../../dashboard/server/services/pr-tab-cache.js';

const execFileAsync = promisify(execFile);

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

const GH_PR_VIEW_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'baseRefName',
  'headRefName',
  'headRefOid',
  'author',
  'createdAt',
  'updatedAt',
  'reviewDecision',
  'reviewRequests',
  'statusCheckRollup',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'labels',
  'mergeable',
  'mergedAt',
  'mergeCommit',
  'body',
].join(',');

export interface IssuePullRequestData {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid?: string;
  author: { login?: string; name?: string } | null;
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  reviewRequests: Array<{ login?: string; name?: string; __typename?: string }>;
  statusCheckRollup: Array<{
    name?: string;
    state?: string;
    conclusion?: string;
    status?: string;
    detailsUrl?: string;
    workflowName?: string;
    __typename?: string;
  }>;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
  labels: Array<{ name?: string; color?: string }>;
  mergeable: string | null;
  mergedAt?: string;
  mergeCommit?: { oid?: string } | string | null;
  body: string;
}

export async function fetchCommitCheckRuns(
  owner: string,
  repo: string,
  commit: string,
): Promise<{ total: number; failed: string[]; pending: string[] }> {
  const { stdout } = await execFileAsync(
    'gh',
    ['api', `repos/${owner}/${repo}/commits/${encodeURIComponent(commit)}/check-runs?per_page=100`,
      '-H', 'Accept: application/vnd.github+json'],
    { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
  );
  const payload = JSON.parse(stdout) as { check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }> };
  const runs = payload.check_runs ?? [];
  return {
    total: runs.length,
    failed: runs
      .filter(run => run.conclusion != null && !['success', 'skipped', 'neutral'].includes(run.conclusion))
      .map(run => run.name ?? 'unnamed check'),
    pending: runs
      .filter(run => run.status !== 'completed')
      .map(run => run.name ?? 'unnamed check'),
  };
}

export interface IssuePrEndpointResponse {
  issueId: string;
  pr: IssuePullRequestData | null;
  error?: string;
}

export interface IssuePrDiffEndpointResponse {
  issueId: string;
  diff: string | null;
  error?: string;
}

export interface IssuePrDetailsResponse extends IssuePrEndpointResponse {
  diff: string | null;
}

async function resolveIssuePullRequestRef(issueId: string): Promise<
  | { issueId: string; repoArg: string; prNumber: string }
  | { issueId: string; repoArg: null; prNumber: null; error?: string }
> {
  const upper = issueId.toUpperCase();
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return { issueId: upper, repoArg: null, prNumber: null };
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  const repoArg = `${githubCheck.owner}/${githubCheck.repo}`;

  try {
    const prNumber = await lookupPullRequestNumberForBranch(githubCheck.owner, githubCheck.repo, branchName);
    if (prNumber == null) {
      return { issueId: upper, repoArg: null, prNumber: null };
    }
    return { issueId: upper, repoArg, prNumber: String(prNumber) };
  } catch (err: any) {
    return { issueId: upper, repoArg: null, prNumber: null, error: `${githubPrLookupSource()} failed: ${err.message}` };
  }
}

async function fetchIssuePullRequestFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, error: (prRef as { error?: string }).error};
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'view', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--json', GH_PR_VIEW_FIELDS,
      ],
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    return {
      issueId: prRef.issueId,
      pr: JSON.parse(stdout) as IssuePullRequestData,
    };
  } catch (err: any) {
    return { issueId: prRef.issueId, pr: null, error: `gh pr view failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequest(issueId: string): Promise<IssuePrEndpointResponse> {
  const generation = getIssuePrTabCacheGeneration(issueId);
  const cached = getCachedIssuePrTabResponse<IssuePrEndpointResponse>('pr', issueId, generation);
  if (cached) return cached;

  const prRef = await resolveIssuePullRequestRef(issueId);
  const result = await fetchIssuePullRequestFromRef(prRef);
  setCachedIssuePrTabResponse('pr', issueId, generation, result);
  return result;
}

async function fetchIssuePullRequestDiffFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrDiffEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, diff: null, error: (prRef as { error?: string }).error};
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'diff', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--patch',
      ],
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );
    return { issueId: prRef.issueId, diff: stdout };
  } catch (err: any) {
    return { issueId: prRef.issueId, diff: null, error: `gh pr diff failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequestDiff(issueId: string): Promise<IssuePrDiffEndpointResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  return fetchIssuePullRequestDiffFromRef(prRef);
}

export async function fetchIssuePullRequestDetails(issueId: string): Promise<IssuePrDetailsResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, diff: null, error: (prRef as { error?: string }).error};
  }

  const [prResult, diffResult] = await Promise.all([
    fetchIssuePullRequestFromRef(prRef),
    fetchIssuePullRequestDiffFromRef(prRef),
  ]);

  return {
    issueId: prRef.issueId,
    pr: prResult.pr,
    diff: diffResult.diff,
    error: prResult.error ?? diffResult.error,
  };
}

type CheckRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'startup_failure' | null;
type CheckRunStatus = 'queued' | 'in_progress' | 'completed' | 'requested' | 'pending' | 'waiting' | string;

export interface IssueCheckRun {
  id: number;
  name: string;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  htmlUrl?: string | null;
  app?: string | null;
  workflowName?: string | null;
}

export interface IssueCheckRunsSummary {
  total: number;
  passed: number;
  failed: number;
  running: number;
  skipped: number;
  pending: number;
  cancelled: number;
}

export interface IssueCheckRunsResponse {
  issueId: string;
  pr: Pick<IssuePullRequestData, 'number' | 'url' | 'headRefName' | 'headRefOid' | 'mergeable' | 'statusCheckRollup'> | null;
  checkRuns: IssueCheckRun[];
  summary: IssueCheckRunsSummary;
  error?: string;
}

function emptyCheckRunsSummary(): IssueCheckRunsSummary {
  return { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 };
}

function summarizeCheckRuns(checkRuns: IssueCheckRun[]): IssueCheckRunsSummary {
  const summary = emptyCheckRunsSummary();
  summary.total = checkRuns.length;
  for (const run of checkRuns) {
    const status = (run.status || '').toLowerCase();
    const conclusion = (run.conclusion || '').toLowerCase();
    if (status !== 'completed') {
      if (status === 'in_progress') summary.running += 1;
      else summary.pending += 1;
      continue;
    }
    if (conclusion === 'success' || conclusion === 'neutral') summary.passed += 1;
    else if (conclusion === 'skipped') summary.skipped += 1;
    else if (conclusion === 'cancelled') summary.cancelled += 1;
    else if (conclusion) summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}

function normalizeCheckRun(raw: any): IssueCheckRun {
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? raw.workflow_name ?? 'Unnamed check'),
    status: String(raw.status ?? 'pending'),
    conclusion: (raw.conclusion ?? null) as CheckRunConclusion,
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    detailsUrl: raw.details_url ?? null,
    htmlUrl: raw.html_url ?? null,
    app: typeof raw.app?.name === 'string' ? raw.app.name : null,
    workflowName: typeof raw.workflow_name === 'string' ? raw.workflow_name : null,
  };
}

export async function fetchIssueCheckRuns(issueId: string): Promise<IssueCheckRunsResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  if (!prRef.repoArg || !prRef.prNumber) {
    return {
      issueId: prRef.issueId,
      pr: null,
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: (prRef as { error?: string }).error,
    };
  }

  const prResult = await fetchIssuePullRequestFromRef(prRef);
  if (!prResult.pr) {
    return {
      issueId: prRef.issueId,
      pr: null,
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: prResult.error,
    };
  }

  const pr = prResult.pr;
  const [defaultOwner, defaultRepo] = prRef.repoArg.split('/');
  const repoOwner = defaultOwner ?? '';
  const repoName = defaultRepo ?? '';
  const checkRef = pr.headRefOid || pr.headRefName || `feature/${issueId.toLowerCase()}`;

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${repoOwner}/${repoName}/commits/${encodeURIComponent(checkRef)}/check-runs?per_page=100`,
        '-H',
        'Accept: application/vnd.github+json',
      ],
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as { check_runs?: any[] };
    const checkRuns = (payload.check_runs ?? []).map(normalizeCheckRun);
    return {
      issueId: prRef.issueId,
      pr: {
        number: pr.number,
        url: pr.url,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        mergeable: pr.mergeable,
        statusCheckRollup: pr.statusCheckRollup,
      },
      checkRuns,
      summary: summarizeCheckRuns(checkRuns),
    };
  } catch (err: any) {
    return {
      issueId: prRef.issueId,
      pr: {
        number: pr.number,
        url: pr.url,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        mergeable: pr.mergeable,
        statusCheckRollup: pr.statusCheckRollup,
      },
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: `gh api check-runs failed: ${err.message}`,
    };
  }
}
