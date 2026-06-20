import type { ReviewStatus } from '../review-status.js';
import { updateIssueRecordForIssue } from '../pan-dir/records.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';

export function updateIssueRecordForReviewStatusSync(issueId: string, status: ReviewStatus): void {
  void updateIssueRecordForIssue(issueId, status);
}

/**
 * PAN-1988: feedback TEXT (review / test / merge / inspect / verification notes) is durable
 * JOURNAL state, not DB-cache state. The SQLite row holds only the queryable status flags;
 * the human-readable notes live in the per-issue git record (`<workspace>/.pan/records/<issue>.json`,
 * PAN-1908). This overlays those notes onto a DB-sourced status so every reader (deacon
 * CI-failure detection, dashboard panels) stays transparent while the DB stops storing them.
 *
 * Best-effort and synchronous: a single small JSON read per per-issue status read. If the
 * record is unavailable (no workspace yet, file missing), the passed-in notes are kept — so
 * this is safe to enable before the DB columns are removed (it just prefers the journal copy).
 */
export function enrichReviewNotesFromRecordSync(issueId: string, status: ReviewStatus): ReviewStatus {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return status;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return status;
    const record = readIssueRecordSync(project, issueId);
    const pipeline = record?.pipeline;
    if (!pipeline) return status;
    return {
      ...status,
      reviewNotes: pipeline.reviewNotes ?? status.reviewNotes,
      testNotes: pipeline.testNotes ?? status.testNotes,
      mergeNotes: pipeline.mergeNotes ?? status.mergeNotes,
      inspectNotes: pipeline.inspectNotes ?? status.inspectNotes,
      verificationNotes: pipeline.verificationNotes ?? status.verificationNotes,
    };
  } catch {
    return status;
  }
}
