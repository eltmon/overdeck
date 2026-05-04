/**
 * Shared workspace state reset logic for issue reopen.
 *
 * Called by both the CLI `pan reopen` command and the dashboard
 * `POST /api/issues/:id/reopen` endpoint to ensure consistent behavior.
 *
 * All filesystem I/O uses fs/promises so this is safe on the dashboard event loop.
 */

import {
  getReviewStatus,
  setReviewStatus,
} from './review-status.js';
import { resolveProjectFromIssue } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';

export interface ReopenResult {
  specialistStatesReset: boolean;
  previousReviewStatus: string | null;
  previousTestStatus: string | null;
  previousMergeStatus: string | null;
  queueItemsRemoved: Record<string, number>;
  /** True when a `reason: 'resume'` entry was appended to the continue file. */
  continueFileUpdated: boolean;
  reason?: string;
}

export interface ReopenOptions {
  reason?: string;
  trackerContext?: string;
}

/**
 * Reset workspace state for a reopened issue.
 *
 * - Resets specialist states (review/test/merge → pending) via setReviewStatus
 * - Removes the issue from all specialist queues
 * - Appends a `reason: 'resume'` entry to the scope vBRIEF's continue file
 *
 * @param issueId - Issue identifier (e.g., "PAN-256")
 * @param workspacePath - Absolute path to workspace directory (kept for callers
 *   that derive it locally; reopen no longer uses workspace files directly).
 * @param options - Optional reason and tracker context
 */
export async function reopenWorkspaceState(
  issueId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspacePath: string,
  options: ReopenOptions = {}
): Promise<ReopenResult> {
  const result: ReopenResult = {
    specialistStatesReset: false,
    previousReviewStatus: null,
    previousTestStatus: null,
    previousMergeStatus: null,
    queueItemsRemoved: {},
    continueFileUpdated: false,
    reason: options.reason,
  };

  // 1. Reset specialist states — single-row atomic update, no TOCTOU risk.
  // setReviewStatus() reads only this issue's row and upserts only this issue's row.
  const existing = getReviewStatus(issueId);

  if (existing) {
    result.previousReviewStatus = existing.reviewStatus;
    result.previousTestStatus = existing.testStatus;
    result.previousMergeStatus = existing.mergeStatus ?? null;
  }

  setReviewStatus(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: `Reopened${options.reason ? `: ${options.reason}` : ''}`,
    testNotes: undefined,
    mergeNotes: undefined,
    readyForMerge: false,
    prUrl: existing?.prUrl,
    autoRequeueCount: 0,
    // PAN-653: clear stuck state so Deacon resumes processing this issue.
    // reviewedAtCommit is cleared so the next approve cycle records the new commit SHA.
    stuck: undefined,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    reviewedAtCommit: undefined,
  });
  result.specialistStatesReset = true;

  // 2. Append a reopen breadcrumb to the scope vBRIEF's continue file.
  const resolved = resolveProjectFromIssue(issueId);
  if (resolved) {
    try {
      const noteParts: string[] = [`Reopened on ${new Date().toISOString().slice(0, 10)}`];
      if (options.reason) noteParts.push(`reason: ${options.reason}`);
      if (result.previousReviewStatus) {
        noteParts.push(`review: ${result.previousReviewStatus} → pending`);
      }
      if (result.previousTestStatus) {
        noteParts.push(`test: ${result.previousTestStatus} → pending`);
      }
      if (result.previousMergeStatus) {
        noteParts.push(`merge: ${result.previousMergeStatus} → pending`);
      }
      if (options.trackerContext) {
        noteParts.push('tracker context attached');
      }

      appendContinueSessionEntryForIssue(resolved.projectPath, issueId, {
        reason: 'resume',
        note: noteParts.join('; '),
      });
      result.continueFileUpdated = true;
    } catch {
      // Non-fatal — specialist states were still reset above.
    }
  }

  return result;
}
