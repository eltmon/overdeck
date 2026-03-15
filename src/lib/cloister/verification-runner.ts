/**
 * Verification Runner — orchestrates the full verification gate lifecycle.
 *
 * Runs the verification gate (typecheck → lint → test), updates review status,
 * writes feedback files, and notifies the work agent on failure.
 *
 * Extracted from dashboard/server to be independently testable.
 */

import { getReviewStatus, setReviewStatus } from '../review-status.js';
import { runVerificationGate } from './verification-gate.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { messageAgent } from '../agents.js';

export const VERIFICATION_MAX_CYCLES = 3;

export type VerificationRunnerOutcome =
  | { outcome: 'passed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; failedCheck: string; cycleCount: number; maxCycles: number }
  | { outcome: 'error'; message: string };

export interface WorkspaceInfo {
  isRemote: boolean;
  vmName?: string;
}

/**
 * Run the full verification gate for an issue.
 *
 * Handles circuit breaking, status updates, feedback writing, and agent messaging.
 * Returns a discriminated union so callers need no try/catch.
 */
export async function runVerificationForIssue(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
): Promise<VerificationRunnerOutcome> {
  const currentCycles = getReviewStatus(issueId)?.verificationCycleCount ?? 0;

  if (currentCycles >= VERIFICATION_MAX_CYCLES) {
    const reason = `Circuit breaker: ${currentCycles}/${VERIFICATION_MAX_CYCLES} cycles exceeded — skipping verification`;
    console.log(`[${logPrefix}] ${reason} for ${issueId}`);
    setReviewStatus(issueId, { verificationStatus: 'skipped' });
    return { outcome: 'skipped', reason };
  }

  setReviewStatus(issueId, { verificationStatus: 'running' });
  console.log(`[${logPrefix}] Running verification gate for ${issueId} (attempt ${currentCycles + 1}/${VERIFICATION_MAX_CYCLES})`);

  try {
    const verifyResult = await runVerificationGate(workspacePath, {
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
    });

    if (!verifyResult.passed) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = verifyResult.failedCheck ?? 'unknown';
      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: verifyResult.summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;
      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${verifyResult.summary}\n\nFix the failing check, commit and push, then RESUBMIT for review by running:\ncurl -X POST ${apiUrl}/api/workspaces/${issueId}/request-review -H "Content-Type: application/json" -d '{}'\nDo NOT stop until review passes.`;

      try {
        const fileResult = await writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'review-agent',
          outcome: 'verification-failed',
          summary: `Verification FAILED at ${failedCheck} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        });
        if (fileResult.success) {
          const agentId = `agent-${issueId.toLowerCase()}`;
          const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}\nRead and address: ${fileResult.relativePath}`;
          await messageAgent(agentId, msg);
          console.log(`[${logPrefix}] Verification failed for ${issueId} — sent feedback to ${agentId}`);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    setReviewStatus(issueId, { verificationStatus: 'passed', verificationNotes: undefined });
    console.log(`[${logPrefix}] Verification passed for ${issueId} — proceeding to review-agent`);
    return { outcome: 'passed' };

  } catch (verifyErr: any) {
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      verificationStatus: 'failed',
      verificationNotes: `Verification infrastructure error: ${verifyErr.message}`,
    });
    console.error(`[${logPrefix}] Verification infrastructure error for ${issueId}:`, verifyErr);
    return { outcome: 'error', message: verifyErr.message };
  }
}
