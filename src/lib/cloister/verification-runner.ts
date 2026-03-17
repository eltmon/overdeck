/**
 * Verification Runner — orchestrates the full verification gate lifecycle.
 *
 * Runs quality gates (typecheck → lint → test by default, or project-specific
 * gates from projects.yaml), updates review status, writes feedback files,
 * and notifies the work agent on failure.
 *
 * Extracted from dashboard/server to be independently testable.
 */

import { getReviewStatus, setReviewStatus } from '../review-status.js';
import { runQualityGates, DEFAULT_GATES } from './validation.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { messageAgent } from '../agents.js';
import { findProjectByPath } from '../projects.js';

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
 * Loads quality gates from projects.yaml for the workspace's project, falling
 * back to DEFAULT_GATES (typecheck, lint, test) when no config exists.
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
    // Load project-specific gates or fall back to defaults
    const projectConfig = findProjectByPath(workspacePath);
    const gates =
      projectConfig?.quality_gates && Object.keys(projectConfig.quality_gates).length > 0
        ? projectConfig.quality_gates
        : DEFAULT_GATES;

    const gateResults = await runQualityGates(gates, workspacePath, 'pre_push', {
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
    });

    const failedGate = gateResults.find(r => !r.passed && r.required !== false);

    if (failedGate) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = failedGate.name;
      const rawOutput = failedGate.output || failedGate.error || '(no output)';
      const truncatedOutput =
        rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
      const summary = `Verification FAILED at ${failedCheck} (${failedGate.durationMs}ms):\n\n${truncatedOutput}`;

      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;
      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\nFix the failing check, commit and push, then RESUBMIT for review by running:\ncurl -X POST ${apiUrl}/api/workspaces/${issueId}/request-review -H "Content-Type: application/json" -d '{}'\nDo NOT stop until review passes.`;

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

    const passSummary = `All checks passed: ${gateResults.map(r => `${r.name} (${r.durationMs}ms)`).join(', ')}`;
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
