/**
 * Shared workspace state reset logic for issue reopen.
 *
 * Called by both the CLI `pan reopen` command and the dashboard
 * `POST /api/issues/:id/reopen` endpoint to ensure consistent behavior.
 *
 * All filesystem I/O uses fs/promises so this is safe on the dashboard event loop.
 */

import {
  getReviewStatusSync,
  setReviewStatusSync,
} from './review-status.js';
import { Data, Effect } from 'effect';
import { getProjectSync, resolveProjectFromIssueSync } from './projects.js';
import { appendContinueSessionEntryForIssue } from './xbrief/lifecycle-io.js';
import { clearIssueClosedCache } from './cloister/issue-closed.js';
import { resetRecordPipelineForReopenSync } from './pan-dir/record-update.js';

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

async function reopenWorkspaceStatePromise(
  issueId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspacePath: string | null,
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

  clearIssueClosedCache(issueId);

  // 1. Reset specialist states — single-row atomic update, no TOCTOU risk.
  // setReviewStatus() reads only this issue's row and upserts only this issue's row.
  const existing = getReviewStatusSync(issueId);

  if (existing) {
    result.previousReviewStatus = existing.reviewStatus;
    result.previousTestStatus = existing.testStatus;
    result.previousMergeStatus = existing.mergeStatus ?? null;
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  if (resolved) {
    // Establish the new evidence cycle in the durable record before publishing
    // the cache reset. This makes every pre-reopen journal/fallback generation
    // stale even when it lands after reopen while waiting on the record lock.
    const project = getProjectSync(resolved.projectKey);
    if (project) resetRecordPipelineForReopenSync(project, issueId.toUpperCase());
  }

  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: `Reopened${options.reason ? `: ${options.reason}` : ''}`,
    testNotes: undefined,
    verificationNotes: undefined,
    verificationCycleCount: 0,
    mergeNotes: undefined,
    readyForMerge: false,
    prUrl: existing?.prUrl,
    autoRequeueCount: 0,
    reviewRetryCount: 0,
    testRetryCount: 0,
    mergeRetryCount: 0,
    recoveryStartedAt: undefined,
    reviewRequestedAt: undefined,
    reviewSpawnedAt: undefined,
    conflictResolutionDispatchedAt: undefined,
    blockerReasons: undefined,
    mergeStep: undefined,
    retiredAt: undefined,
    // PAN-653: clear stuck state so Deacon resumes processing this issue.
    stuck: undefined,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    // Start a new evidence cycle while retaining status history and prior
    // strike-landing attempts.
    reviewedAtCommit: undefined,
    lastVerifiedCommit: undefined,
    strikeReadyHead: undefined,
    strikeReadyAt: undefined,
    strikeLandingState: undefined,
    strikeRecoveryCount: 0,
    strikeTransportRetryCount: undefined,
    strikeNextAttemptAt: undefined,
  });
  result.specialistStatesReset = true;

  // 2. Append a reopen breadcrumb to the scope xBRIEF's continue file.
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for reopen Effect variants. */
export class ReopenError extends Data.TaggedError('ReopenError')<{
  readonly issueId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `reopenWorkspaceState`. */
export const reopenWorkspaceState = (
  issueId: string,
  workspacePath: string | null,
  options: ReopenOptions = {},
): Effect.Effect<ReopenResult, ReopenError> =>
  Effect.tryPromise({
    try: () => reopenWorkspaceStatePromise(issueId, workspacePath, options),
    catch: (cause) =>
      new ReopenError({
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
