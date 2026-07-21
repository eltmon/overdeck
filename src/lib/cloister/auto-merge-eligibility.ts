import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getPullRequestState as getPullRequestStateEffect, isGitHubAppConfigured, type GitHubPullRequestState } from '../github-app.js';
import { parseArtifactRef } from '../forge.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execFileAsync = promisify(execFile);

export const BLOCKER_LABELS = ['needs-design', 'needs-discussion', 'do-not-merge'] as const;

export type AutoMergeEligibility = { eligible: true } | { eligible: false; reason: string };
type PullRequestLookup = (owner: string, repo: string, number: number) => Promise<GitHubPullRequestState>;

interface GitLabMrState {
  state: string;
  draft: boolean;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
}

type GitLabMrLookup = (projectPath: string, iid: number) => Promise<GitLabMrState>;

interface GhPullRequestView {
  state?: string | null;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  isDraft?: boolean | null;
  headRefOid?: string | null;
  baseRefName?: string | null;
  url?: string | null;
  statusCheckRollup?: GhStatusRollupItem[] | null;
}

interface GhStatusRollupItem {
  __typename?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

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
  if (!isGitHubAppConfigured()) {
    return getPullRequestStateViaGh(owner, repo, number);
  }
  return Effect.runPromise(getPullRequestStateEffect(owner, repo, number));
}

function normalizeGhValue(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

function getGhStatusRollupState(statusCheckRollup: GhStatusRollupItem[] | null | undefined): { pending: boolean; failed: boolean } {
  let pending = false;
  let failed = false;

  for (const check of statusCheckRollup ?? []) {
    const status = normalizeGhValue(check.status);
    const conclusion = normalizeGhValue(check.conclusion);
    const state = normalizeGhValue(check.state);

    if (status && status !== 'COMPLETED') {
      pending = true;
    }
    if (status === 'COMPLETED' && conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) {
      failed = true;
    }

    if (state === 'PENDING') {
      pending = true;
    }
    if (state === 'FAILURE' || state === 'ERROR') {
      failed = true;
    }
  }

  return { pending, failed };
}

export async function getPullRequestStateViaGh(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubPullRequestState> {
  const { stdout } = await execFileAsync('gh', [
    'pr',
    'view',
    String(number),
    '--repo',
    `${owner}/${repo}`,
    '--json',
    'state,mergeable,mergeStateStatus,isDraft,headRefOid,baseRefName,url,statusCheckRollup',
  ], { encoding: 'utf-8' });

  const pr = JSON.parse(stdout) as GhPullRequestView;
  const state = normalizeGhValue(pr.state);
  const mergeable = normalizeGhValue(pr.mergeable);
  const checkState = getGhStatusRollupState(pr.statusCheckRollup);

  return {
    owner,
    repo,
    number,
    url: pr.url ?? undefined,
    state: state === 'OPEN' ? 'OPEN' : 'CLOSED',
    merged: state === 'MERGED',
    mergeable: mergeable === 'MERGEABLE' ? true : mergeable === 'CONFLICTING' ? false : null,
    mergeableState: pr.mergeStateStatus?.toLowerCase() ?? null,
    draft: pr.isDraft === true,
    headSha: pr.headRefOid ?? '',
    baseBranch: pr.baseRefName ?? 'main',
    checksPending: checkState.pending,
    checksFailed: checkState.failed,
  };
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
    if (state.state === 'merged') return { eligible: false, reason: 'MR is already merged' };
    if (state.state === 'closed') return { eligible: false, reason: 'MR is closed' };
    return { eligible: false, reason: `MR is not opened (state=${state.state})` };
  }
  if (state.draft) {
    return { eligible: false, reason: 'MR is a draft' };
  }
  if (state.has_conflicts === true) {
    return { eligible: false, reason: 'MR has conflicts' };
  }
  if (state.detailed_merge_status === 'mergeable') {
    return { eligible: true };
  }
  if (state.detailed_merge_status) {
    return { eligible: false, reason: `MR is not mergeable (detailed_merge_status=${state.detailed_merge_status})` };
  }
  if (state.merge_status === 'can_be_merged') {
    return { eligible: true };
  }
  return { eligible: false, reason: `MR is not mergeable (merge_status=${state.merge_status ?? 'unknown'})` };
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
    return { eligible: false, reason: 'review status is not readyForMerge' };
  }

  // PAN-1691: an issue explicitly held for UAT (autoMerge === false) is never
  // auto-merge eligible. undefined (follow project default) and true are
  // unaffected — this can only make auto-merge more conservative.
  if (reviewStatus.autoMerge === false) {
    return { eligible: false, reason: 'held for UAT (auto-merge toggled off)' };
  }

  const prUrl = reviewStatus.prUrl;
  const artifactRef = parseArtifactRef(prUrl);
  if (!artifactRef || !prUrl) {
    return { eligible: false, reason: 'review status PR URL is missing or invalid' };
  }

  if (artifactRef.forge === 'gitlab') {
    const projectPath = parseGitLabProjectPath(prUrl);
    if (!projectPath) {
      return { eligible: false, reason: 'review status PR URL is missing or invalid' };
    }

    let mrState: GitLabMrState;
    try {
      mrState = await (deps.getGitLabMrState ?? defaultGetGitLabMrState)(projectPath, artifactRef.number);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { eligible: false, reason: `GitLab MR state lookup failed: ${message}` };
    }

    const eligibility = evaluateGitLabMrState(mrState);
    if (!eligibility.eligible) {
      return eligibility;
    }
  } else {
    const prRef = parsePullRequestUrl(reviewStatus.prUrl);
    if (!prRef) {
      return { eligible: false, reason: 'review status PR URL is missing or invalid' };
    }

    let prState: GitHubPullRequestState;
    try {
      prState = await (deps.getPullRequestState ?? defaultGetPullRequestState)(prRef.owner, prRef.repo, prRef.number);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { eligible: false, reason: `GitHub PR state lookup failed: ${message}` };
    }

    // Reviewer P1: tighten to positive "green and mergeable" instead of "not known
    // failed". The previous predicate accepted pending checks, draft PRs,
    // closed-unmerged PRs, and mergeable=false — at best noisy GitHub rejections,
    // at worst merging before CI finishes.
    if (prState.merged) {
      return { eligible: false, reason: 'PR is already merged' };
    }
    if (prState.state === 'CLOSED') {
      return { eligible: false, reason: 'PR is closed' };
    }
    if (prState.draft) {
      return { eligible: false, reason: 'PR is a draft' };
    }
    if (prState.checksFailed) {
      return { eligible: false, reason: `CI checks failing on PR HEAD ${prState.headSha}` };
    }
    if (prState.checksPending) {
      return { eligible: false, reason: `CI checks still pending on PR HEAD ${prState.headSha}` };
    }
    if (prState.mergeable === false) {
      return { eligible: false, reason: `PR is not mergeable${prState.mergeableState ? ` (state=${prState.mergeableState})` : ''}` };
    }
  }

  const labels = await (deps.getIssueLabels ?? getIssueLabels)(issueId);
  const blockerLabel = BLOCKER_LABELS.find((label) => labels.includes(label));
  if (blockerLabel) {
    return { eligible: false, reason: `issue carries blocker label: ${blockerLabel}` };
  }

  return { eligible: true };
}
