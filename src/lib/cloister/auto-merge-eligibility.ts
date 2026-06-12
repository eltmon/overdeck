import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getPullRequestState as getPullRequestStateEffect, type GitHubPullRequestState } from '../github-app.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execFileAsync = promisify(execFile);

export const BLOCKER_LABELS = ['needs-design', 'needs-discussion', 'do-not-merge'] as const;

export type AutoMergeEligibility = { eligible: true } | { eligible: false; reason: string };
type PullRequestLookup = (owner: string, repo: string, number: number) => Promise<GitHubPullRequestState>;

export interface AutoMergeEligibilityDeps {
  getReviewStatus?: (issueId: string) => ReviewStatus | null;
  getPullRequestState?: PullRequestLookup;
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

  const prRef = parsePullRequestUrl(reviewStatus.prUrl);
  if (!prRef) {
    return { eligible: false, reason: 'review status PR URL is missing or invalid' };
  }

  const prState = await (deps.getPullRequestState ?? defaultGetPullRequestState)(prRef.owner, prRef.repo, prRef.number);

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

  const labels = await (deps.getIssueLabels ?? getIssueLabels)(issueId);
  const blockerLabel = BLOCKER_LABELS.find((label) => labels.includes(label));
  if (blockerLabel) {
    return { eligible: false, reason: `issue carries blocker label: ${blockerLabel}` };
  }

  return { eligible: true };
}
