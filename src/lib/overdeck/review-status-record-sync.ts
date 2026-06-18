import type { ReviewStatus } from '../review-status.js';
import { updateIssueRecordForIssue } from '../pan-dir/records.js';

export function updateIssueRecordForReviewStatusSync(issueId: string, status: ReviewStatus): void {
  void updateIssueRecordForIssue(issueId, status);
}
