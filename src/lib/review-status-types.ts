import type { ReviewCycleEntry } from './cloister/review-convergence.js';
import type { InspectionStatusFields } from './inspection-status.js';
import type { StrikeLandingStatus } from './strike-landing.js';
import type { ScopeDriftRecord } from './xbrief/continue-state.js';

export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge' | 'inspect' | 'uat' | 'release';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface BlockerReason {
  type: 'failing_checks' | 'merge_conflict' | 'unresolved_conversations' | 'changes_requested' | 'draft_pr' | 'not_mergeable' | 'unmerged_sibling_repo';
  summary: string;
  details?: string;
  detectedAt: string;
}

export interface ReviewStatus extends StrikeLandingStatus, InspectionStatusFields {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked' | 'skipped';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  releaseStatus?: 'pending' | 'releasing' | 'passed' | 'failed' | 'partial' | 'rolled_back' | 'skipped';
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  uatNotes?: string;
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  mergeNotes?: string;
  releaseNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  /** Terminal marker for a closed/stale PR record; cleared only by fresh work or a new PR. */
  retiredAt?: string;
  autoMerge?: boolean;
  autoRequeueCount?: number;
  mergeRetryCount?: number;
  prUrl?: string;
  prHeadSha?: string;
  prNumber?: number;
  history?: StatusHistoryEntry[];
  blockerReasons?: BlockerReason[];
  reviewedAtCommit?: string;
  lastVerifiedCommit?: string;
  mergeStep?: string;
  stuck?: boolean;
  stuckReason?: string;
  stuckAt?: string;
  stuckDetails?: string;
  reviewSpawnedAt?: string | number;
  reviewRequestedAt?: string;
  conflictResolutionDispatchedAt?: string;
  testRetryCount?: number;
  reviewRetryCount?: number;
  recoveryStartedAt?: string;
  deaconIgnored?: boolean;
  deaconIgnoredAt?: string;
  deaconIgnoredReason?: string;
  scopeDrift?: ScopeDriftRecord;
  reviewCycleHistory?: ReviewCycleEntry[];
}
