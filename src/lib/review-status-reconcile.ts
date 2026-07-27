import { normalizeReviewStatusSync } from './review-status-normalize.js';
import { upsertReviewStatusSync as dbUpsert, markWorkspaceStuck } from './overdeck/review-status-sync.js';
import type { readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import type { InspectionStatusFields } from './inspection-status.js';
import type { StrikeLandingStatus } from './strike-landing.js';
import type { ScopeDriftRecord } from './xbrief/continue-state.js';
import type { ReviewCycleEntry } from './cloister/review-convergence.js';
import {
  countBlockingFindingsForRun,
  evaluateReviewConvergence,
  findLatestReviewRunDir,
} from './cloister/review-convergence.js';
import { resolveProjectFromIssueSync } from './projects.js';

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
  reviewerVerdicts?: Partial<Record<string, {
    status: 'passed' | 'blocked';
    atCommit?: string;
    findingsPath?: string;
  }>>;
  reviewCycleHistory?: ReviewCycleEntry[];
}

type ReviewStatusJournal = NonNullable<ReturnType<typeof readJournalStatusSync>>;

export interface ReviewStatusReconcileHooks {
  notifyStatusChanged(issueId: string, status: ReviewStatus): void;
  deliverReviewVerdictFeedbackHostSide(issueId: string, status: ReviewStatus): Promise<void>;
  emitReactiveLifecycleEvent(type: 'review.approved' | 'test.passed', issueId: string): void;
  maybeAutoDispatchReviewHostSide(issueId: string, status: ReviewStatus): void;
  maybeRecoverTestVerdictHostSide(issueId: string, status: ReviewStatus): void;
}

export function verificationSatisfied(
  status: Pick<ReviewStatus, 'verificationStatus'>,
): boolean {
  return status.verificationStatus !== 'failed';
}

/** PAN-1988: merge-gate predicate shared by direct writes and journal reconciliation. */
export function reviewGatesPassedSync(
  status: Pick<
    ReviewStatus,
    'reviewStatus' | 'testStatus' | 'verificationStatus' | 'uatStatus' | 'mergeStatus'
  >,
): boolean {
  return (
    (status.reviewStatus === 'passed' || status.reviewStatus === 'skipped') &&
    (status.testStatus === 'passed' || status.testStatus === 'skipped') &&
    verificationSatisfied(status) &&
    (status.uatStatus === undefined || status.uatStatus === 'passed') &&
    (status.mergeStatus === 'pending' ||
      status.mergeStatus === 'queued' ||
      status.mergeStatus === undefined ||
      status.mergeStatus === null)
  );
}

/** Reconcile a newer canonical journal verdict into the SQLite cache. */
export function reconcileJournalIntoCacheSync(
  issueId: string,
  dbStatus: ReviewStatus | null,
  journal: ReviewStatusJournal,
  hooks: ReviewStatusReconcileHooks,
): ReviewStatus {
  const merged: ReviewStatus = {
    ...(dbStatus ?? {
      issueId,
      reviewStatus: 'pending' as const,
      testStatus: 'pending' as const,
      updatedAt: journal.updatedAt,
      readyForMerge: false,
    }),
  };
  for (const [key, value] of Object.entries(journal.durable)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  for (const key of journal.clearedFields ?? []) {
    delete (merged as unknown as Record<string, unknown>)[key];
  }
  merged.issueId = issueId;
  merged.updatedAt = journal.updatedAt;
  const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
  merged.readyForMerge = hasBlockers ? false : reviewGatesPassedSync(merged);
  const reconciled = normalizeReviewStatusSync(merged);
  try {
    dbUpsert(reconciled);
    // PAN-2988 — the reconcile changed the effective status; the read model only
    // advances via events, so emit the transition the lost write never produced.
    hooks.notifyStatusChanged(issueId, reconciled);
  } catch {
    // Read-only DB (a sandboxed reader) — the host reconciles when it reads. Non-fatal.
  }

  const wasBlocked = dbStatus?.reviewStatus === 'blocked' || dbStatus?.reviewStatus === 'failed';
  const nowBlocked = reconciled.reviewStatus === 'blocked' || reconciled.reviewStatus === 'failed';
  if (nowBlocked && !wasBlocked) {
    // PAN-3151: record blocking-finding count and gate on convergence
    try {
      const project = resolveProjectFromIssueSync(issueId);
      if (!project) {
        console.warn(`[review-status] reconcile: cannot resolve project for ${issueId}, skipping cycle recording`);
        void hooks.deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
      } else {
        const issueLower = issueId.toLowerCase();
        const workspacePath = `${project.projectPath}/workspaces/feature-${issueLower}`;
        const reviewRunDir = findLatestReviewRunDir(workspacePath);

        if (!reviewRunDir) {
          console.warn(`[review-status] reconcile: no review run dir found for ${issueId}, skipping cycle recording`);
          void hooks.deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
        } else {
          const blockingCount = countBlockingFindingsForRun(reviewRunDir);
          if (blockingCount === null) {
            console.warn(`[review-status] reconcile: cannot count findings for ${issueId}, skipping cycle recording`);
            void hooks.deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
          } else {
            // Use full directory basename as runId (format: agent-*-review-*)
            const runDirName = reviewRunDir.split('/').pop() ?? '';
            const runId = runDirName;

            // Ensure reviewCycleHistory is initialized
            if (!reconciled.reviewCycleHistory) {
              reconciled.reviewCycleHistory = [];
            }

            // Deduplicate by runId: if already recorded, skip appending
            const cycleNumber = reconciled.reviewCycleHistory.length + 1;
            const alreadyRecorded = reconciled.reviewCycleHistory.some(e => e.runId === runId);

            if (!alreadyRecorded) {
              const entry: ReviewCycleEntry = {
                cycle: cycleNumber,
                runId,
                atCommit: reconciled.reviewedAtCommit,
                blockingCount,
                recordedAt: new Date().toISOString(),
              };
              reconciled.reviewCycleHistory.push(entry);

              // Persist the appended cycle
              try {
                dbUpsert(reconciled);
              } catch {
                // Non-fatal: read-only DB
              }
            }

            // Evaluate convergence
            const counts = reconciled.reviewCycleHistory.map(e => e.blockingCount);
            const convergence = evaluateReviewConvergence(counts);

            if (convergence === 'not-converging') {
              // Gate engaged: mark stuck and emit error activity, skip feedback hook
              markWorkspaceStuck(issueId, 'review-not-converging', { counts });
              reconciled.stuck = true;
              reconciled.stuckReason = 'review-not-converging';
              reconciled.stuckAt = new Date().toISOString();
              reconciled.stuckDetails = JSON.stringify({ counts });

              // Persist stuck state
              try {
                dbUpsert(reconciled);
              } catch {
                // Non-fatal: read-only DB
              }

              // Emit error-level activity
              const countSeries = counts.join(' → ');
              console.error(
                `[review-status] reconcile: review loop not converging for ${issueId}: ${countSeries}. ` +
                  `Consider decomposition (split the remaining work), or unstick to continue rework.`,
              );
              // TODO: emit activity entry to pipeline when activity recording is ready
            } else {
              // Converging: invoke feedback hook as normal
              void hooks.deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[review-status] reconcile: cycle recording error for ${issueId}:`, error);
      // On any error, still deliver feedback (don't gate on an exception)
      void hooks.deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
    }
  }

  const wasReviewPassed = dbStatus?.reviewStatus === 'passed';
  const nowReviewPassed = reconciled.reviewStatus === 'passed';
  if (nowReviewPassed && !wasReviewPassed && reconciled.testStatus === 'pending') {
    console.log(`[review-status] reconcile: review.approved for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
    hooks.emitReactiveLifecycleEvent('review.approved', issueId);
  }
  const wasTestPassed = dbStatus?.testStatus === 'passed';
  const nowTestPassed = reconciled.testStatus === 'passed';
  if (nowTestPassed && !wasTestPassed) {
    console.log(`[review-status] reconcile: test.passed for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
    hooks.emitReactiveLifecycleEvent('test.passed', issueId);
  }

  hooks.maybeAutoDispatchReviewHostSide(issueId, reconciled);
  hooks.maybeRecoverTestVerdictHostSide(issueId, reconciled);
  return reconciled;
}
