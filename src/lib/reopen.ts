/**
 * Shared workspace state reset logic for issue reopen.
 *
 * Called by both the CLI `pan work reopen` command and the dashboard
 * `POST /api/issues/:id/reopen` endpoint to ensure consistent behavior.
 */

import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  loadReviewStatuses,
  saveReviewStatuses,
  type ReviewStatus,
} from '../dashboard/server/review-status.js';
import { checkSpecialistQueue, completeSpecialistTask } from './cloister/specialists.js';

type SpecialistType = 'review-agent' | 'test-agent' | 'merge-agent';
const SPECIALIST_NAMES: SpecialistType[] = ['review-agent', 'test-agent', 'merge-agent'];

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
  /** Override the review-status.json path (used in tests for isolation) */
  statusFilePath?: string;
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
export function reopenWorkspaceState(
  issueId: string,
  workspacePath: string,
  options: ReopenOptions = {}
): ReopenResult {
  const result: ReopenResult = {
    specialistStatesReset: false,
    previousReviewStatus: null,
    previousTestStatus: null,
    previousMergeStatus: null,
    queueItemsRemoved: {},
    stateMdUpdated: false,
    reason: options.reason,
  };

  // 1. Reset specialist states
  const statuses = loadReviewStatuses(options.statusFilePath);
  const existing: ReviewStatus | undefined = statuses[issueId];

  if (existing) {
    result.previousReviewStatus = existing.reviewStatus;
    result.previousTestStatus = existing.testStatus;
    result.previousMergeStatus = existing.mergeStatus ?? null;
  }

  const now = new Date().toISOString();
  const history = [...(existing?.history ?? [])];

  // Record the reopen transition in history
  history.push({
    type: 'review',
    status: 'pending',
    timestamp: now,
    notes: `Reopened${options.reason ? `: ${options.reason}` : ''}`,
  });
  while (history.length > 10) history.shift();

  statuses[issueId] = {
    issueId,
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: undefined,
    testNotes: undefined,
    mergeNotes: undefined,
    updatedAt: now,
    readyForMerge: false,
    prUrl: existing?.prUrl,
    autoRequeueCount: 0,
    history,
  };

  saveReviewStatuses(statuses, options.statusFilePath);
  result.specialistStatesReset = true;

  // 2. Remove issue from all specialist queues
  for (const specialistName of SPECIALIST_NAMES) {
    const queue = checkSpecialistQueue(specialistName);
    let removed = 0;
    for (const item of queue.items) {
      const itemIssueId =
        (item.payload as Record<string, unknown>)?.issueId as string | undefined;
      if (itemIssueId && itemIssueId.toUpperCase() === issueId.toUpperCase()) {
        if (completeSpecialistTask(specialistName, item.id)) {
          removed++;
        }
      }
    }
    if (removed > 0) {
      result.queueItemsRemoved[specialistName] = removed;
    }
  }

  // 3. Append "Reopened" section to STATE.md
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    const previousContent = readFileSync(statePath, 'utf-8');
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

    appendFileSync(statePath, lines.join('\n') + '\n');
    result.stateMdUpdated = true;
  }

  return result;
}
