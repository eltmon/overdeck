import { join } from 'path';

import { Effect } from 'effect';

import { requestReviewPipeline } from './request-review-pipeline.js';

type SetReviewPending = (update: {
  reviewStatus: 'pending';
  reviewNotes?: string;
}) => void;

export interface DurableReviewPipelineInput {
  issueId: string;
  prUrl?: string;
  setReviewPending: SetReviewPending;
}

/** Re-enters the canonical verification → push → review path for durable intent recovery. */
export async function startDurableReviewPipelineHostSide(
  input: DurableReviewPipelineInput,
): Promise<boolean> {
  const { issueId, prUrl, setReviewPending } = input;
  const { resolveProjectFromIssueSync } = await import('../projects.js');
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return false;

  const { access } = await import('fs/promises');
  const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  try {
    await access(workspace);
  } catch {
    return false;
  }

  const { resolveWorkspaceRepoRootsSync } = await import('../project-repos.js');
  const repoRoots = resolveWorkspaceRepoRootsSync(issueId, workspace);
  const branch = repoRoots[0]?.sourceBranch;
  if (!branch) return false;

  return requestReviewPipeline.start(issueId, {
    verify: async () => {
      const { runVerificationForIssue } = await import('./verification-runner.js');
      return Effect.runPromise(runVerificationForIssue(
        issueId,
        workspace,
        { isRemote: false },
        'durable-review',
      ));
    },
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
    pushBranch: async () => {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      for (const root of repoRoots) {
        await execFileAsync('git', ['push', 'origin', root.sourceBranch], {
          cwd: root.dir,
          encoding: 'utf-8',
        });
      }
    },
    dispatchReview: async () => {
      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      const result = await Effect.runPromise(spawnReviewRoleForIssue({
        issueId,
        workspace,
        branch,
        ...(prUrl ? { prUrl } : {}),
      }));
      if (!result.success) {
        setReviewPending({ reviewStatus: 'pending', reviewNotes: result.message });
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
