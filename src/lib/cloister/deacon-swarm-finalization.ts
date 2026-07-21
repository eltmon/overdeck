import { Effect } from 'effect';
import { setReviewStatusSync, getReviewStatusSync } from '../review-status.js';
import { applyStatusOverrides } from '../xbrief/io.js';
import type { XBriefDocument } from '../xbrief/types.js';

export interface RequestIssueReviewResult {
  success: boolean;
  message: string;
  error?: string;
  gated?: boolean;
}

export async function defaultRequestIssueReview(
  issueId: string,
  workspacePath: string,
): Promise<RequestIssueReviewResult> {
  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    verificationStatus: 'pending',
    verificationCycleCount: 0,
    autoRequeueCount: 0,
    reviewRequestedAt: new Date().toISOString(),
  });

  const { spawnReviewRoleForIssue } = await import('./review-agent.js');
  return Effect.runPromise(spawnReviewRoleForIssue({
    issueId,
    workspace: workspacePath,
    branch: `feature/${issueId.toLowerCase()}`,
  }));
}

export async function finalizeSwarmIssueIfComplete(
  issueId: string,
  workspacePath: string,
  baseDoc: XBriefDocument,
  deps: {
    readStatusOverrides?: (workspacePath: string, issueId: string) => Record<string, string> | undefined;
    getFinalizedAt?: (issueId: string, workspacePath: string) => string | undefined;
    setFinalizedAt?: (issueId: string, workspacePath: string, finalizedAt: string) => void;
    requestIssueReview: (issueId: string, workspacePath: string) => Promise<RequestIssueReviewResult>;
  },
): Promise<string[]> {
  const overrides = deps.readStatusOverrides?.(workspacePath, issueId);
  const doc = overrides && Object.keys(overrides).length > 0
    ? applyStatusOverrides(baseDoc, overrides)
    : baseDoc;

  if (!doc.plan.items.every(item => item.status === 'completed')) return [];
  if (deps.getFinalizedAt?.(issueId, workspacePath)) return [];
  const currentStatus = getReviewStatusSync(issueId);
  if (currentStatus?.mergeStatus === 'merged') return [];
  if (currentStatus?.reviewRequestedAt || currentStatus?.reviewStatus === 'reviewing' || currentStatus?.reviewStatus === 'passed') {
    return [];
  }

  const result = await deps.requestIssueReview(issueId, workspacePath);
  if (result.success) {
    deps.setFinalizedAt?.(issueId, workspacePath, new Date().toISOString());
    return [`[swarm] finalized ${issueId}: issue-level review requested`];
  }
  return [`[swarm] finalization deferred ${issueId}: ${result.error || result.message}`];
}
