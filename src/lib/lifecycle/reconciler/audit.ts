/**
 * Label sync audit writer (PAN-805).
 *
 * Every API attempt — success, failure, rate-limited, or skipped — is recorded
 * to `label_sync_audit` so failures are debuggable after the fact.
 */

import { getDatabase } from '../../database/index.js';

export type AuditAction = 'add' | 'remove';
export type AuditOutcome = 'success' | 'failure' | 'rate_limited' | 'skipped';

export interface AuditEntry {
  issueId: string;
  targetLabel: string;
  action: AuditAction;
  outcome: AuditOutcome;
  reason?: string;
  retryCount: number;
  httpStatus?: number;
}

/**
 * Record a label-sync attempt to the audit table.
 */
export function recordAudit(entry: AuditEntry): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO label_sync_audit (
      issue_id, attempted_at, target_label, action, outcome, reason, retry_count, http_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.issueId,
    new Date().toISOString(),
    entry.targetLabel,
    entry.action,
    entry.outcome,
    entry.reason ?? null,
    entry.retryCount,
    entry.httpStatus ?? null,
  );
}
