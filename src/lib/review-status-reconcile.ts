import { join } from 'path';
import { Effect } from 'effect';
import { notifyPipelineSync } from './pipeline-notifier.js';
import { needsReviewDispatch } from './review-dispatch-decision.js';
import { normalizeReviewStatusSync } from './review-status-normalize.js';
import { upsertReviewStatusSync as dbUpsert } from './overdeck/review-status-sync.js';
import type { readJournalStatusSync } from './overdeck/review-status-record-sync.js';

type ReviewStatus = Parameters<typeof normalizeReviewStatusSync>[0];
type ReviewStatusJournal = NonNullable<ReturnType<typeof readJournalStatusSync>>;
export type SetReviewStatusSync = (
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
) => ReviewStatus;

export function emitReactiveLifecycleEvent(
  type: 'review.approved' | 'test.passed',
  issueId: string,
): void {
  try {
    notifyPipelineSync({ type, issueId });
  } catch (error) {
    console.warn(`[review-status] Failed to emit ${type} for ${issueId}:`, error);
  }
}

export function verificationSatisfied(
  status: Pick<ReviewStatus, 'verificationStatus'>,
): boolean {
  return status.verificationStatus !== 'failed';
}

/**
 * PAN-1988: the merge-gate predicate shared by direct writes and journal reconciliation.
 */
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

/**
 * PAN-1988 — deliver review feedback to the work agent from the host when a blocked/failed
 * verdict is reconciled from the journal. Fully best-effort and never throws into the read path.
 */
export async function deliverReviewVerdictFeedbackHostSide(
  issueId: string,
  status: ReviewStatus,
): Promise<void> {
  try {
    const { deliverReviewVerdictFeedback } = await import('./cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId,
      verdict: status.reviewStatus === 'failed' ? 'failed' : 'blocked',
      notes: status.reviewNotes,
      prUrl: status.prUrl,
    }));
    if (result.agentMessageSent) {
      console.log(`[review-status] delivered review feedback to the work agent for ${issueId} (host-side)`);
    }
  } catch (err) {
    console.warn(`[review-status] host-side review feedback delivery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

const reviewDispatchAttemptAt = new Map<string, number>();
const REVIEW_AUTO_DISPATCH_THROTTLE_MS = 30_000;

/**
 * PAN-1988 auto-heal — re-dispatch review from durable journal intent when the reactive trigger
 * was lost. A 30-second throttle bounds retries for a genuinely gated issue.
 */
export function maybeAutoDispatchReviewHostSide(issueId: string, status: ReviewStatus): void {
  if (!needsReviewDispatch({
    reviewRequestedAt: status.reviewRequestedAt,
    reviewSpawnedAt: status.reviewSpawnedAt,
    reviewStatus: status.reviewStatus,
    mergeStatus: status.mergeStatus,
  })) return;
  const last = reviewDispatchAttemptAt.get(issueId) ?? 0;
  if (Date.now() - last < REVIEW_AUTO_DISPATCH_THROTTLE_MS) return;
  reviewDispatchAttemptAt.set(issueId, Date.now());
  void dispatchReviewHostSide(issueId, status.prUrl);
}

async function dispatchReviewHostSide(issueId: string, prUrl?: string): Promise<void> {
  try {
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return;
    const { existsSync } = await import('fs');
    const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspace)) return;
    let branch = `feature/${issueId.toLowerCase()}`;
    try {
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('git branch --show-current', { cwd: workspace, encoding: 'utf-8' });
      branch = stdout.trim() || branch;
    } catch { /* non-fatal — fall back to the conventional branch name */ }
    const { spawnReviewRoleForIssue } = await import('./cloister/review-agent.js');
    const result = await Effect.runPromise(spawnReviewRoleForIssue({ issueId, workspace, branch, ...(prUrl ? { prUrl } : {}) }));
    if (result.success) {
      if (result.message?.startsWith('Review already in progress')) {
        console.log(`[review-status] review dispatch for ${issueId}: already in progress — no-op (host-side)`);
      } else {
        console.log(`[review-status] auto-dispatched review for ${issueId} from durable journal intent (host-side)`);
      }
    }
  } catch (err) {
    console.warn(`[review-status] host-side review auto-dispatch for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

const testVerdictRecoveryAt = new Map<string, number>();
const TEST_VERDICT_RECOVERY_THROTTLE_MS = 60_000;

export function maybeRecoverTestVerdictHostSide(
  issueId: string,
  status: ReviewStatus,
  setReviewStatus: SetReviewStatusSync,
): void {
  if (status.reviewStatus !== 'passed') return;
  if (status.mergeStatus === 'merged' || status.readyForMerge) return;
  if (status.testStatus !== 'testing' && status.testStatus !== 'pending' && status.testStatus !== 'dispatch_failed') return;
  const last = testVerdictRecoveryAt.get(issueId) ?? 0;
  if (Date.now() - last < TEST_VERDICT_RECOVERY_THROTTLE_MS) return;
  testVerdictRecoveryAt.set(issueId, Date.now());
  void recoverTestVerdictHostSide(issueId, setReviewStatus);
}

async function recoverTestVerdictHostSide(
  issueId: string,
  setReviewStatus: SetReviewStatusSync,
): Promise<void> {
  try {
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return;
    const { existsSync } = await import('fs');
    const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspace)) return;
    const { readTestVerdictArtifact } = await import('./cloister/test-verdict.js');
    const artifact = readTestVerdictArtifact(workspace);
    if (!artifact) return;
    setReviewStatus(issueId, {
      testStatus: artifact.status,
      testNotes: artifact.notes ?? `Recovered from .pan/test/result.json (${artifact.status}) — the test agent wrote the verdict but never signaled`,
    });
    console.log(`[review-status] recovered unsignaled test verdict for ${issueId}: ${artifact.status} (host-side, from .pan/test/result.json)`);
  } catch (err) {
    console.warn(`[review-status] host-side test verdict recovery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Reconcile a newer canonical journal verdict into the SQLite cache and re-emit the transition.
 */
export function reconcileJournalIntoCacheSync(
  issueId: string,
  dbStatus: ReviewStatus | null,
  journal: ReviewStatusJournal,
  setReviewStatus: SetReviewStatusSync,
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
    notifyPipelineSync({ type: 'status_changed', issueId, status: reconciled });
  } catch {
    // Read-only DB (a sandboxed reader) — the host reconciles when it reads. Non-fatal.
  }

  const wasBlocked = dbStatus?.reviewStatus === 'blocked' || dbStatus?.reviewStatus === 'failed';
  const nowBlocked = reconciled.reviewStatus === 'blocked' || reconciled.reviewStatus === 'failed';
  if (nowBlocked && !wasBlocked) {
    void deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
  }

  const wasReviewPassed = dbStatus?.reviewStatus === 'passed';
  const nowReviewPassed = reconciled.reviewStatus === 'passed';
  if (nowReviewPassed && !wasReviewPassed && reconciled.testStatus === 'pending') {
    console.log(`[review-status] reconcile: review.approved for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
    emitReactiveLifecycleEvent('review.approved', issueId);
  }
  const wasTestPassed = dbStatus?.testStatus === 'passed';
  const nowTestPassed = reconciled.testStatus === 'passed';
  if (nowTestPassed && !wasTestPassed) {
    console.log(`[review-status] reconcile: test.passed for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
    emitReactiveLifecycleEvent('test.passed', issueId);
  }

  maybeAutoDispatchReviewHostSide(issueId, reconciled);
  maybeRecoverTestVerdictHostSide(issueId, reconciled, setReviewStatus);
  return reconciled;
}
