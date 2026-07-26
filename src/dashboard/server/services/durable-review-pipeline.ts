import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import type { DurableReviewPipelineInput } from '../../../lib/cloister/durable-review-pipeline.js';
import { requestReviewPipeline } from '../../../lib/cloister/request-review-pipeline.js';
import { runVerificationForIssue } from '../../../lib/cloister/verification-runner.js';
import { resolveWorkspaceRepoRootsSync } from '../../../lib/project-repos.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';

const execFileAsync = promisify(execFile);

export async function startDashboardDurableReviewPipeline(
  input: DurableReviewPipelineInput,
): Promise<boolean> {
  const { issueId, prUrl, setReviewPending, dispatchReview } = input;
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return false;

  const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  try {
    await access(workspace);
  } catch {
    return false;
  }

  const repoRoots = resolveWorkspaceRepoRootsSync(issueId, workspace);
  const branch = repoRoots[0]?.sourceBranch;
  if (!branch) return false;

  return requestReviewPipeline.start(issueId, {
    verify: () => Effect.runPromise(runVerificationForIssue(
      issueId,
      workspace,
      { isRemote: false },
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
    pushBranch: async () => {
      for (const root of repoRoots) {
        await execFileAsync('git', ['push', 'origin', root.sourceBranch], {
          cwd: root.dir,
          encoding: 'utf-8',
        });
      }
    },
    dispatchReview: async () => {
      const result = await dispatchReview({
        issueId,
        workspace,
        branch,
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
