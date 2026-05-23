/**
 * Re-export from canonical location at src/lib/review-status.ts
 * This file exists only for backward compatibility during the PAN-262 migration.
 */
export {
  loadReviewStatuses,
  saveReviewStatuses,
  setReviewStatusSync,
  getReviewStatusSync,
  clearReviewStatus,
} from '../../lib/review-status.js';

export type { ReviewStatus, StatusHistoryEntry } from '../../lib/review-status.js';
