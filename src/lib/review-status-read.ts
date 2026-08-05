import { enrichReviewNotesFromRecordSync, readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import {
  reconcileJournalIntoCacheSync,
  type ReviewStatus,
  type ReviewStatusReconcileHooks,
} from './review-status-reconcile.js';
import { staleVerdictSnapshotAgainstLiveCycle } from './pan-dir/pipeline-verdict-merge.js';

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
    const staleSnapshot = dbStatus
      ? staleVerdictSnapshotAgainstLiveCycle(
          dbStatus as unknown as Record<string, unknown>,
          journal.durable as unknown as Record<string, unknown>,
        )
      : null;
    if (staleSnapshot) {
      console.warn(
        `[review-status] Refusing stale journal verdict replay for ${issueId}: `
        + `live cycle ${new Date(staleSnapshot.liveCycle).toISOString()} at HEAD ${staleSnapshot.liveHead ?? 'unknown'} `
        + `supersedes snapshot cycle ${staleSnapshot.snapshotCycle ? new Date(staleSnapshot.snapshotCycle).toISOString() : 'unknown'} `
        + `at HEAD ${staleSnapshot.snapshotHead ?? 'unknown'}.`,
      );
      return dbStatus ?? null;
    }
    return reconcileJournalIntoCacheSync(issueId, dbStatus ?? null, journal, hooks);
  }

  const enriched = enrichReviewNotesFromRecordSync(issueId, dbStatus!);
  hooks.maybeAutoDispatchReviewHostSide(issueId, enriched);
  hooks.maybeRecoverTestVerdictHostSide(issueId, enriched);
  return enriched;
}
