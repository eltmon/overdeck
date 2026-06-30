import type { ReviewStatus } from '../review-status.js';
import { updateIssueRecordForIssue, type PanIssuePipelineRecord } from '../pan-dir/records.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';

export function updateIssueRecordForReviewStatusSync(issueId: string, status: ReviewStatus): void {
  void updateIssueRecordForIssue(issueId, status);
}

/** Resolve and read the per-issue journal record's pipeline block, or null. Best-effort. */
function readPipelineSync(issueId: string): PanIssuePipelineRecord | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return null;
    const record = readIssueRecordSync(project, issueId);
    return record?.pipeline ?? null;
  } catch {
    return null;
  }
}

/**
 * PAN-1988: feedback TEXT (review / test / merge / inspect / verification notes) is durable
 * JOURNAL state, not DB-cache state. The SQLite row holds only the queryable status flags;
 * the human-readable notes live in the per-issue git record (`<workspace>/.pan/records/<issue>.json`,
 * PAN-1908). This overlays those notes onto a DB-sourced status so every reader (deacon
 * CI-failure detection, dashboard panels) stays transparent while the DB stops storing them.
 */
export function enrichReviewNotesFromRecordSync(issueId: string, status: ReviewStatus): ReviewStatus {
  const pipeline = readPipelineSync(issueId);
  if (!pipeline) return status;
  return {
    ...status,
    reviewNotes: pipeline.reviewNotes ?? status.reviewNotes,
    testNotes: pipeline.testNotes ?? status.testNotes,
    mergeNotes: pipeline.mergeNotes ?? status.mergeNotes,
    inspectNotes: pipeline.inspectNotes ?? status.inspectNotes,
    verificationNotes: pipeline.verificationNotes ?? status.verificationNotes,
    scopeDrift: pipeline.scopeDrift ?? status.scopeDrift,
    // PAN-1988 auto-heal: the durable review-request intent is journal-only — overlay it on every
    // read so the merge base preserves it through partial updates and the dispatch reconcile sees it.
    reviewRequestedAt: pipeline.reviewRequestedAt ?? status.reviewRequestedAt,
  };
}

/**
 * PAN-1988: read the journal record's durable verdict for an issue — the SOURCE OF TRUTH.
 * Returns the record `updatedAt` (used to decide whether the journal is newer than the DB
 * cache) plus the durable status fields (flags + feedback notes). Derived/live columns
 * (readyForMerge, blockerReasons) are intentionally omitted — the reader recomputes them.
 *
 * This is what makes verdict writes host-owned: a sandboxed agent can always write the journal
 * (workspace-local) even when it cannot write `~/.overdeck/overdeck.db`. The host reconciles
 * the cache from this on read, so no agent has to escalate out of its sandbox to record a verdict.
 */
export function readJournalStatusSync(
  issueId: string,
): { updatedAt: string; durable: Partial<ReviewStatus> & { closedOut?: boolean; closedOutAt?: string } } | null {
  const p = readPipelineSync(issueId);
  if (!p) return null;
  return {
    updatedAt: p.updatedAt,
    durable: {
      reviewStatus: p.reviewStatus as ReviewStatus['reviewStatus'],
      testStatus: p.testStatus as ReviewStatus['testStatus'],
      mergeStatus: (p.mergeStatus as ReviewStatus['mergeStatus']) ?? undefined,
      inspectStatus: (p.inspectStatus as ReviewStatus['inspectStatus']) ?? undefined,
      verificationStatus: (p.verificationStatus as ReviewStatus['verificationStatus']) ?? undefined,
      reviewNotes: p.reviewNotes,
      testNotes: p.testNotes,
      mergeNotes: p.mergeNotes,
      inspectNotes: p.inspectNotes,
      verificationNotes: p.verificationNotes,
      scopeDrift: p.scopeDrift,
      prUrl: p.prUrl,
      prNumber: p.prNumber,
      prHeadSha: p.prHeadSha,
      reviewedAtCommit: p.reviewedAtCommit,
      lastVerifiedCommit: p.lastVerifiedCommit,
      reviewRequestedAt: p.reviewRequestedAt,
      autoMerge: p.autoMerge,
      deaconIgnored: p.deaconIgnored,
      deaconIgnoredAt: p.deaconIgnoredAt,
      deaconIgnoredReason: p.deaconIgnoredReason,
      closedOut: p.closedOut,
      closedOutAt: p.closedOutAt,
    },
  };
}
