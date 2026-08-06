import type { HeadAnchor } from '../git-utils.js';
import { evaluateWorkspaceAnchorDrift } from '../workspace-anchor-drift.js';
import { readVerdictPreservationStatus } from './work-start-verdicts.js';

export type PipelineVerdictPreservationDecision =
  | { preserve: true; reason: string; refreshedAnchor?: HeadAnchor }
  | { preserve: false; reason: string };

/** Decide whether a fresh work-agent session may keep verdicts earned by the current code. */
export async function shouldPreservePipelineVerdicts(
  issueId: string,
  workspacePath: string,
): Promise<PipelineVerdictPreservationDecision> {
  try {
    const status = readVerdictPreservationStatus(issueId);
    if (!status) return { preserve: false, reason: 'no pipeline verdicts are recorded' };
    if (!status.reviewedAtCommit) {
      return { preserve: false, reason: 'the review verdict has no commit anchor' };
    }
    if (status.reviewStatus !== 'passed' && status.reviewStatus !== 'skipped') {
      return { preserve: false, reason: `review is ${status.reviewStatus}` };
    }
    if (status.testStatus !== 'passed') {
      return { preserve: false, reason: `tests are ${status.testStatus}` };
    }
    if (status.verificationStatus !== 'passed') {
      return { preserve: false, reason: `verification is ${status.verificationStatus ?? 'missing'}` };
    }

    const verdict = await evaluateWorkspaceAnchorDrift(
      issueId,
      workspacePath,
      status.reviewedAtCommit,
    );
    switch (verdict.kind) {
      case 'current':
        return { preserve: true, reason: 'workspace HEAD matches the reviewed commit anchor' };
      case 'benign':
        return {
          preserve: true,
          reason: 'workspace HEAD moved without changing the reviewed code',
          refreshedAnchor: verdict.currentAnchor,
        };
      case 'drifted':
        return { preserve: false, reason: 'workspace code changed after review' };
      case 'unreadable':
        return { preserve: false, reason: 'the current workspace commit anchor is unreadable' };
    }
  } catch (error) {
    return {
      preserve: false,
      reason: `verdict preservation check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
