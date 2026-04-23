/**
 * Reconciler push step (PAN-805).
 *
 * Tick step 1: diff issue_state vs current remote labels, write deltas.
 * Only processes issues where updated_at > last_synced_at (local intent pending).
 */

import { getDatabase } from '../../database/index.js';
import { desiredLabels, computeLabelDeltas } from './desired-labels.js';
import { recordAudit } from './audit.js';
import type { GitHubClient } from './github-client.js';
import type { ReconcilerConfig } from './types.js';

export async function runPushStep(
  config: ReconcilerConfig,
  gh: GitHubClient,
): Promise<void> {
  const db = getDatabase();

  // Select issues whose local state changed since the last successful sync
  const rows = db
    .prepare(
      `SELECT issue_id, canonical_state, pending_mutation FROM issue_state WHERE updated_at > last_synced_at`
    )
    .all() as Array<{ issue_id: string; canonical_state: string; pending_mutation: string | null }>;

  if (rows.length === 0) return;

  for (const row of rows) {
    const issueId = row.issue_id;
    const auditReason = row.pending_mutation ?? undefined;

    // Parse issue number from issue ID (e.g. "PAN-805" → 805)
    const issueNumber = parseInt(issueId.split('-').pop() || '', 10);
    if (isNaN(issueNumber)) {
      console.warn(`[reconciler:push] Could not parse issue number from ${issueId}`);
      continue;
    }

    let actualLabels: string[];
    try {
      actualLabels = await gh.listIssueLabels(issueNumber);
    } catch (err) {
      console.warn(`[reconciler:push] Failed to fetch labels for ${issueId}:`, err);
      continue;
    }

    const desired = desiredLabels(row.canonical_state as any);
    const { add, remove } = computeLabelDeltas(desired, actualLabels);

    const now = new Date().toISOString();

    if (add.length === 0 && remove.length === 0) {
      // No-op diff — record skipped audit and update sync timestamp
      recordAudit({
        issueId,
        targetLabel: '',
        action: 'add',
        outcome: 'skipped',
        reason: auditReason ?? 'no_diff',
        retryCount: 0,
      });

      db.prepare(
        `UPDATE issue_state SET last_synced_at = ?, pending_mutation = NULL WHERE issue_id = ?`
      ).run(now, issueId);
      continue;
    }

    // Apply additions
    for (const label of add) {
      const result = await gh.addLabel(issueNumber, label);
      recordAudit({
        issueId,
        targetLabel: label,
        action: 'add',
        outcome: result.ok ? 'success' : result.status === 429 ? 'rate_limited' : 'failure',
        retryCount: result.retryCount,
        reason: auditReason,
        httpStatus: result.status,
      });
    }

    // Apply removals
    for (const label of remove) {
      const result = await gh.removeLabel(issueNumber, label);
      recordAudit({
        issueId,
        targetLabel: label,
        action: 'remove',
        outcome: result.ok ? 'success' : result.status === 429 ? 'rate_limited' : 'failure',
        retryCount: result.retryCount,
        reason: auditReason,
        httpStatus: result.status,
      });
    }

    // Update last_synced_at regardless of partial success so we don't retry
    // infinitely on the same tick; failures will be handled by next tick.
    db.prepare(
      `UPDATE issue_state SET last_synced_at = ?, pending_mutation = NULL WHERE issue_id = ?`
    ).run(now, issueId);
  }
}
