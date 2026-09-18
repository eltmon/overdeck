/**
 * The cloister's single read door for forge pull/merge-request facts (PAN-3917).
 *
 * Overdeck stores no status it can derive. Everything the pipeline used to read
 * off a per-issue record or a `review_status` row — is it in review, were
 * changes requested, is it approved, are the checks green, can it merge, did it
 * merge — is answered here from the forge itself:
 *
 *   - GitHub: `gh pr view` through `fetchIssuePullRequest`, which already
 *     discovers the PR from `feature/<id>` / `strike/<id>` and returns
 *     `reviewDecision`, `mergeable`, `statusCheckRollup`, and `mergedAt`.
 *   - GitLab: `glab mr list` for discovery plus `glab mr view -F json` for the
 *     detailed merge status and approval count.
 *
 * Every function takes an optional dep bag so tests inject fixtures instead of
 * running a forge CLI. Nothing here writes anything anywhere.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { listOpenGitLabMergeRequests, type GitLabMergeRequestRow } from '../gitlab-merge-requests.js';
import { fetchIssuePullRequest, type IssuePullRequestData } from '../overdeck/pull-requests.js';
import { resolveProjectReposForIssueSync, type ResolvedProjectRepo } from '../project-repos.js';

const execFileAsync = promisify(execFile);

/** Aggregate verdict over the head commit's checks. */
export type ChecksVerdict = 'green' | 'pending' | 'red' | 'none';

/** GitHub's `reviewDecision`, normalized. GitLab maps approvals onto it. */
export type PrReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface PrFacts {
  issueId: string;
  forge: 'github' | 'gitlab' | null;
  /** Web URL of the PR/MR, when one exists. */
  url: string | null;
  number: number | null;
  /** True when a PR/MR exists at all (open, closed, or merged). */
  exists: boolean;
  open: boolean;
  merged: boolean;
  closed: boolean;
  draft: boolean;
  headSha: string | null;
  headBranch: string | null;
  reviewDecision: PrReviewDecision;
  approved: boolean;
  changesRequested: boolean;
  /** null when the forge has not computed mergeability yet. */
  mergeable: boolean | null;
  mergeableState: string | null;
  checks: ChecksVerdict;
  /** Set when the forge lookup itself failed; every flag is then conservative. */
  error?: string;
}

export interface PrFactsDeps {
  fetchGitHubPr?: typeof fetchIssuePullRequest;
  resolveRepos?: typeof resolveProjectReposForIssueSync;
  listGitLabMrs?: typeof listOpenGitLabMergeRequests;
  viewGitLabMr?: (projectPath: string, iid: number) => Promise<GitLabMrView>;
}

export interface GitLabMrView {
  iid?: number;
  state?: string;
  draft?: boolean;
  web_url?: string;
  sha?: string;
  source_branch?: string;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  approvals_before_merge?: number | null;
  approved?: boolean;
  head_pipeline?: { status?: string } | null;
  pipeline?: { status?: string } | null;
}

export function emptyPrFacts(issueId: string, error?: string): PrFacts {
  return {
    issueId: issueId.toUpperCase(),
    forge: null,
    url: null,
    number: null,
    exists: false,
    open: false,
    merged: false,
    closed: false,
    draft: false,
    headSha: null,
    headBranch: null,
    reviewDecision: null,
    approved: false,
    changesRequested: false,
    mergeable: null,
    mergeableState: null,
    checks: 'none',
    ...(error ? { error } : {}),
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

/** Aggregate GitHub's `statusCheckRollup` into one verdict. */
export function summarizeStatusCheckRollup(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): ChecksVerdict {
  const items = rollup ?? [];
  if (items.length === 0) return 'none';
  let pending = false;
  let failed = false;
  for (const check of items) {
    const status = normalize(check.status);
    const conclusion = normalize(check.conclusion);
    const state = normalize(check.state);
    if (status && status !== 'COMPLETED') pending = true;
    if (status === 'COMPLETED' && conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) failed = true;
    if (state === 'PENDING' || state === 'EXPECTED') pending = true;
    if (state === 'FAILURE' || state === 'ERROR') failed = true;
  }
  if (failed) return 'red';
  if (pending) return 'pending';
  return 'green';
}

function gitHubFacts(issueId: string, pr: IssuePullRequestData): PrFacts {
  const state = normalize(pr.state);
  const merged = state === 'MERGED' || Boolean(pr.mergedAt);
  const mergeable = normalize(pr.mergeable);
  const decision = normalize(pr.reviewDecision);
  return {
    issueId: issueId.toUpperCase(),
    forge: 'github',
    url: pr.url ?? null,
    number: pr.number ?? null,
    exists: true,
    open: state === 'OPEN' && !merged,
    merged,
    closed: state === 'CLOSED' && !merged,
    draft: pr.isDraft === true,
    headSha: pr.headRefOid ?? null,
    headBranch: pr.headRefName ?? null,
    reviewDecision: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED'
      ? decision
      : null,
    approved: decision === 'APPROVED',
    changesRequested: decision === 'CHANGES_REQUESTED',
    mergeable: mergeable === 'MERGEABLE' ? true : mergeable === 'CONFLICTING' ? false : null,
    mergeableState: pr.mergeable ? pr.mergeable.toLowerCase() : null,
    checks: summarizeStatusCheckRollup(pr.statusCheckRollup),
  };
}

async function defaultViewGitLabMr(projectPath: string, iid: number): Promise<GitLabMrView> {
  const { stdout } = await execFileAsync(
    'glab',
    ['mr', 'view', String(iid), '-R', projectPath, '-F', 'json'],
    { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as GitLabMrView;
}

/** Derive `projectPath` (group/subgroup/repo) from a GitLab MR web URL. */
export function parseGitLabProjectPath(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/);
  return match ? match[1] : null;
}

function gitLabChecks(view: GitLabMrView): ChecksVerdict {
  const status = (view.head_pipeline?.status ?? view.pipeline?.status ?? '').toLowerCase();
  if (!status) return 'none';
  if (status === 'success' || status === 'manual') return 'green';
  if (status === 'failed' || status === 'canceled') return 'red';
  return 'pending';
}

function gitLabFacts(issueId: string, row: GitLabMergeRequestRow, view: GitLabMrView | null): PrFacts {
  const state = (view?.state ?? row.state ?? '').toLowerCase();
  const merged = state === 'merged';
  const detailed = view?.detailed_merge_status;
  const mergeable = view?.has_conflicts === true
    ? false
    : detailed
      ? detailed === 'mergeable' || detailed === 'not_approved'
      : view?.merge_status === 'can_be_merged'
        ? true
        : null;
  // GitLab has no "request changes" primitive; approval is the only verdict the
  // forge models. `not_approved` means the MR is otherwise mergeable but has no
  // approval yet, which is `REVIEW_REQUIRED`, not "changes requested".
  const approved = view?.approved === true || (detailed != null && detailed === 'mergeable');
  return {
    issueId: issueId.toUpperCase(),
    forge: 'gitlab',
    url: view?.web_url ?? row.web_url ?? null,
    number: view?.iid ?? row.iid ?? null,
    exists: true,
    open: state === 'opened',
    merged,
    closed: state === 'closed',
    draft: view?.draft === true || row.draft === true,
    headSha: view?.sha ?? row.sha ?? null,
    headBranch: view?.source_branch ?? row.source_branch ?? null,
    reviewDecision: approved ? 'APPROVED' : 'REVIEW_REQUIRED',
    approved,
    changesRequested: false,
    mergeable,
    mergeableState: detailed ?? view?.merge_status ?? null,
    checks: view ? gitLabChecks(view) : 'none',
  };
}

function primaryGitLabRepo(repos: readonly ResolvedProjectRepo[]): ResolvedProjectRepo | null {
  return repos.find((repo) => repo.forge === 'gitlab' && repo.required)
    ?? repos.find((repo) => repo.forge === 'gitlab')
    ?? null;
}

/**
 * Read the forge's own account of an issue's pull/merge request.
 *
 * Never throws: a failed lookup comes back as `exists: false` with `error` set,
 * so a caller that gates on `approved`/`mergeable` holds rather than acting on a
 * lookup failure.
 */
export async function getPrFacts(issueId: string, deps: PrFactsDeps = {}): Promise<PrFacts> {
  const fetchGitHubPr = deps.fetchGitHubPr ?? fetchIssuePullRequest;
  try {
    const gh = await fetchGitHubPr(issueId);
    if (gh.pr) return gitHubFacts(issueId, gh.pr);
    if (gh.error) return emptyPrFacts(issueId, gh.error);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitHub PR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const resolveRepos = deps.resolveRepos ?? resolveProjectReposForIssueSync;
  let repo: ResolvedProjectRepo | null = null;
  try {
    repo = primaryGitLabRepo(resolveRepos(issueId) ?? []);
  } catch {
    repo = null;
  }
  if (!repo) return emptyPrFacts(issueId);

  const listGitLabMrs = deps.listGitLabMrs ?? listOpenGitLabMergeRequests;
  const viewGitLabMr = deps.viewGitLabMr ?? defaultViewGitLabMr;
  try {
    const rows = await listGitLabMrs(repo.repoPath);
    const branch = repo.sourceBranch;
    const row = rows.find((candidate) => candidate.source_branch === branch);
    if (!row?.iid) return emptyPrFacts(issueId);
    const projectPath = parseGitLabProjectPath(row.web_url);
    const view = projectPath ? await viewGitLabMr(projectPath, row.iid).catch(() => null) : null;
    return gitLabFacts(issueId, row, view);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitLab MR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface MergeReadiness {
  ready: boolean;
  /** Present when `ready` is false: the single reason that blocks the merge. */
  reason?: string;
}

/**
 * FR-9's ready set: approved + checks green + forge `mergeable`. One reason is
 * returned, in the order an operator would want to see it.
 */
export function evaluateMergeReadiness(facts: PrFacts): MergeReadiness {
  if (facts.error) return { ready: false, reason: facts.error };
  if (!facts.exists) return { ready: false, reason: 'no pull request for this issue' };
  if (facts.merged) return { ready: false, reason: 'PR is already merged' };
  if (facts.closed) return { ready: false, reason: 'PR is closed' };
  if (facts.draft) return { ready: false, reason: 'PR is a draft' };
  if (facts.changesRequested) return { ready: false, reason: 'latest review requested changes' };
  if (!facts.approved) return { ready: false, reason: 'PR is not approved' };
  if (facts.checks === 'red') return { ready: false, reason: `CI checks failing on PR HEAD ${facts.headSha ?? 'unknown'}` };
  if (facts.checks === 'pending') return { ready: false, reason: `CI checks still pending on PR HEAD ${facts.headSha ?? 'unknown'}` };
  if (facts.mergeable === false) {
    return { ready: false, reason: `PR is not mergeable${facts.mergeableState ? ` (state=${facts.mergeableState})` : ''}` };
  }
  return { ready: true };
}

/** True when the issue is in review: an open PR that is neither approved nor rejected. */
export function isAwaitingReview(facts: PrFacts): boolean {
  return facts.open && !facts.approved && !facts.changesRequested;
}
