import { enrichReviewNotesFromRecordSync, readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import {
  reconcileJournalIntoCacheSync,
  type ReviewStatus,
  type ReviewStatusReconcileHooks,
} from './review-status-reconcile.js';

export interface ReviewStatusReadHooks extends ReviewStatusReconcileHooks {
  deleteStatus(issueId: string): void;
}

export function resolveJournalReconciledReviewStatusSync(
  issueId: string,
  dbStatus: ReviewStatus | null | undefined,
  hooks: ReviewStatusReadHooks,
): ReviewStatus | null {
  const journal = readJournalStatusSync(issueId);
  if (!journal) return dbStatus ?? null;

  if ((journal.durable as { closedOut?: boolean }).closedOut === true) {
    try {
      hooks.deleteStatus(issueId);
    } catch {
      // Read-only DB (a sandboxed reader) — the host clears residue when it reads. Non-fatal.
    }
    return null;
  }

  const journalNewer = !dbStatus || (dbStatus.updatedAt ?? '') < journal.updatedAt;
  if (journalNewer) {
    return reconcileJournalIntoCacheSync(issueId, dbStatus ?? null, journal, hooks);
  }

  const enriched = enrichReviewNotesFromRecordSync(issueId, dbStatus!);
  hooks.maybeAutoDispatchReviewHostSide(issueId, enriched);
  hooks.maybeRecoverTestVerdictHostSide(issueId, enriched);
  return enriched;
}
