import { join } from 'node:path';

import { Effect } from 'effect';

import {
  registerDurableReviewDispatcher,
  registerDurableReviewPipelineHandler,
  type DurableReviewDispatcher,
  type DurableReviewPipelineInput,
} from '../../../lib/cloister/durable-review-pipeline.js';
import { pushLocalReviewBranches } from '../../../lib/cloister/review-branch-push.js';
import { requestReviewPipeline } from '../../../lib/cloister/request-review-pipeline.js';
import { runVerificationForIssue } from '../../../lib/cloister/verification-runner.js';
import type {
  VerificationRunnerOutcome,
  WorkspaceInfo,
} from '../../../lib/cloister/verification-types.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';

export interface DurableReviewWorkspace {
  issueId: string;
  workspacePath: string;
  workspaceInfo: WorkspaceInfo;
  branchName: string;
}

export interface DashboardDurableReviewDependencies {
  resolveWorkspace: (issueId: string) => DurableReviewWorkspace | null;
  pushBranch: (workspace: DurableReviewWorkspace) => Promise<void>;
  verify?: (
    issueId: string,
    workspacePath: string,
    workspaceInfo: WorkspaceInfo,
  ) => Promise<VerificationRunnerOutcome>;
}

interface DashboardWorkspaceInfo extends WorkspaceInfo {
  exists: boolean;
  remotePath?: string;
  localPath?: string;
}

export interface DurableReviewRegistrationDependencies {
  getWorkspaceInfo: (issueId: string) => DashboardWorkspaceInfo;
  pushRemote: (vmName: string, workspacePath: string, branchName: string) => Promise<void>;
  dispatchReview: DurableReviewDispatcher;
}

export async function startDashboardDurableReviewPipeline(
  input: DurableReviewPipelineInput,
  dependencies: DashboardDurableReviewDependencies,
): Promise<boolean> {
  const { issueId, prUrl, setReviewPending, dispatchReview } = input;
  const resolved = dependencies.resolveWorkspace(issueId);
  if (!resolved) return false;
  const { workspacePath, workspaceInfo, branchName } = resolved;

  return requestReviewPipeline.start(issueId, {
    verify: () => dependencies.verify
      ? dependencies.verify(issueId, workspacePath, workspaceInfo)
      : Effect.runPromise(runVerificationForIssue(
        issueId,
        workspacePath,
        workspaceInfo,
        'durable-review',
      )),
    onVerificationFailed: (outcome) => {
      setReviewPending({
        reviewStatus: 'pending',
        reviewNotes: `Verification failed at ${outcome.failedCheck} — fix and resubmit`,
      });
    },
    onVerificationError: (outcome) => {
      setReviewPending({
        reviewStatus: 'pending',
        reviewNotes: `Verification infrastructure error: ${outcome.message}`,
      });
    },
    onVerificationDeferred: (outcome) => {
      setReviewPending({ reviewStatus: 'pending', reviewNotes: outcome.reason });
      console.log(`[review-status] durable review verification deferred for ${issueId}: ${outcome.reason}`);
    },
    pushBranch: () => dependencies.pushBranch(resolved),
    dispatchReview: async () => {
      const result = await dispatchReview({
        issueId,
        workspace: workspacePath,
        branch: branchName,
        ...(prUrl ? { prUrl } : {}),
      });
      if (!result.success) {
        setReviewPending({
          reviewStatus: 'pending',
          reviewNotes: result.error || result.message || 'Failed to dispatch review',
        });
        return;
      }
      const message = result.message?.startsWith('Review already in progress')
        ? 'already in progress — no-op'
        : 'auto-dispatched from durable journal intent';
      console.log(`[review-status] review dispatch for ${issueId}: ${message} (host-side)`);
    },
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      setReviewPending({
        reviewStatus: 'pending',
        reviewNotes: `Review pipeline error: ${detail}`,
      });
      console.warn(`[review-status] host-side durable review pipeline for ${issueId} failed (non-fatal): ${detail}`);
    },
  });
}

export async function pushDashboardReviewBranch(
  workspace: DurableReviewWorkspace,
  dependencies: Pick<DurableReviewRegistrationDependencies, 'pushRemote'>,
): Promise<void> {
  if (workspace.workspaceInfo.isRemote && workspace.workspaceInfo.vmName) {
    await dependencies.pushRemote(
      workspace.workspaceInfo.vmName,
      workspace.workspacePath,
      workspace.branchName,
    );
    return;
  }
  await pushLocalReviewBranches(workspace.issueId, workspace.workspacePath);
}

export function registerDashboardDurableReviewPipeline(
  dependencies: DurableReviewRegistrationDependencies,
): void {
  registerDurableReviewDispatcher(dependencies.dispatchReview);
  registerDurableReviewPipelineHandler((input) => startDashboardDurableReviewPipeline(input, {
    resolveWorkspace: (issueId) => {
      const workspaceInfo = dependencies.getWorkspaceInfo(issueId);
      if (!workspaceInfo.exists) return null;
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) return null;
      const workspacePath = workspaceInfo.isRemote
        ? workspaceInfo.remotePath
        : workspaceInfo.localPath || join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      if (!workspacePath) return null;
      return { issueId, workspacePath, workspaceInfo, branchName: `feature/${issueId.toLowerCase()}` };
    },
    pushBranch: (workspace) => pushDashboardReviewBranch(workspace, dependencies),
  }));
}
