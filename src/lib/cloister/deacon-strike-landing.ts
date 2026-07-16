import { join } from 'node:path';

import { loadReviewStatuses, getReviewStatusSync, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { resolveProjectFromIssueSync } from '../projects.js';
export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}

export interface StrikeMergeResult { success: boolean; mergeStatus?: string; error?: string }
type StrikeMergeTrigger = (issueId: string, request: StrikeMergeRequest) => Promise<StrikeMergeResult>;
let strikeMergeTrigger: StrikeMergeTrigger | null = null;

export function registerStrikeMergeTrigger(trigger: StrikeMergeTrigger): void { strikeMergeTrigger = trigger; }

export interface StrikeLandingDeps {
  loadStatuses: () => Record<string, ReviewStatus>;
  getStatus: (issueId: string) => ReviewStatus | null;
  setStatus: typeof setReviewStatusSync;
  resolveProject: typeof resolveProjectFromIssueSync;
  mergeIssue: StrikeMergeTrigger;
}

function defaultDeps(): StrikeLandingDeps {
  return {
    loadStatuses: loadReviewStatuses,
    getStatus: getReviewStatusSync,
    setStatus: setReviewStatusSync,
    resolveProject: resolveProjectFromIssueSync,
    mergeIssue: async (issueId, request) => strikeMergeTrigger
      ? strikeMergeTrigger(issueId, request)
      : { success: false, error: 'Strike merge trigger is not registered' },
  };
}

export async function patrolStrikeLandings(overrides: Partial<StrikeLandingDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const actions: string[] = [];
  for (const [key, candidate] of Object.entries(deps.loadStatuses())) {
    const issueId = (candidate.issueId || key).toUpperCase();
    const head = candidate.strikeReadyHead;
    if (!head || candidate.strikeLandingState !== 'ready') continue;
    if (candidate.deaconIgnored || candidate.stuck || candidate.mergeStatus === 'merged') continue;

    const current = deps.getStatus(issueId);
    if (current?.strikeReadyHead !== head || current.strikeLandingState !== 'ready') continue;
    const claimed = deps.setStatus(issueId, { strikeLandingState: 'landing' });
    if (claimed.strikeReadyHead !== head || claimed.strikeLandingState !== 'landing') continue;

    const project = deps.resolveProject(issueId);
    if (!project) {
      deps.setStatus(issueId, { strikeLandingState: 'ready', mergeNotes: `Strike landing could not resolve a configured project for ${issueId}` });
      continue;
    }
    const request: StrikeMergeRequest = {
      kind: 'strike', markerHead: head,
      workspacePath: join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`),
      branchName: `strike/${issueId.toLowerCase()}`,
      recoveryTarget: `strike-${issueId.toLowerCase()}`,
    };
    const result = await deps.mergeIssue(issueId, request);
    if (result.mergeStatus === 'merged') {
      deps.setStatus(issueId, { strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined });
      actions.push(`[strike-landing] landed ${issueId} at ${head}`);
    } else if (result.success || result.mergeStatus === 'queued' || result.mergeStatus === 'merging' || result.mergeStatus === 'merged') {
      actions.push(`[strike-landing] ${issueId} at ${head} is ${result.mergeStatus ?? 'in progress'}`);
    } else {
      deps.setStatus(issueId, { mergeNotes: result.error ?? 'Strike landing failed' });
      actions.push(`[strike-landing] ${issueId} at ${head} failed: ${result.error ?? 'unknown error'}`);
    }
  }
  return actions;
}
