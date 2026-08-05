import { readActiveReviewArtifactContext } from './agents/agent-state-source.js';
import { readMemoizedArtifactVerdict } from './cloister/synthesis-verdict.js';
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
      const liveStatus = dbStatus!;
      // PAN-3511: the normal status-read path stays filesystem-free. Only after
      // the existing stale-refusal predicate matches do we consult the bounded
      // active-run memo, and only to corroborate a terminal journal verdict.
      const journalVerdict = (journal.durable as { reviewStatus?: unknown }).reviewStatus;
      const review = readActiveReviewArtifactContext(issueId);
      const artifact = typeof journalVerdict === 'string' && review
        ? readMemoizedArtifactVerdict(issueId, review)
        : null;
      const artifactHeadMatchesLive = Boolean(
        artifact?.headSha
        && liveStatus.lastVerifiedCommit
        && artifact.headSha === liveStatus.lastVerifiedCommit,
      );
      const headlessArtifactHasHostBinding = Boolean(
        artifact
        && !artifact.headSha
        && review?.roleRunHead
        && liveStatus.lastVerifiedCommit
        && review.roleRunHead === liveStatus.lastVerifiedCommit,
      );
      if (
        artifact
        && artifact.verdict === journalVerdict
        && (artifactHeadMatchesLive || headlessArtifactHasHostBinding)
      ) {
        console.log(
          `[review-status] Active-run artifact corroborated the stale journal verdict with a live review-head binding for ${issueId}; replaying the terminal journal result.`,
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
