/**
 * Shared workspace state reset logic for issue reopen.
 *
 * Called by both the CLI `pan reopen` command and the dashboard
 * `POST /api/issues/:id/reopen` endpoint to ensure consistent behavior.
 *
 * All filesystem I/O uses fs/promises so this is safe on the dashboard event loop.
 */

import { existsSync } from 'fs';
import { readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import {
  getReviewStatus,
  setReviewStatus,
} from './review-status.js';

export interface ReopenResult {
  specialistStatesReset: boolean;
  previousReviewStatus: string | null;
  previousTestStatus: string | null;
  previousMergeStatus: string | null;
  queueItemsRemoved: Record<string, number>;
  stateMdUpdated: boolean;
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
 * - Appends a "Reopened" section to .planning/STATE.md
 *
 * @param issueId - Issue identifier (e.g., "PAN-256")
 * @param workspacePath - Absolute path to workspace directory
 * @param options - Optional reason and tracker context
 */
export async function reopenWorkspaceState(
  issueId: string,
  workspacePath: string,
  options: ReopenOptions = {}
): Promise<ReopenResult> {
  const result: ReopenResult = {
    specialistStatesReset: false,
    previousReviewStatus: null,
    previousTestStatus: null,
    previousMergeStatus: null,
    queueItemsRemoved: {},
    stateMdUpdated: false,
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

  // 2. Append "Reopened" section to STATE.md (async — safe on dashboard event loop)
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    const previousContent = await readFile(statePath, 'utf-8');
    const lastStatusMatch = previousContent.match(/\*\*STATUS:\s*([^*\n]+)\*\*/);
    const previousStatus = lastStatusMatch ? lastStatusMatch[1].trim() : 'Unknown';

    const date = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      '',
      `## Reopened — ${date}`,
      '',
      `**Previous status:** ${previousStatus}`,
    ];

    if (result.previousReviewStatus) {
      lines.push(`**Previous review status:** ${result.previousReviewStatus}`);
    }
    if (result.previousTestStatus) {
      lines.push(`**Previous test status:** ${result.previousTestStatus}`);
    }
    if (options.reason) {
      lines.push(`**Reason:** ${options.reason}`);
    }
    if (options.trackerContext) {
      lines.push('');
      lines.push('**Tracker context at reopen:**');
      lines.push('');
      lines.push(options.trackerContext);
    }

    lines.push('');
    lines.push('Specialist states reset to pending. Resume implementation based on tracker context above.');

    await appendFile(statePath, lines.join('\n') + '\n', 'utf-8');
    result.stateMdUpdated = true;
  }

  return result;
}
