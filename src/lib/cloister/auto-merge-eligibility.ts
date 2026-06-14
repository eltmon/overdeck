import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getPullRequestState as getPullRequestStateEffect, type GitHubPullRequestState } from '../github-app.js';
import { parseArtifactRef } from '../forge.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execFileAsync = promisify(execFile);

export const BLOCKER_LABELS = ['needs-design', 'needs-discussion', 'do-not-merge'] as const;

export type AutoMergeIneligibilityCode =
  | 'not_ready'
  | 'held_for_uat'
  | 'missing_pr_url'
  | 'pr_merged'
  | 'pr_closed'
  | 'pr_draft'
  | 'checks_failing'
  | 'checks_pending'
  | 'not_mergeable'
  | 'blocker_label'
  | 'gitlab_mr_lookup_failed'
  | 'gitlab_mr_not_opened';

export type AutoMergeEligibility =
  | { eligible: true }
  | { eligible: false; reason: string; code: AutoMergeIneligibilityCode };

export function classifyAutoMergeIneligibility(
  code: AutoMergeIneligibilityCode,
): 'retryable' | 'terminal' {
  switch (code) {
    case 'checks_pending':
    case 'not_mergeable':
    case 'pr_draft':
    case 'checks_failing':
    case 'not_ready':
    case 'gitlab_mr_lookup_failed':
      return 'retryable';
    case 'pr_merged':
    case 'pr_closed':
    case 'held_for_uat':
    case 'missing_pr_url':
    case 'blocker_label':
    case 'gitlab_mr_not_opened':
      return 'terminal';
  }
}
type PullRequestLookup = (owner: string, repo: string, number: number) => Promise<GitHubPullRequestState>;

interface GitLabMrState {
  state: string;
  draft: boolean;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
}

type GitLabMrLookup = (projectPath: string, iid: number) => Promise<GitLabMrState>;

export interface AutoMergeEligibilityDeps {
  getReviewStatus?: (issueId: string) => ReviewStatus | null;
  getPullRequestState?: PullRequestLookup;
  getGitLabMrState?: GitLabMrLookup;
  getIssueLabels?: (issueId: string) => Promise<string[]>;
}

function parsePullRequestUrl(prUrl: string | undefined): { owner: string; repo: string; number: number } | null {
  const match = prUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number.parseInt(match[3], 10) };
}

async function defaultGetPullRequestState(owner: string, repo: string, number: number): Promise<GitHubPullRequestState> {
  return Effect.runPromise(getPullRequestStateEffect(owner, repo, number));
}

async function defaultGetGitLabMrState(projectPath: string, iid: number): Promise<GitLabMrState> {
  const { stdout } = await execFileAsync('glab', [
    'mr', 'view', String(iid), '-R', projectPath, '-F', 'json',
  ], { encoding: 'utf-8' });
  return JSON.parse(stdout) as GitLabMrState;
}

function parseGitLabProjectPath(prUrl: string | undefined): string | null {
  if (!prUrl) return null;
  const match = prUrl.match(/:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/);
  return match ? match[1] : null;
}

function evaluateGitLabMrState(state: GitLabMrState): AutoMergeEligibility {
  if (state.state !== 'opened') {
    if (state.state === 'merged') return { eligible: false, reason: 'MR is already merged', code: 'pr_merged' };
    if (state.state === 'closed') return { eligible: false, reason: 'MR is closed', code: 'pr_closed' };
    return { eligible: false, reason: `MR is not opened (state=${state.state})`, code: 'gitlab_mr_not_opened' };
  }
  if (state.draft) {
    return { eligible: false, reason: 'MR is a draft', code: 'pr_draft' };
  }
  if (state.has_conflicts === true) {
    return { eligible: false, reason: 'MR has conflicts', code: 'not_mergeable' };
  }
  if (state.detailed_merge_status === 'mergeable') {
    return { eligible: true };
  }
  if (state.detailed_merge_status) {
    return { eligible: false, reason: `MR is not mergeable (detailed_merge_status=${state.detailed_merge_status})`, code: 'not_mergeable' };
  }
  if (state.merge_status === 'can_be_merged') {
    return { eligible: true };
  }
  return { eligible: false, reason: `MR is not mergeable (merge_status=${state.merge_status ?? 'unknown'})`, code: 'not_mergeable' };
}

async function getIssueLabels(issueId: string): Promise<string[]> {
  const resolved = resolveGitHubIssueSync(issueId);
  if (!resolved.isGitHub) return [];

  const { stdout } = await execFileAsync('gh', [
    'issue',
    'view',
    String(resolved.number),
    '--repo',
    `${resolved.owner}/${resolved.repo}`,
    '--json',
    'labels',
    '--jq',
    '.labels[].name',
  ], { encoding: 'utf-8' });

  return stdout.trim().split('\n').filter(Boolean);
}

export async function isAutoMergeEligible(
  issueId: string,
  deps: AutoMergeEligibilityDeps = {},
): Promise<AutoMergeEligibility> {
  const reviewStatus = (deps.getReviewStatus ?? getReviewStatusSync)(issueId);
  if (reviewStatus?.readyForMerge !== true) {
    return { eligible: false, reason: 'review status is not readyForMerge', code: 'not_ready' };
  }

  // PAN-1691: an issue explicitly held for UAT (autoMerge === false) is never
  // auto-merge eligible. undefined (follow project default) and true are
  // unaffected — this can only make auto-merge more conservative.
  if (reviewStatus.autoMerge === false) {
    return { eligible: false, reason: 'held for UAT (auto-merge toggled off)', code: 'held_for_uat' };
  }

  const prUrl = reviewStatus.prUrl;
  const artifactRef = parseArtifactRef(prUrl);
  if (!artifactRef || !prUrl) {
    return { eligible: false, reason: 'review status PR URL is missing or invalid', code: 'missing_pr_url' };
  }

  if (artifactRef.forge === 'gitlab') {
    const projectPath = parseGitLabProjectPath(prUrl);
    if (!projectPath) {
      return { eligible: false, reason: 'review status PR URL is missing or invalid', code: 'missing_pr_url' };
    }

    let mrState: GitLabMrState;
    try {
      mrState = await (deps.getGitLabMrState ?? defaultGetGitLabMrState)(projectPath, artifactRef.number);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { eligible: false, reason: `GitLab MR state lookup failed: ${message}`, code: 'gitlab_mr_lookup_failed' };
    }

    const eligibility = evaluateGitLabMrState(mrState);
    if (!eligibility.eligible) {
      return eligibility;
    }
  } else {
    const prRef = parsePullRequestUrl(reviewStatus.prUrl);
    if (!prRef) {
      return { eligible: false, reason: 'review status PR URL is missing or invalid', code: 'missing_pr_url' };
    }

    const prState = await (deps.getPullRequestState ?? defaultGetPullRequestState)(prRef.owner, prRef.repo, prRef.number);

    // Reviewer P1: tighten to positive "green and mergeable" instead of "not known
    // failed". The previous predicate accepted pending checks, draft PRs,
    // closed-unmerged PRs, and mergeable=false — at best noisy GitHub rejections,
    // at worst merging before CI finishes.
    if (prState.merged) {
      return { eligible: false, reason: 'PR is already merged', code: 'pr_merged' };
    }
    if (prState.state === 'CLOSED') {
      return { eligible: false, reason: 'PR is closed', code: 'pr_closed' };
    }
    if (prState.draft) {
      return { eligible: false, reason: 'PR is a draft', code: 'pr_draft' };
    }
    if (prState.checksFailed) {
      return { eligible: false, reason: `CI checks failing on PR HEAD ${prState.headSha}`, code: 'checks_failing' };
    }
    if (prState.checksPending) {
      return { eligible: false, reason: `CI checks still pending on PR HEAD ${prState.headSha}`, code: 'checks_pending' };
    }
    if (prState.mergeable === false) {
      return { eligible: false, reason: `PR is not mergeable${prState.mergeableState ? ` (state=${prState.mergeableState})` : ''}`, code: 'not_mergeable' };
    }
  }

  const labels = await (deps.getIssueLabels ?? getIssueLabels)(issueId);
  const blockerLabel = BLOCKER_LABELS.find((label) => labels.includes(label));
  if (blockerLabel) {
    return { eligible: false, reason: `issue carries blocker label: ${blockerLabel}`, code: 'blocker_label' };
  }

  return { eligible: true };
}

