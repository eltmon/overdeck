import { join } from 'path';
import { homedir } from 'os';
import { Data, Effect } from 'effect';
import { notifyPipelineSync } from './pipeline-notifier.js';
import { emitActivityEntrySync, emitActivityTtsSync } from './activity-logger.js';
import {
  upsertReviewStatusSync as dbUpsert,
  deleteReviewStatus as dbDelete,
  getReviewStatusFromDbSync,
  getAllReviewStatusesFromDb,
  getReviewStatusesFromDb,
  markWorkspaceStuck as dbMarkStuck,
  clearWorkspaceStuck as dbClearStuck,
} from './overdeck/review-status-sync.js';
import { normalizeReviewStatusSync } from './review-status-normalize.js';
import { updateIssueRecordForReviewStatusSync, enrichReviewNotesFromRecordSync, readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import { needsReviewDispatch } from './review-dispatch-decision.js';
import type { ScopeDriftRecord } from './vbrief/continue-state.js';

function emitReactiveLifecycleEvent(type: 'review.approved' | 'test.passed', issueId: string): void {
  try {
    notifyPipelineSync({ type, issueId });
  } catch (error) {
    console.warn(`[review-status] Failed to emit ${type} for ${issueId}:`, error);
  }
}

export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge' | 'inspect' | 'uat';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface BlockerReason {
  type: 'failing_checks' | 'merge_conflict' | 'unresolved_conversations' | 'changes_requested' | 'draft_pr' | 'not_mergeable';
  summary: string;
  details?: string;
  detectedAt: string;
}

export interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed' | 'error';
  inspectNotes?: string;
  inspectStartedAt?: string;
  inspectBeadId?: string;
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  uatNotes?: string;
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  mergeNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  /**
   * PAN-1691: per-issue merge-train routing key.
   * `undefined` = follow the project default; `true` = auto-merge (fast lane,
   * rides the train and ships when green); `false` = hold for UAT (manual lane,
   * waits for human batch review). The merge-train engine reads this to decide
   * whether a ready issue auto-advances or is held for the UAT candidate.
   */
  autoMerge?: boolean;
  autoRequeueCount?: number;
  mergeRetryCount?: number;
  prUrl?: string;
  /** PAN-905: HEAD commit SHA of the tracked PR for webhook identity validation */
  prHeadSha?: string;
  /** PAN-905: GitHub PR number of the tracked PR for webhook identity validation */
  prNumber?: number;
  history?: StatusHistoryEntry[];
  /** PAN-905: GitHub-native merge blocker reasons */
  blockerReasons?: BlockerReason[];
  /** HEAD commit SHA at the time review passed — used to detect new commits after review */
  reviewedAtCommit?: string;
  /** HEAD commit SHA at the time the pre-review verification gate passed — used to skip redundant test-agent */
  lastVerifiedCommit?: string;
  /** Current merge pipeline step for granular merge progress tracking */
  mergeStep?: string;
  /** PAN-653: workspace is stuck (e.g. main diverged mid-approve) — Deacon skips it */
  stuck?: boolean;
  /** PAN-653: reason workspace is stuck (e.g. 'main_diverged') */
  stuckReason?: string;
  /** PAN-653: ISO timestamp when workspace was marked stuck */
  stuckAt?: string;
  /** PAN-653: JSON details about the stuck event (e.g. {localSha, remoteSha}) */
  stuckDetails?: string;
  /** PAN-699: timestamp when review agents were dispatched (deacon timeout detection) */
  reviewSpawnedAt?: string;
  /**
   * PAN-1988 auto-heal: durable JOURNAL intent set by `pan done` BEFORE it reaches the dashboard.
   * "The work agent finished and wants review." When this is newer than {@link reviewSpawnedAt}
   * and nothing is reviewing, the host reconciles on read and dispatches review — surviving a
   * dashboard reload, a dropped event, or a frozen deacon. Journal-only (not a DB column).
   */
  reviewRequestedAt?: string;
  /** PAN-1765: timestamp when a conflict-resolution work agent was dispatched. */
  conflictResolutionDispatchedAt?: string;
  /** PAN-699: number of test-agent dispatch retries (circuit breaker) */
  testRetryCount?: number;
  /** PAN-794: number of consecutive parallel-review re-dispatch attempts within the current cycle */
  reviewRetryCount?: number;
  /** PAN-794: ISO timestamp when deacon began the current recovery cycle — acts as the history cutoff for the breaker */
  recoveryStartedAt?: string;
  /** Human-requested ignore flag: when true, Deacon patrol skips this issue entirely (distinct from `stuck`, which is a system-set failure marker). */
  deaconIgnored?: boolean;
  /** ISO timestamp when the ignore flag was set. */
  deaconIgnoredAt?: string;
  /** Optional free-form reason shown alongside the ignore toggle. */
  deaconIgnoredReason?: string;
  /** PAN-1762: advisory files_scope drift recorded at pan done and surfaced to review. */
  scopeDrift?: ScopeDriftRecord;
  // PAN-1531: reviewTempStashRef / reviewTempStashMessage / reviewTempStashSequence
  // removed. The review pipeline no longer stashes uncommitted work — the
  // dirty-worktree gate refuses pan done / pan review request before review
  // is dispatched.
}

export function verificationSatisfied(status: Pick<ReviewStatus, 'verificationStatus'>): boolean {
  // Only block readyForMerge if verification explicitly FAILED.
  // 'pending' means "scheduled but not yet run this cycle" — not a failure signal.
  // request-review resets verificationStatus to 'pending' as part of its cycle reset,
  // but subsequent review+test passing should still yield readyForMerge=true.
  // The post-rebase gate in triggerMerge() is the authoritative quality gate (PAN-XXX).
  return status.verificationStatus !== 'failed';
}

/**
 * PAN-1988: the merge-gate predicate (review passed, test passed/skipped, verification not
 * failed, UAT ok, merge not started). Extracted so both setReviewStatusSync and the
 * journal→DB reconcile in getReviewStatusSync derive readyForMerge identically.
 */
export function reviewGatesPassedSync(
  s: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'verificationStatus' | 'uatStatus' | 'mergeStatus'>,
): boolean {
  return (
    s.reviewStatus === 'passed' &&
    (s.testStatus === 'passed' || s.testStatus === 'skipped') &&
    verificationSatisfied(s) &&
    (s.uatStatus === undefined || s.uatStatus === 'passed') &&
    (s.mergeStatus === 'pending' ||
      s.mergeStatus === 'queued' ||
      s.mergeStatus === undefined ||
      s.mergeStatus === null)
  );
}

export interface MergeGateEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Authoritative "allowed to merge" predicate (PAN-1759). The flywheel
 * orchestrator's pipeline verb says it INTENDS to merge an issue; this record
 * says the pipeline ALLOWS it. Both must hold before an issue enters the merge
 * queue or a UAT batch — RUN-20 tagged a mid-review issue with a merge verb
 * and it rode into a promotable batch. Same criteria as the
 * fixStuckReadyForMerge repair sweep: review passed, test passed/skipped,
 * verification not failed, not already merged.
 */
export function mergeGateEligibility(
  status: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'verificationStatus' | 'mergeStatus'> | null,
): MergeGateEligibility {
  if (!status) return { eligible: false, reason: 'no review record' };
  if (status.reviewStatus !== 'passed') return { eligible: false, reason: `review is ${status.reviewStatus}` };
  if (status.testStatus !== 'passed' && status.testStatus !== 'skipped') {
    return { eligible: false, reason: `test is ${status.testStatus}` };
  }
  if (!verificationSatisfied(status)) return { eligible: false, reason: 'verification failed' };
  if (status.mergeStatus === 'merged') return { eligible: false, reason: 'already merged' };
  return { eligible: true };
}
const DEFAULT_STATUS_FILE = join(homedir(), '.overdeck', 'review-status.json');

export function loadReviewStatuses(filePath = DEFAULT_STATUS_FILE): Record<string, ReviewStatus> {
  // SQLite is the authoritative store for the default (server) path.
  // Non-default JSON paths have been moved to review-status-json.ts so that
  // dashboard-reachable code never imports sync FS operations.
  if (filePath !== DEFAULT_STATUS_FILE) {
    throw new Error(
      `Non-default review-status paths are not supported in review-status.ts. ` +
      `Import from review-status-json.ts for JSON file operations.`
    );
  }
  return getAllReviewStatusesFromDb();
}

export function loadReviewStatusesForIssues(issueIds: string[]): Record<string, ReviewStatus> {
  return getReviewStatusesFromDb(issueIds);
}

export function saveReviewStatuses(statuses: Record<string, ReviewStatus>, filePath = DEFAULT_STATUS_FILE): void {
  // SQLite is the authoritative store for the default (server) path.
  // Mirrors the old JSON overwrite semantics: upsert every entry in the map and
  // delete any SQLite rows whose keys are absent from the map (replace-all).
  if (filePath !== DEFAULT_STATUS_FILE) {
    throw new Error(
      `Non-default review-status paths are not supported in review-status.ts. ` +
      `Import from review-status-json.ts for JSON file operations.`
    );
  }
  const incoming = new Set(Object.keys(statuses));
  const existing = getAllReviewStatusesFromDb();
  for (const id of Object.keys(existing)) {
    if (!incoming.has(id)) {
      dbDelete(id);
    }
  }
  for (const status of Object.values(statuses)) {
    dbUpsert(status);
  }
}

export function setReviewStatusSync(
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
): ReviewStatus {
  // Guard: bare numeric IDs (no alphabetic prefix) must never reach the DB.
  // They would create orphaned rows that pollute pending lists and metrics.
  if (/^\d+$/.test(issueId)) {
    console.warn(
      `[review-status] Rejecting setReviewStatus for bare numeric ID "${issueId}" — ` +
      `issue IDs must include a project prefix (e.g. PAN-${issueId}).`
    );
    return {
      issueId,
      reviewStatus: 'pending' as const,
      testStatus: 'pending' as const,
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    };
  }

  issueId = issueId.toUpperCase();

  // Read only the single row we're updating (avoids TOCTOU: bulk read-modify-write
  // races when two concurrent calls for different issue IDs run concurrently).
  // If `existing` is provided (e.g. from mutateBlockers), skip the read to
  // avoid double-read on the webhook ingestion path (PAN-905).
  // PAN-1988: the merge base goes through getReviewStatusSync (journal-reconciled +
  // notes-enriched), NOT the raw DB read. Otherwise a partial update (e.g. a testStatus
  // change carrying no review notes) would merge against a DB row whose notes/flags lag
  // the journal and silently erase the journal's feedback. The reconcile inside
  // getReviewStatusSync never re-enters setReviewStatusSync, so there is no recursion.
  const status: ReviewStatus = existing ?? getReviewStatusSync(issueId) ?? {
    issueId,
    reviewStatus: 'pending' as const,
    testStatus: 'pending' as const,
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
  };

  // Guard: reject reviewStatus regression from 'passed' to 'reviewing' unless the caller
  // is explicitly resetting the merge lifecycle (update includes mergeStatus).
  // This is belt-and-suspenders — endpoint-level guards should catch this first.
  if (update.reviewStatus === 'reviewing' && status.reviewStatus === 'passed' && update.mergeStatus === undefined) {
    console.warn(`[review-status] Rejecting reviewStatus regression from 'passed' to 'reviewing' for ${issueId} (mergeStatus not being reset)`);
    notifyPipelineSync({ type: 'status_changed', issueId, status: status as ReviewStatus });
    return status as ReviewStatus;
  }

  // PAN-424: Reject testStatus regression from 'passed' to 'dispatch_failed' or 'failed'.
  // Once tests pass, duplicate dispatch failures must not overwrite the result.
  if (
    (update.testStatus === 'dispatch_failed' || update.testStatus === 'failed') &&
    status.testStatus === 'passed'
  ) {
    console.warn(`[review-status] Rejecting testStatus regression from 'passed' to '${update.testStatus}' for ${issueId}`);
    delete update.testStatus;
    delete update.testNotes;
  }

  const merged = { ...status, ...update };

  // Track status transitions in history (last 10 entries)
  const history = [...(status.history || [])];
  const now = new Date().toISOString();
  if (update.reviewStatus && update.reviewStatus !== status.reviewStatus) {
    history.push({ type: 'review', status: update.reviewStatus, timestamp: now, notes: update.reviewNotes });
  }
  if (update.testStatus && update.testStatus !== status.testStatus) {
    history.push({ type: 'test', status: update.testStatus, timestamp: now, notes: update.testNotes });
  }
  if (update.uatStatus && update.uatStatus !== status.uatStatus) {
    history.push({ type: 'uat', status: update.uatStatus, timestamp: now, notes: update.uatNotes });
  }
  if (update.mergeStatus && update.mergeStatus !== status.mergeStatus) {
    history.push({ type: 'merge', status: update.mergeStatus, timestamp: now });
  }
  while (history.length > 10) history.shift();

  // PAN-1650: readyForMerge is EVENT-DRIVEN — derived from the gate state on every
  // write, so it flips the instant review+test+verification pass instead of waiting
  // for a deacon patrol or a startup `fixStuckReadyForMerge` reconcile (those become
  // redundant safety nets). This supersedes the PAN-1048 explicit-only model.
  //
  // Deriving from gates here does NOT bypass the "rebased onto main + verified"
  // guarantee: `triggerMerge()` performs the authoritative post-rebase quality gate
  // before it actually merges (see verificationSatisfied's note). The gate predicate
  // mirrors `fixStuckReadyForMerge` so behaviour is identical — just immediate.
  //
  // Explicit caller intent still wins (the merge flow sets readyForMerge=false when a
  // merge starts; mergeStatus then leaves pending/queued so the derive agrees).
  // PAN-905: GitHub-native blockers always override readyForMerge to false.
  const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
  const readyForMerge = hasBlockers
    ? false
    : (update.readyForMerge !== undefined
        ? update.readyForMerge
        : reviewGatesPassedSync(merged));

  const updated: ReviewStatus = normalizeReviewStatusSync({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history,
  });

  // Report commit statuses to GitHub when readyForMerge transitions to true (PAN-536)
  if (readyForMerge && !status.readyForMerge && updated.prUrl) {
    (async () => {
      try {
        const { isGitHubAppConfigured, reportCommitStatus } = await import('./github-app.js');
        if (!isGitHubAppConfigured()) return;
        const prMatch = updated.prUrl!.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
        if (!prMatch) return;
        const [, owner, repo] = prMatch;
        // Get HEAD SHA of the PR branch
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `gh pr view ${updated.prUrl!.match(/\/pull\/(\d+)/)?.[1]} --json headRefOid --jq .headRefOid`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const sha = stdout.trim();
        if (sha) {
          // overdeck/review is honest here — review just transitioned to readyForMerge.
          // The overdeck/tests status is posted separately at the actual test-completion
          // site (verification-runner success, test-agent POST in workspaces routes) so it
          // accurately reflects which commit was tested.
          await reportCommitStatus(owner, repo, sha, 'success', 'overdeck/review', 'Review passed');
          console.log(`[review-status] Reported overdeck/review for ${issueId} (${sha.slice(0, 8)})`);
        }
      } catch (err: any) {
        console.warn(`[review-status] Failed to report commit status: ${err.message}`);
      }
    })();
  }

  // PAN-1908 + PAN-1988: the journal record is the SOURCE OF TRUTH for the verdict; the
  // SQLite row is a rebuildable cache. Write the journal FIRST — it is workspace-local
  // (<workspace>/.pan/records/<issue>.json), so it succeeds even for a sandboxed agent
  // (codex workspace-write) that cannot reach ~/.overdeck. Fire-and-forget; queueAutoCommit
  // debounces bursts into one commit. Do NOT mirror into canonical vBRIEF specs (PAN-1124).
  updateIssueRecordForReviewStatusSync(issueId, updated);

  // The DB cache write is best-effort. A sandboxed agent's write throws SQLITE_READONLY, but
  // the verdict is already durable in the journal above, and the host reconciles the cache on
  // read (getReviewStatusSync's journal→DB reconcile). Tolerating this is what removes the
  // sandbox-escalation "smoke and mirrors" — the agent never has to break out of its jail to
  // record a verdict.
  try {
    dbUpsert(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[review-status] DB cache write skipped for ${issueId} (${msg}); journal holds the verdict, host will reconcile on read.`);
  }

  notifyPipelineSync({ type: 'status_changed', issueId, status: updated });

  // Emit activity log entries for meaningful pipeline state transitions.
  // Each transition produces one entry so the ActivityPanel shows live pipeline progress.
  if (update.verificationStatus && update.verificationStatus !== status.verificationStatus) {
    const vMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string; ttsPriority?: number }> = {
      running:  { level: 'info',    msg: `${issueId} — verification running`, tts: `${issueId} verification running` },
      passed:   { level: 'success', msg: `${issueId} — verification passed`, tts: `${issueId} verification passed` },
      failed:   { level: 'error',   msg: `${issueId} — verification failed`, tts: `${issueId} verification failed` },
      skipped:  { level: 'info',    msg: `${issueId} — verification skipped`, tts: `${issueId} verification skipped`, ttsPriority: 2 },
    };
    const entry = vMap[update.verificationStatus];
    if (entry) emitActivityEntrySync({ source: 'cloister', level: entry.level, message: entry.msg, details: update.verificationNotes, issueId });
    if (entry?.tts) emitActivityTtsSync({
      utterance: entry.tts,
      priority: entry.ttsPriority ?? (entry.level === 'error' ? 0 : 1),
      issueId,
      source: 'cloister',
      eventType: `verificationStatus.${update.verificationStatus}`,
    });
  }
  if (update.reviewStatus && update.reviewStatus !== status.reviewStatus) {
    let reviewMsg = `${issueId} — review started`;
    if (update.reviewStatus === 'reviewing') {
      const retryCount = updated.reviewRetryCount ?? 0;
      reviewMsg = retryCount > 0
        ? `${issueId} — review re-dispatched (retry ${retryCount})`
        : `${issueId} — review started`;
    }
    const rMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string }> = {
      reviewing: { level: 'info',    msg: reviewMsg, tts: `${issueId} review started` },
      passed:    { level: 'success', msg: `${issueId} — review passed`, tts: `${issueId} review passed` },
      failed:    { level: 'error',   msg: `${issueId} — review failed`, tts: `${issueId} review failed` },
      blocked:   { level: 'warn',    msg: `${issueId} — review blocked (changes requested)`, tts: `${issueId} review blocked` },
    };
    const entry = rMap[update.reviewStatus];
    if (entry) emitActivityEntrySync({ source: 'review', level: entry.level, message: entry.msg, details: update.reviewNotes, issueId });
    if (entry?.tts) emitActivityTtsSync({
      utterance: entry.tts,
      priority: entry.level === 'error' ? 0 : 1,
      issueId,
      source: 'review-specialist',
      eventType: `reviewStatus.${update.reviewStatus}`,
    });
  }
  if (update.testStatus && update.testStatus !== status.testStatus) {
    const tMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string; ttsPriority?: number }> = {
      testing:         { level: 'info',    msg: `${issueId} — tests running`, tts: `${issueId} tests running`, ttsPriority: 2 },
      passed:          { level: 'success', msg: `${issueId} — tests passed`, tts: `${issueId} tests passed` },
      failed:          { level: 'error',   msg: `${issueId} — tests failed`, tts: `${issueId} tests failed` },
      skipped:         { level: 'info',    msg: `${issueId} — tests skipped`, tts: `${issueId} tests skipped`, ttsPriority: 2 },
      dispatch_failed: { level: 'warn',    msg: `${issueId} — test dispatch failed`, tts: `${issueId} test dispatch failed`, ttsPriority: 1 },
    };
    const entry = tMap[update.testStatus];
    if (entry) emitActivityEntrySync({ source: 'test', level: entry.level, message: entry.msg, details: update.testNotes, issueId });
    if (entry?.tts) emitActivityTtsSync({
      utterance: entry.tts,
      priority: entry.ttsPriority ?? (entry.level === 'error' ? 0 : 1),
      issueId,
      source: 'test-specialist',
      eventType: `testStatus.${update.testStatus}`,
    });
  }
  if (update.mergeStatus && update.mergeStatus !== status.mergeStatus) {
    const mMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string; ttsPriority?: number }> = {
      queued:    { level: 'info',    msg: `${issueId} — queued for merge`, tts: `${issueId} queued for merge`, ttsPriority: 2 },
      merging:   { level: 'info',    msg: `${issueId} — merge in progress`, tts: `${issueId} merge in progress`, ttsPriority: 2 },
      verifying: { level: 'info',    msg: `${issueId} — post-merge verification`, tts: `${issueId} post-merge verification running`, ttsPriority: 2 },
      merged:    { level: 'success', msg: `${issueId} — merged`, tts: `${issueId} merged to main` },
      failed:    { level: 'error',   msg: `${issueId} — merge failed`, tts: `${issueId} merge failed` },
    };
    const entry = mMap[update.mergeStatus];
    if (entry) emitActivityEntrySync({ source: 'ship', level: entry.level, message: entry.msg, details: update.mergeNotes, issueId });
    if (entry?.tts) emitActivityTtsSync({
      utterance: entry.tts,
      priority: entry.ttsPriority ?? (entry.level === 'error' ? 0 : 1),
      issueId,
      source: 'merge-agent',
      eventType: `mergeStatus.${update.mergeStatus}`,
    });
  }
  if (update.readyForMerge === true && !status.readyForMerge) {
    emitActivityEntrySync({ source: 'cloister', level: 'success', message: `${issueId} — ready for merge`, issueId });
    emitActivityTtsSync({
      utterance: `${issueId} ready for merge`,
      priority: 1,
      issueId,
      source: 'cloister',
      eventType: 'readyForMerge',
    });
  }

  // Reactive Cloister owns review→test and test→ship scheduling. setReviewStatus
  // emits the lifecycle event here so API and direct-import callers share one path.
  if (
    update.reviewStatus === 'passed' &&
    status.reviewStatus !== 'passed' &&
    updated.testStatus === 'pending'
  ) {
    const canSkipTests =
      updated.reviewedAtCommit &&
      updated.lastVerifiedCommit &&
      updated.reviewedAtCommit === updated.lastVerifiedCommit;

    if (canSkipTests) {
      console.log(`[review-status] Skipping test role for ${issueId} — no code drift since verification (HEAD=${updated.reviewedAtCommit!.slice(0, 8)})`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message: `${issueId} — tests skipped (no code change since verification gate)`, issueId });
      setReviewStatusSync(issueId, {
        testStatus: 'passed',
        testNotes: 'Skipped: no code changed since pre-review verification gate',
        verificationStatus: 'passed',
        verificationNotes: 'Pre-review verification already covered the reviewed commit',
      });
      void emitReactiveLifecycleEvent('test.passed', issueId);
    } else {
      void emitReactiveLifecycleEvent('review.approved', issueId);
    }
  }

  if (update.testStatus === 'passed' && status.testStatus !== 'passed') {
    void emitReactiveLifecycleEvent('test.passed', issueId);
  }

  // PAN-1988: test FAILED → hand it straight back to the work agent (host-side). The dead-end
  // requeue that does this is deacon-only, so without this a failure strands until the (possibly
  // frozen) deacon nudges. Fires once per transition into failed — both the agent's direct POST and
  // the host's .pan/test/result.json recovery flow through this same transition.
  if (
    (update.testStatus === 'failed' || update.testStatus === 'dispatch_failed') &&
    status.testStatus !== 'failed' && status.testStatus !== 'dispatch_failed'
  ) {
    void deliverTestFailureToWorkAgentHostSide(issueId, updated);
  }

  return updated;
}

export function resetPipelineVerdictsForWorkStartSync(issueId: string): ReviewStatus | null {
  const status = getReviewStatusSync(issueId);
  if (!status) return null;

  const isPending =
    status.reviewStatus === 'pending' &&
    status.testStatus === 'pending' &&
    (status.mergeStatus === undefined || status.mergeStatus === 'pending') &&
    (status.verificationStatus === undefined || status.verificationStatus === 'pending') &&
    !status.readyForMerge &&
    status.autoRequeueCount === 0 &&
    status.verificationCycleCount === 0 &&
    status.reviewRetryCount === 0 &&
    status.testRetryCount === 0 &&
    status.mergeRetryCount === 0 &&
    status.recoveryStartedAt === undefined &&
    status.reviewedAtCommit === undefined &&
    status.lastVerifiedCommit === undefined;

  if (isPending) return null;

  return setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: undefined,
    testNotes: undefined,
    mergeNotes: undefined,
    readyForMerge: false,
    autoRequeueCount: 0,
    verificationStatus: 'pending',
    verificationNotes: undefined,
    verificationCycleCount: 0,
    stuck: false,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    reviewRetryCount: 0,
    testRetryCount: 0,
    mergeRetryCount: 0,
    recoveryStartedAt: undefined,
    reviewedAtCommit: undefined,
    lastVerifiedCommit: undefined,
  });
}

/**
 * PAN-1988 — deliver review feedback to the work agent from the HOST when a blocked/failed
 * verdict is reconciled from the journal. Dynamic import to avoid a static import cycle
 * (review-verdict-feedback → review-status). Fully best-effort: in a sandboxed agent process the
 * delivery fails (host paths blocked) and is swallowed; the host process performs the real
 * notification. Never throws into the read path.
 */
async function deliverReviewVerdictFeedbackHostSide(issueId: string, status: ReviewStatus): Promise<void> {
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

// PAN-1988 auto-heal — throttle so the reconcile-on-read does not spam dispatch attempts for a
// genuinely-gated issue (one whose dispatch keeps deferring on a merge conflict). Date.now() is
// available in normal lib code (only workflow scripts forbid it).
const reviewDispatchAttemptAt = new Map<string, number>();
const REVIEW_AUTO_DISPATCH_THROTTLE_MS = 30_000;

/**
 * PAN-1988 auto-heal — the host re-dispatches review from the durable journal intent. When the
 * work agent's `pan done` recorded a `reviewRequestedAt` but the reactive dashboard trigger never
 * landed (dashboard reloading, dropped event, frozen deacon), the next status read notices the
 * un-serviced request and dispatches review here. {@link needsReviewDispatch} gates it,
 * spawnReviewRoleForIssue is idempotent (it skips a live review), and a 30s throttle bounds retries
 * for a gated issue. Fire-and-forget; in a sandboxed reader the dispatch is a best-effort no-op.
 */
function maybeAutoDispatchReviewHostSide(issueId: string, status: ReviewStatus): void {
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
      console.log(`[review-status] auto-dispatched review for ${issueId} from durable journal intent (host-side)`);
    }
  } catch (err) {
    console.warn(`[review-status] host-side review auto-dispatch for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── PAN-1988 host-owned TEST-stage recovery ───────────────────────────────────
// The test stage had NO reactive path. Recovering an unsignaled verdict (the agent — often Haiku —
// writes .pan/test/result.json then idles without POSTing) AND the test=failed → work-agent requeue
// both lived ONLY in deacon patrols (checkCompletedButUnsignaledTests + the dead-end requeue). With
// the deacon frozen, a finished test agent stranded the issue at test=testing forever. The host now
// (a) recovers the written verdict on read and (b) hands a failure back to the work agent — symmetric
// with the review stage. Recovery only acts on a WRITTEN artifact; it never guesses pass/fail.
const testVerdictRecoveryAt = new Map<string, number>();
const TEST_VERDICT_RECOVERY_THROTTLE_MS = 60_000;

function maybeRecoverTestVerdictHostSide(issueId: string, status: ReviewStatus): void {
  if (status.reviewStatus !== 'passed') return; // tests only run after review approves
  if (status.mergeStatus === 'merged' || status.readyForMerge) return;
  // Only act while the verdict is UNSIGNALED — once test resolves (passed/failed) the write path
  // owns the transition (test.passed → ship; test failed → deliverTestFailureToWorkAgentHostSide).
  if (status.testStatus !== 'testing' && status.testStatus !== 'pending' && status.testStatus !== 'dispatch_failed') return;
  const last = testVerdictRecoveryAt.get(issueId) ?? 0;
  if (Date.now() - last < TEST_VERDICT_RECOVERY_THROTTLE_MS) return;
  testVerdictRecoveryAt.set(issueId, Date.now());
  void recoverTestVerdictHostSide(issueId);
}

async function recoverTestVerdictHostSide(issueId: string): Promise<void> {
  try {
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return;
    const { existsSync } = await import('fs');
    const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspace)) return;
    const { readTestVerdictArtifact } = await import('./cloister/test-verdict.js');
    const artifact = readTestVerdictArtifact(workspace);
    if (!artifact) return; // no WRITTEN verdict — never guess; the agent/deacon owns the write-nudge
    // Record the recovered verdict. setReviewStatusSync emits test.passed (→ ship) for a pass and
    // fires the work-agent handoff (below) on a fail, via its test-transition logic.
    setReviewStatusSync(issueId, {
      testStatus: artifact.status,
      testNotes: artifact.notes ?? `Recovered from .pan/test/result.json (${artifact.status}) — the test agent wrote the verdict but never signaled`,
    });
    console.log(`[review-status] recovered unsignaled test verdict for ${issueId}: ${artifact.status} (host-side, from .pan/test/result.json)`);
  } catch (err) {
    console.warn(`[review-status] host-side test verdict recovery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deliverTestFailureToWorkAgentHostSide(issueId: string, status: ReviewStatus): Promise<void> {
  try {
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    const workspace = resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined;
    const notes = status.testNotes;
    let feedbackPath: string | undefined;
    try {
      const { writeFeedbackFile } = await import('./cloister/feedback-writer.js');
      const r = await Effect.runPromise(writeFeedbackFile({
        issueId,
        workspacePath: workspace,
        specialist: 'test-agent',
        outcome: 'failed',
        summary: `Tests FAILED for ${issueId}`,
        markdownBody: `# Test failure\n\n${notes ?? 'The test gate reported failures. See .pan/test/result.json and re-run the project test suite.'}\n\n## Required\nFix the failing tests, commit and push, then re-run \`pan done ${issueId}\`.`,
      }));
      if (r.success) feedbackPath = r.filePath;
    } catch { /* non-fatal — the message below still carries the summary */ }

    const message = `SPECIALIST FEEDBACK: test-agent reported FAILED for ${issueId}.\n\n${feedbackPath ? `MUST READ: ${feedbackPath}\n\n` : ''}${notes ? `${notes.slice(0, 400)}\n\n` : ''}Fix the failing tests, commit and push, then re-run pan done ${issueId}. Do NOT stop at the prompt.`;
    const { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } = await import('./cloister/feedback-target.js');
    const target = await resolveIssueFeedbackTarget(issueId);
    if ('agentId' in target) {
      const { messageAgent } = await import('./agents.js');
      await messageAgent(target.agentId, message);
      console.log(`[review-status] delivered test failure to ${target.agentId} for ${issueId} (host-side)`);
    } else {
      surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
        specialist: 'test-agent',
        feedbackPath,
      });
    }
  } catch (err) {
    console.warn(`[review-status] host-side test-failure delivery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getReviewStatusSync(issueId: string): ReviewStatus | null {
  const dbStatus = getReviewStatusFromDbSync(issueId);
  const journal = readJournalStatusSync(issueId);

  // No journal record → the DB is all we have. (Pre-PAN-1908 issues, or issues whose
  // workspace/record hasn't been created yet.)
  if (!journal) return dbStatus ?? null;

  if ((journal.durable as { closedOut?: boolean }).closedOut === true) {
    // PAN-2054: closed-out journal records are terminal; stale active DB rows are cache residue.
    try {
      dbDelete(issueId);
    } catch {
      // Read-only DB (a sandboxed reader) — the host clears residue when it reads. Non-fatal.
    }
    return null;
  }

  // PAN-1988 — journal is the source of truth; DB is a rebuildable cache. If the journal is
  // NEWER than the DB row, an agent recorded its verdict to the journal but the DB write
  // lagged or was blocked (a sandboxed agent that can't write ~/.overdeck). Reconcile the
  // cache from the journal. Whatever process reads next performs this; the host (non-sandboxed)
  // write succeeds, a sandboxed reader's reconcile is a best-effort no-op.
  const journalNewer = !dbStatus || (dbStatus.updatedAt ?? '') < journal.updatedAt;
  if (journalNewer) {
    const merged: ReviewStatus = {
      ...(dbStatus ?? {
        issueId,
        reviewStatus: 'pending' as const,
        testStatus: 'pending' as const,
        updatedAt: journal.updatedAt,
        readyForMerge: false,
      }),
    };
    // Apply ONLY the journal fields that are actually present. The journal carries the durable
    // verdict; DB-only/ephemeral fields it does not store (stuck/stuckReason, transient counters)
    // must NOT be clobbered with `undefined`. This keeps every reconcile a strict overlay.
    for (const [key, value] of Object.entries(journal.durable)) {
      if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
    }
    merged.issueId = issueId;
    merged.updatedAt = journal.updatedAt;
    const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
    merged.readyForMerge = hasBlockers ? false : reviewGatesPassedSync(merged);
    const reconciled = normalizeReviewStatusSync(merged);
    try {
      dbUpsert(reconciled);
    } catch {
      // Read-only DB (a sandboxed reader) — the host reconciles when it reads. Non-fatal.
    }

    // PAN-1988 — host-owned review FEEDBACK delivery. A sandboxed review agent records its
    // verdict to the journal but cannot notify the work agent (the work agent's tmux/mail and
    // the network are outside its jail — "side effects failed due restricted network / readonly
    // host paths"). When the HOST reconciles a NEW blocked/failed review verdict, it delivers the
    // feedback here. Fires exactly once per verdict: the reconcile only runs while the journal is
    // newer than the DB, and the dbUpsert above makes the DB catch up, so the next read does not
    // re-fire. In a sandboxed agent process the delivery is a best-effort no-op (host paths
    // blocked); the host's read performs the real delivery. Fire-and-forget.
    const wasBlocked = dbStatus?.reviewStatus === 'blocked' || dbStatus?.reviewStatus === 'failed';
    const nowBlocked = reconciled.reviewStatus === 'blocked' || reconciled.reviewStatus === 'failed';
    if (nowBlocked && !wasBlocked) {
      void deliverReviewVerdictFeedbackHostSide(issueId, reconciled);
    }

    // PAN-1988 — host-owned review→test and test→ship HANDOFF. setReviewStatusSync emits these
    // lifecycle events on the write path, but a sandboxed agent (codex/pi) records its verdict to
    // the JOURNAL only and the host picks it up HERE via reconcile — which bypasses
    // setReviewStatusSync. Without re-emitting, a passed verdict strands at review=passed/test=pending
    // (and a passed test strands before ship) until the deacon patrol nudges it — and the deacon may
    // be frozen. Re-emit the same transitions the write path would, so reactive Cloister advances.
    const wasReviewPassed = dbStatus?.reviewStatus === 'passed';
    const nowReviewPassed = reconciled.reviewStatus === 'passed';
    if (nowReviewPassed && !wasReviewPassed && reconciled.testStatus === 'pending') {
      console.log(`[review-status] reconcile: review.approved for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
      void emitReactiveLifecycleEvent('review.approved', issueId);
    }
    const wasTestPassed = dbStatus?.testStatus === 'passed';
    const nowTestPassed = reconciled.testStatus === 'passed';
    if (nowTestPassed && !wasTestPassed) {
      console.log(`[review-status] reconcile: test.passed for ${issueId} (host-owned handoff — sandboxed agent verdict from journal)`);
      void emitReactiveLifecycleEvent('test.passed', issueId);
    }

    maybeAutoDispatchReviewHostSide(issueId, reconciled);
    maybeRecoverTestVerdictHostSide(issueId, reconciled);
    return reconciled;
  }

  // DB is current → overlay the feedback TEXT from the journal (it is no longer stored in the
  // DB; the row holds only the queryable status flags).
  const enriched = enrichReviewNotesFromRecordSync(issueId, dbStatus!);
  maybeAutoDispatchReviewHostSide(issueId, enriched);
  maybeRecoverTestVerdictHostSide(issueId, enriched);
  return enriched;
}

/**
 * On server startup, clear any mergeStatus stuck at 'merging'.
 * Pending merge operations are in-memory only — they don't survive a restart.
 * Any 'merging' status after boot is definitionally stuck (PAN-490).
 */
export function clearStuckMergeStatuses(): void {
  const statuses = loadReviewStatuses();
  // Don't clear 'queued' — the SQLite merge queue handles that (PAN-632).
  // Only clear truly stuck transient states.
  const stuck = Object.values(statuses).filter(s =>
    s.mergeStatus === 'merging' || s.mergeStatus === 'verifying'
  );
  if (stuck.length === 0) return;
  console.log(`[review-status] Clearing ${stuck.length} stuck merge status(es) on startup (merging/verifying)`);
  for (const s of stuck) {
    // Reset to pending so MERGE button reappears — the in-memory queue was lost on restart.
    // Preserve readyForMerge if review+test both passed — the merge just needs to be retried.
    const shouldBeReady =
      s.reviewStatus === 'passed' &&
      (s.testStatus === 'passed' || s.testStatus === 'skipped') &&
      verificationSatisfied(s) &&
      (s.uatStatus === undefined || s.uatStatus === 'passed');
    setReviewStatusSync(s.issueId, {
      mergeStatus: 'pending',
      ...(shouldBeReady ? { readyForMerge: true } : {}),
    });
  }
}

/**
 * On server startup, fix any issues where review+test both passed and
 * verificationStatus is not 'failed', but readyForMerge is stuck at false.
 *
 * This happens when:
 * 1. A merge attempt was made (merging → verifying)
 * 2. The server restarted while verifying — clearStuckMergeStatuses reset mergeStatus to 'pending'
 * 3. At restart time, verificationStatus was 'pending' (reset by the request-review cycle)
 * 4. The old verificationSatisfied check blocked readyForMerge because of 'pending' status
 *
 * With verificationSatisfied now only blocking on 'failed', these issues should be
 * re-evaluated and readyForMerge restored so they reappear on the Awaiting Merge page.
 */
export function fixStuckReadyForMerge(): void {
  const statuses = loadReviewStatuses();
  const stuck = Object.values(statuses).filter(s =>
    s.readyForMerge === false &&
    s.reviewStatus === 'passed' &&
    (s.testStatus === 'passed' || s.testStatus === 'skipped') &&
    verificationSatisfied(s) &&
    // Only fix 'pending'/'queued' merge states — not 'failed' ones.
    // 'failed' means the merge actually attempted and broke; those need human review,
    // not automatic restoration. 'merged' is done. Only pending/queued are stuck-but-valid.
    (s.mergeStatus === 'pending' || s.mergeStatus === 'queued' || s.mergeStatus === undefined || s.mergeStatus === null) &&
    (s.uatStatus === undefined || s.uatStatus === 'passed')
  );
  if (stuck.length === 0) return;
  console.log(`[review-status] Restoring readyForMerge for ${stuck.length} issue(s) with passed review+test`);
  for (const s of stuck) {
    console.log(`[review-status] Restoring readyForMerge=true for ${s.issueId} (verif=${s.verificationStatus}, merge=${s.mergeStatus})`);
    setReviewStatusSync(s.issueId, { readyForMerge: true });
  }
}

/**
 * PAN-869: On server startup, fix any issues where reviewStatus was incorrectly
 * set to 'failed' due to the old COMMENTED → 'failed' mapping bug.
 *
 * This identifies records where:
 * - reviewStatus = 'failed'
 * - testStatus = 'passed' (CI green, so review wasn't genuinely bad)
 * - mergeStatus is not terminal ('merged', 'failed')
 * - readyForMerge = false
 * - The last review history entry is type='review', status='failed'
 *
 * The old reviewResultToReviewStatus() mapped COMMENTED (regardless of success)
 * to 'failed', so the history stores 'failed' for old COMMENTED reviews.
 * We use testStatus='passed' as the signal that this was a successful review
 * (CI was green), distinguishing it from genuinely failed reviews.
 */
export function fixStuckCommentedReviews(): void {
  const statuses = loadReviewStatuses();
  const candidates = Object.values(statuses).filter(s =>
    s.reviewStatus === 'failed' &&
    (s.testStatus === 'passed' || s.testStatus === 'skipped') &&
    s.mergeStatus !== 'merged' &&
    s.mergeStatus !== 'failed' &&
    s.readyForMerge === false &&
    s.verificationStatus !== 'failed'
  );

  if (candidates.length === 0) return;

  const toFix: string[] = [];
  for (const s of candidates) {
    // Check if the last review history entry is 'failed' (the old COMMENTED mapping
    // stored 'failed' in history). testStatus='passed' signals CI was green,
    // so this was a successful review incorrectly stored as 'failed'.
    const lastReviewEntry = [...(s.history || [])]
      .reverse()
      .find(h => h.type === 'review');
    if (lastReviewEntry?.status === 'failed') {
      toFix.push(s.issueId);
    }
  }

  if (toFix.length === 0) return;
  console.log(`[review-status] Restoring reviewStatus='passed' for ${toFix.length} issue(s) with COMMENTED reviews (PAN-869 backfill)`);
  for (const issueId of toFix) {
    console.log(`[review-status] Restoring reviewStatus='passed' for ${issueId}`);
    // reviewStatus='passed' will trigger readyForMerge recomputation in setReviewStatus
    setReviewStatusSync(issueId, { reviewStatus: 'passed' });
  }
}

export function clearReviewStatus(issueId: string): void {
  try {
    dbDelete(issueId);
  } catch (err) {
    console.error('[review-status] SQLite delete failed:', err);
  }
}

// ============== Stuck state helpers (PAN-653) ==============

/**
 * Mark a workspace as stuck with a reason and optional JSON details.
 * Persists across dashboard restarts. Deacon will skip stuck workspaces.
 *
 * @param issueId - Issue ID (e.g. "PAN-653")
 * @param reason  - Short reason code (e.g. "main_diverged")
 * @param details - Optional structured details (e.g. {localSha, remoteSha})
 */
// PAN-1988: `stuck` is EPHEMERAL runtime state (set when patrol detects a wedged workspace),
// NOT a durable verdict — projectPipeline deliberately does not journal it, and it is rebuilt
// from runtime on a cache rebuild. So markWorkspaceStuck/clearWorkspaceStuck write the DB cache
// directly and do not go through the journal door. The getReviewStatusSync journal→DB reconcile
// preserves it (a strict overlay that never clobbers DB-only fields the journal doesn't carry).
export function markWorkspaceStuck(
  issueId: string,
  reason: string,
  details?: Record<string, unknown>,
): void {
  try {
    dbMarkStuck(issueId, reason, details);
    console.log(`[review-status] Marked ${issueId} as stuck: ${reason}`);
    const updated = getReviewStatusSync(issueId);
    if (updated) notifyPipelineSync({ type: 'status_changed', issueId, status: updated });
  } catch (err) {
    console.error(`[review-status] Failed to mark ${issueId} as stuck:`, err);
  }
}

/**
 * Clear the stuck flag for a workspace.
 * Called when the human clicks "Unstick" in the dashboard.
 * Re-enables Deacon patrol for this workspace.
 */
export function clearWorkspaceStuck(issueId: string): void {
  try {
    dbClearStuck(issueId);
    console.log(`[review-status] Cleared stuck state for ${issueId}`);
    const updated = getReviewStatusSync(issueId);
    if (updated) notifyPipelineSync({ type: 'status_changed', issueId, status: updated });
  } catch (err) {
    console.error(`[review-status] Failed to clear stuck state for ${issueId}:`, err);
  }
}

/**
 * Set or clear the operator-requested deacon-ignore flag. When set, Deacon
 * patrol skips the issue entirely on every cycle. Distinct from `stuck`, which
 * is a system-set failure marker that also suppresses patrol.
 */
export function setDeaconIgnored(
  issueId: string,
  ignored: boolean,
  reason?: string,
): void {
  try {
    // PAN-1988: route through the single write door. deaconIgnored is a DURABLE field that
    // projectPipeline journals — a DB-only write (the old dbSetDeaconIgnored) lands in the
    // cache but not the journal, so it vanishes on a cache rebuild. setReviewStatusSync writes
    // both (and emits the status_changed event), keeping DB and journal in sync.
    setReviewStatusSync(issueId, {
      deaconIgnored: ignored,
      deaconIgnoredAt: ignored ? new Date().toISOString() : undefined,
      deaconIgnoredReason: ignored ? reason : undefined,
    });
    console.log(`[review-status] deaconIgnored=${ignored} for ${issueId}${reason ? ` (${reason})` : ''}`);
  } catch (err) {
    console.error(`[review-status] Failed to set deaconIgnored for ${issueId}:`, err);
  }
}

/**
 * PAN-1691: set the per-issue auto-merge routing key and broadcast the change.
 * `autoMerge === null` clears it back to the project default. Emits a
 * status_changed pipeline event so open dashboards reflect the toggle live.
 */
export function setAutoMerge(issueId: string, autoMerge: boolean | null): void {
  try {
    // PAN-1988: route through the single write door. autoMerge is a DURABLE field journaled by
    // projectPipeline; a DB-only write would be lost on cache rebuild. `null` clears it back to
    // the project default (stored as undefined). setReviewStatusSync writes DB + journal and
    // emits the status_changed event.
    setReviewStatusSync(issueId, { autoMerge: autoMerge === null ? undefined : autoMerge });
    console.log(`[review-status] autoMerge=${autoMerge === null ? 'default' : autoMerge} for ${issueId}`);
  } catch (err) {
    console.error(`[review-status] Failed to set autoMerge for ${issueId}:`, err);
  }
}

/** Tagged error for review-status Effect variants. */
export class ReviewStatusError extends Data.TaggedError('ReviewStatusError')<{
  readonly issueId: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const setReviewStatus = (
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
): Effect.Effect<ReviewStatus, ReviewStatusError> =>
  Effect.tryPromise({
    try: () => new Promise<ReviewStatus>((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(setReviewStatusSync(issueId, update, existing));
        } catch (err) {
          reject(err);
        }
      });
    }),
    catch: (cause) =>
      new ReviewStatusError({
        issueId,
        operation: 'setReviewStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const getReviewStatus = (
  issueId: string,
): Effect.Effect<ReviewStatus | null, ReviewStatusError> =>
  Effect.try({
    try: () => getReviewStatusFromDbSync(issueId),
    catch: (cause) =>
      new ReviewStatusError({
        issueId,
        operation: 'getReviewStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
