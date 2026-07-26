import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getAgentStateSync } from '../agents.js';
import { getMergeSetSync } from '../merge-set.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import {
  loadReviewStatuses,
  reviewGatesPassedSync,
  setReviewStatusSync,
  type ReviewStatus,
} from '../review-status.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { observeForgeMergeState } from './merge-completeness.js';

const execFileAsync = promisify(execFile);
export const STUCK_MERGING_MS = 30 * 60 * 1000;

export interface GitHubBranchMergeObservation {
  merged: boolean;
  unverifiableReason?: string;
}

export async function observeGitHubBranchMerge(
  issueId: string,
  branch: string,
  projectPath: string,
): Promise<GitHubBranchMergeObservation> {
  const resolved = resolveGitHubIssueSync(issueId);
  if (!resolved.isGitHub) return { merged: false };
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'list', '--repo', `${resolved.owner}/${resolved.repo}`, '--head', branch, '--state', 'all', '--json', 'number,mergedAt,mergeCommit', '--limit', '5'],
      { cwd: projectPath },
    );
    const prs = JSON.parse(stdout || '[]') as Array<{ mergedAt: string | null; mergeCommit: unknown | null }>;
    return { merged: prs.some((pr) => pr.mergedAt || pr.mergeCommit) };
  } catch (error) {
    return {
      merged: false,
      unverifiableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function latestMergeActivityAt(status: ReviewStatus): number | null {
  const mergeEntry = [...(status.history ?? [])].reverse().find((entry) => entry.type === 'merge');
  const timestamp = Date.parse(mergeEntry?.timestamp ?? status.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readSpecStatus(projectPath: string, issueId: string): Promise<string | undefined> {
  try {
    const { findSpecByIssue } = await import('../pan-dir/specs.js');
    return (await Effect.runPromise(findSpecByIssue(projectPath, issueId)))?.status;
  } catch {
    return undefined;
  }
}

function hasPlanningAgent(issueId: string): boolean {
  const planState = getAgentStateSync(`planning-${issueId.toLowerCase()}`);
  return planState?.status === 'running' || planState?.status === 'starting';
}

export async function reconcileStuckMergingStates(): Promise<string[]> {
  const actions: string[] = [];
  const now = Date.now();

  for (const [issueId, status] of Object.entries(loadReviewStatuses())) {
    if (status.mergeStatus !== 'merging' && status.mergeStatus !== 'verifying') continue;
    const activityAt = latestMergeActivityAt(status);
    if (activityAt === null || now - activityAt < STUCK_MERGING_MS) continue;

    const project = resolveProjectFromIssueSync(issueId);
    if (!project) continue;
    const specStatus = await readSpecStatus(project.projectPath, issueId);
    if (specStatus === 'completed' || specStatus === 'cancelled') continue;

    const branch = `feature/${issueId.toLowerCase()}`;
    const mergeSet = getMergeSetSync(issueId);
    const hasNonGitHubRepos = mergeSet?.repos.some((repo) => repo.forge !== 'github') === true;
    const githubIssue = resolveGitHubIssueSync(issueId);
    let complete = false;
    let positiveMergedEvidence = false;
    let unverifiableReason: string | undefined;

    if (!githubIssue.isGitHub || hasNonGitHubRepos) {
      try {
        const observation = await observeForgeMergeState(issueId);
        complete = observation.complete;
        positiveMergedEvidence = observation.hasPositiveMergedEvidence;
        unverifiableReason = observation.repos.find((repo) => repo.state === 'unverifiable')?.reason;
      } catch (error) {
        unverifiableReason = error instanceof Error ? error.message : String(error);
      }
    } else {
      const observation = await observeGitHubBranchMerge(issueId, branch, project.projectPath);
      complete = observation.merged;
      positiveMergedEvidence = observation.merged;
      unverifiableReason = observation.unverifiableReason;
    }

    if (unverifiableReason) {
      console.warn(`[deacon] ${issueId}: stuck ${status.mergeStatus} state is unverifiable — ${unverifiableReason}`);
      continue;
    }

    if (complete && positiveMergedEvidence) {
      if (hasPlanningAgent(issueId) || specStatus === 'draft' || specStatus === 'proposed') continue;
      setReviewStatusSync(issueId, {
        mergeStatus: 'merged',
        mergeStep: 'post-merge-cleanup',
        readyForMerge: false,
      });
      const msg = `Reconciled stuck ${status.mergeStatus} state for ${issueId} — forge confirms the merge`;
      actions.push(msg);
      const { enqueuePostMergeLifecycle } = await import('./post-merge-lifecycle-worker.js');
      const action = enqueuePostMergeLifecycle(issueId, project.projectPath, branch);
      if (action) actions.push(action);
      continue;
    }

    const readyForMerge = reviewGatesPassedSync({ ...status, mergeStatus: 'pending' });
    setReviewStatusSync(issueId, {
      mergeStatus: 'pending',
      mergeNotes: `Reset stuck ${status.mergeStatus} state after 30 minutes because the forge has no completed merge evidence`,
      readyForMerge,
    });
    actions.push(`Reset stuck ${status.mergeStatus} state for ${issueId} to pending`);
  }

  return actions;
}
