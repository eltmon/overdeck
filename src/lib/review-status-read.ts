import { enrichReviewNotesFromRecordSync, readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import {
  reconcileJournalIntoCacheSync,
  type ReviewStatus,
  type ReviewStatusReconcileHooks,
} from './review-status-reconcile.js';
import { staleVerdictSnapshotAgainstLiveCycle } from './pan-dir/pipeline-verdict-merge.js';
import { readMemoizedArtifactVerdict } from './cloister/synthesis-verdict.js';
import { restoreWouldTripHeadGuard } from './cloister/verdict-head-guard.js';

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
      // PAN-3511: the artifact of record gets a say before the refusal stands.
      // A reviewer writes its verdict artifact seconds to minutes before that
      // verdict syncs into the row, so a journal replay that merely LOOKS stale
      // against the live cycle may in fact be the finished review. When a fresh
      // artifact independently carries the SAME terminal verdict, the journal is
      // corroborated and the refusal is lifted.
      //
      // Strictly one-directional: the artifact can only lift a refusal the
      // resolver was already making, never invent an approval (NFR-4). An absent
      // or disagreeing artifact leaves the existing refusal exactly as it was.
      // The consult sits behind this already-rare branch and is memoized per
      // issue, so the common read path does zero filesystem work.
      const journalVerdict = (journal.durable as { reviewStatus?: unknown }).reviewStatus;
      const artifact = typeof journalVerdict === 'string'
        ? readMemoizedArtifactVerdict(issueId)
        : null;
      const artifactHeadMismatch = artifact && restoreWouldTripHeadGuard({
        artifactHead: artifact.headSha,
        rowHead: dbStatus?.lastVerifiedCommit,
      });
      if (artifact && artifact.verdict === journalVerdict && !artifactHeadMismatch) {
        console.log(
          `[review-status] Artifact lifted the stale-journal refusal for ${issueId}: `
          + `a fresh ${artifact.verdict} review artifact corroborates the journal verdict, `
          + `so the replay is the finished review rather than a stale snapshot.`,
        );
        return reconcileJournalIntoCacheSync(issueId, dbStatus ?? null, journal, hooks);
      }
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
