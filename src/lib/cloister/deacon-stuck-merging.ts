import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getAgentStateSync } from '../agents.js';
import { getMergeSetSync, type MergeSet } from '../merge-set.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import {
  loadReviewStatuses,
  reviewGatesPassedSync,
  setReviewStatusSync,
  type ReviewStatus,
} from '../review-status.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import {
  observeForgeMergeState,
  type ForgeMergeObservationResult,
} from './merge-completeness.js';

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

export function isStuckMergingState(status: ReviewStatus, now: number): boolean {
  if (status.mergeStatus !== 'merging' && status.mergeStatus !== 'verifying') return false;
  const activityAt = latestMergeActivityAt(status);
  return activityAt !== null && now - activityAt >= STUCK_MERGING_MS;
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

export interface StuckMergingDeps {
  now(): number;
  loadStatuses(): Record<string, ReviewStatus>;
  resolveProject(issueId: string): { projectPath: string } | null;
  getMergeSet(issueId: string): MergeSet | null;
  resolveGitHubIssue(issueId: string): { isGitHub: boolean };
  observeForge(issueId: string): Promise<ForgeMergeObservationResult>;
  observeGitHub(issueId: string, branch: string, projectPath: string): Promise<GitHubBranchMergeObservation>;
  readSpecStatus(projectPath: string, issueId: string): Promise<string | undefined>;
  hasPlanningAgent(issueId: string): boolean;
  reviewGatesPassed(status: ReviewStatus): boolean;
  setReviewStatus: typeof setReviewStatusSync;
  enqueuePostMerge(issueId: string, projectPath: string, branch: string): Promise<string | null | undefined>;
  warn(message: string): void;
}

export async function reconcileStuckMergingStatesWithDeps(deps: StuckMergingDeps): Promise<string[]> {
  const actions: string[] = [];
  const now = deps.now();

  for (const [issueId, status] of Object.entries(deps.loadStatuses())) {
    if (!isStuckMergingState(status, now)) continue;
    const project = deps.resolveProject(issueId);
    if (!project) continue;
    const specStatus = await deps.readSpecStatus(project.projectPath, issueId);
    if (specStatus === 'completed' || specStatus === 'cancelled') continue;

    const branch = `feature/${issueId.toLowerCase()}`;
    const mergeSet = deps.getMergeSet(issueId);
    const hasNonGitHubRepos = mergeSet?.repos.some((repo) => repo.forge !== 'github') === true;
    const githubIssue = deps.resolveGitHubIssue(issueId);
    let complete = false;
    let positiveMergedEvidence = false;
    let unverifiableReason: string | undefined;

    if (!githubIssue.isGitHub || hasNonGitHubRepos) {
      try {
        const observation = await deps.observeForge(issueId);
        complete = observation.complete;
        positiveMergedEvidence = observation.hasPositiveMergedEvidence;
        unverifiableReason = observation.repos.find((repo) => repo.state === 'unverifiable')?.reason;
      } catch (error) {
        unverifiableReason = error instanceof Error ? error.message : String(error);
      }
    } else {
      const observation = await deps.observeGitHub(issueId, branch, project.projectPath);
      complete = observation.merged;
      positiveMergedEvidence = observation.merged;
      unverifiableReason = observation.unverifiableReason;
    }

    if (unverifiableReason) {
      deps.warn(`[deacon] ${issueId}: stuck ${status.mergeStatus} state is unverifiable — ${unverifiableReason}`);
      continue;
    }

    if (complete && positiveMergedEvidence) {
      if (deps.hasPlanningAgent(issueId) || specStatus === 'draft' || specStatus === 'proposed') continue;
      deps.setReviewStatus(issueId, {
        mergeStatus: 'merged', mergeStep: 'post-merge-cleanup', readyForMerge: false,
      });
      actions.push(`Reconciled stuck ${status.mergeStatus} state for ${issueId} — forge confirms the merge`);
      const action = await deps.enqueuePostMerge(issueId, project.projectPath, branch);
      if (action) actions.push(action);
      continue;
    }

    const readyForMerge = deps.reviewGatesPassed({ ...status, mergeStatus: 'pending' });
    deps.setReviewStatus(issueId, {
      mergeStatus: 'pending',
      mergeNotes: `Reset stuck ${status.mergeStatus} state after 30 minutes because the forge has no completed merge evidence`,
      readyForMerge,
    });
    actions.push(`Reset stuck ${status.mergeStatus} state for ${issueId} to pending`);
  }

  return actions;
}

export async function reconcileStuckMergingStates(): Promise<string[]> {
  return reconcileStuckMergingStatesWithDeps({
    now: Date.now,
    loadStatuses: loadReviewStatuses,
    resolveProject: resolveProjectFromIssueSync,
    getMergeSet: getMergeSetSync,
    resolveGitHubIssue: resolveGitHubIssueSync,
    observeForge: observeForgeMergeState,
    observeGitHub: observeGitHubBranchMerge,
    readSpecStatus,
    hasPlanningAgent,
    reviewGatesPassed: reviewGatesPassedSync,
    setReviewStatus: setReviewStatusSync,
    enqueuePostMerge: async (issueId, projectPath, branch) => {
      const { enqueuePostMergeLifecycle } = await import('./post-merge-lifecycle-worker.js');
      return enqueuePostMergeLifecycle(issueId, projectPath, branch);
    },
    warn: (message) => console.warn(message),
  });
}
