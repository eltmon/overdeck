import type { HeadAnchor } from '../git-utils.js';

export interface WorkStartVerdictAdapter {
  refreshReviewedAnchor(issueId: string, anchor: HeadAnchor): void;
  resetPipelineVerdicts(issueId: string): boolean;
}

export interface VerdictPreservationStatus {
  reviewStatus: string;
  testStatus: string;
  verificationStatus?: string;
  reviewedAtCommit?: HeadAnchor;
}

export type VerdictPreservationStatusReader = (issueId: string) => VerdictPreservationStatus | null;

let workStartVerdictAdapter: WorkStartVerdictAdapter | null = null;
let verdictPreservationStatusReader: VerdictPreservationStatusReader | null = null;

/** Registers the review-status write-door adapter used when a work agent starts. */
export function registerWorkStartVerdictAdapter(adapter: WorkStartVerdictAdapter): void {
  workStartVerdictAdapter = adapter;
}

export function refreshWorkStartReviewedAnchor(issueId: string, anchor: HeadAnchor): void {
  workStartVerdictAdapter?.refreshReviewedAnchor(issueId, anchor);
}

export function resetWorkStartPipelineVerdicts(issueId: string): boolean {
  return workStartVerdictAdapter?.resetPipelineVerdicts(issueId) ?? false;
}

/** Registers the review-status reader used to preserve current work-start verdicts. */
export function registerVerdictPreservationStatusReader(
  reader: VerdictPreservationStatusReader,
): void {
  verdictPreservationStatusReader = reader;
}

export function readVerdictPreservationStatus(issueId: string): VerdictPreservationStatus | null {
  return verdictPreservationStatusReader?.(issueId) ?? null;
}
