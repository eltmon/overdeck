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
  clearWorkspaceStuckAndResetHistory as dbClearStuckAndResetHistory,
} from './overdeck/review-status-sync.js';
import {
  registerCanonicalReviewStatusResolver,
  registerReviewStatusMapReader,
} from './cloister/review-status-source.js';
import { normalizeReviewStatusSync } from './review-status-normalize.js';
import { updateIssueRecordForReviewStatusSync, readJournalStatusSync } from './overdeck/review-status-record-sync.js';
import { carriesNewTerminalVerdict } from './pan-dir/pipeline-verdict-merge.js';
import {
  reviewGatesPassedSync,
  verificationSatisfied, settleMergedVerification,
  type BlockerReason, type ReviewStatus, type StatusHistoryEntry,
} from './review-status-reconcile.js';
import { isReviewRequestStale, needsReviewDispatch } from './review-dispatch-decision.js';
import { REVIEW_STATUS_HISTORY_LIMIT } from './review-status-reconcile.js';
import { truncateReviewStatusNote } from './review-status-limits.js';
import { resolveJournalReconciledReviewStatusSync } from './review-status-read.js';
import { capturePipelineStageForIssue } from './telemetry/pipeline.js';
import type { ReviewStatusUpdate } from './workspace-anchor-drift.js';
import type { HeadAnchor } from './git-utils.js';
import { rejectVerdictEvidenceHeadMismatch } from './review-verdict-guards.js';
import { registerVerdictPreservationStatusReader, registerWorkStartVerdictAdapter } from './cloister/work-start-verdicts.js';

export { reviewGatesPassedSync, verificationSatisfied, MERGED_VERIFICATION_REASON } from './review-status-reconcile.js';
export type { BlockerReason, ReviewStatus, StatusHistoryEntry } from './review-status-reconcile.js';
export type { ReviewStatusUpdate } from './workspace-anchor-drift.js';

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
  status: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'verificationStatus' | 'mergeStatus' | 'retiredAt'> | null,
): MergeGateEligibility {
  if (!status) return { eligible: false, reason: 'no review record' };
  if (status.retiredAt) return { eligible: false, reason: 'retired' };
  if (status.reviewStatus !== 'passed' && status.reviewStatus !== 'skipped') {
    return { eligible: false, reason: `review is ${status.reviewStatus}` };
  }
  if (status.testStatus !== 'passed' && status.testStatus !== 'skipped') {
    return { eligible: false, reason: `test is ${status.testStatus}` };
  }
  if (!verificationSatisfied(status)) return { eligible: false, reason: 'verification failed' };
  if (status.mergeStatus === 'merged') return { eligible: false, reason: 'already merged' };
  return { eligible: true };
}
// PAN-2579: register the cycle-free status-map reader used by concurrency.ts for
// warm-idle advancing classification (see cloister/review-status-source.ts).
registerReviewStatusMapReader(() => getAllReviewStatusesFromDb());
registerCanonicalReviewStatusResolver((issueId) => getReviewStatusSync(issueId));
registerVerdictPreservationStatusReader((issueId) => { const status = getReviewStatusSync(issueId); return status ? { ...status, reviewedAtCommit: status.reviewedAtCommit as HeadAnchor | undefined } : null; });
registerWorkStartVerdictAdapter({ refreshReviewedAnchor: (issueId, anchor) => setReviewStatusSync(issueId, { reviewedAtCommit: anchor }), resetPipelineVerdicts: (issueId) => resetPipelineVerdictsForWorkStartSync(issueId) !== null });

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

export function loadReadyForMergeFlags(issueIds: string[]): Map<string, boolean> {
  const normalizedIds = [...new Set(issueIds.map((id) => id.toUpperCase()).filter(Boolean))];
  const dbStatuses = loadReviewStatusesForIssues(normalizedIds);
  const flags = new Map<string, boolean>();

  for (const issueId of normalizedIds) {
    const dbStatus = dbStatuses[issueId] ?? null;
    const journal = readJournalStatusSync(issueId);
    let status = dbStatus;

    if (journal) {
      if ((journal.durable as { closedOut?: boolean }).closedOut === true) {
        flags.set(issueId, false);
        continue;
      }

      if (!dbStatus || (dbStatus.updatedAt ?? '') < journal.updatedAt) {
        const merged: ReviewStatus = {
          ...(dbStatus ?? {
            issueId,
            reviewStatus: 'pending' as const,
            testStatus: 'pending' as const,
            updatedAt: journal.updatedAt,
            readyForMerge: false,
          }),
        };
        for (const [key, value] of Object.entries(journal.durable)) if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
        for (const key of journal.clearedFields ?? []) delete (merged as unknown as Record<string, unknown>)[key];
        merged.issueId = issueId;
        merged.updatedAt = journal.updatedAt;
        const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
        merged.readyForMerge = merged.retiredAt || hasBlockers ? false : reviewGatesPassedSync(merged);
        status = normalizeReviewStatusSync(merged);
      }
    }

    flags.set(issueId, status?.readyForMerge ?? false);
  }

  return flags;
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
  update: ReviewStatusUpdate,
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
  // the journal and silently erase the journal's feedback. A write triggered by reconciliation
  // must pass that reconciled status as `existing` so it does not recurse through this read.
  const status: ReviewStatus = existing ?? getReviewStatusSync(issueId) ?? {
    issueId,
    reviewStatus: 'pending' as const,
    testStatus: 'pending' as const,
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
  };

  if (rejectVerdictEvidenceHeadMismatch(
    issueId, status, update, () => notifyPipelineSync({ type: 'status_changed', issueId, status }),
  )) return status;

  // Guard: reject reviewStatus regression from 'passed' to 'reviewing' unless the caller
  // is explicitly resetting the merge lifecycle (update includes mergeStatus).
  // This is belt-and-suspenders — endpoint-level guards should catch this first.
  if (update.reviewStatus === 'reviewing' && status.reviewStatus === 'passed' && update.mergeStatus === undefined) {
    console.warn(`[review-status] Rejecting reviewStatus regression from 'passed' to 'reviewing' for ${issueId} (mergeStatus not being reset)`);
    notifyPipelineSync({ type: 'status_changed', issueId, status: status as ReviewStatus });
    return status as ReviewStatus;
  }

  // PAN-2578: a bare 'reviewing' write must never clobber a terminal blocked/failed verdict.
  // A review agent can finish FASTER than the dispatch path that spawned it (PAN-399: the
  // verification gate completed 2 minutes after the agent recorded BLOCKED, and the dispatch
  // route's redundant `{ reviewStatus: 'reviewing' }` write destroyed the verdict in both the
  // DB and the journal). Blocked/failed → reviewing is legal ONLY when the caller explicitly
  // starts a NEW review cycle by carrying reviewSpawnedAt (spawnReviewRoleForIssue does).
  if (
    update.reviewStatus === 'reviewing' &&
    (status.reviewStatus === 'blocked' || status.reviewStatus === 'failed') &&
    update.reviewSpawnedAt === undefined
  ) {
    console.warn(
      `[review-status] Rejecting stale 'reviewing' write for ${issueId} — a terminal ` +
      `'${status.reviewStatus}' verdict is already recorded for this review cycle. Only a ` +
      `new dispatch (carrying reviewSpawnedAt) may re-enter 'reviewing'.`
    );
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

  const freshPrIdentity =
    (update.prNumber !== undefined && update.prNumber !== status.prNumber)
    || (update.prUrl !== undefined && update.prUrl !== status.prUrl);
  const merged = settleMergedVerification({ ...status, ...update });
  if (freshPrIdentity) merged.retiredAt = undefined;

  // Terminal verdicts consume the request that spawned this review. Preserve a newer request
  // because it represents an explicit re-review requested while the current review was running.
  const terminalReviewVerdict = update.reviewStatus !== status.reviewStatus &&
    ['passed', 'blocked', 'failed', 'skipped'].includes(update.reviewStatus ?? '');
  if (terminalReviewVerdict && merged.reviewRequestedAt &&
      (!merged.reviewSpawnedAt || Date.parse(merged.reviewRequestedAt) <= new Date(merged.reviewSpawnedAt).getTime())) {
    merged.reviewRequestedAt = undefined;
  }

  // Track status transitions in history — preserve raw notes for database storage (PAN-3253)
  // rawHistory starts with the already-hydrated bounded tail and receives one new transition
  // Truncation happens at hydration time and in event payloads, not here at composition.
  const now = new Date().toISOString();
  const rawHistory = [...(status.history || [])];
  if (update.reviewStatus && update.reviewStatus !== status.reviewStatus) {
    rawHistory.push({ type: 'review', status: update.reviewStatus, timestamp: now, ...(update.reviewNotes ? { notes: update.reviewNotes } : {}) });
  }
  if (update.testStatus && update.testStatus !== status.testStatus) {
    rawHistory.push({ type: 'test', status: update.testStatus, timestamp: now, ...(update.testNotes ? { notes: update.testNotes } : {}) });
  }
  if (update.uatStatus && update.uatStatus !== status.uatStatus) {
    rawHistory.push({ type: 'uat', status: update.uatStatus, timestamp: now, ...(update.uatNotes ? { notes: update.uatNotes } : {}) });
  }
  if (update.mergeStatus && update.mergeStatus !== status.mergeStatus) {
    rawHistory.push({ type: 'merge', status: update.mergeStatus, timestamp: now });
  }
  if (update.releaseStatus && update.releaseStatus !== status.releaseStatus) {
    rawHistory.push({ type: 'release', status: update.releaseStatus, timestamp: now, ...(update.releaseNotes ? { notes: update.releaseNotes } : {}) });
  }
  // Hydration bounds raw history before it reaches event payloads.

  // readyForMerge is event-driven and derived from gate state on every
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
  // PAN-905/PAN-3365: merge blockers and failed required UAT override explicit readiness.
  const hasBlockers = Boolean(merged.retiredAt) || (merged.blockerReasons?.length ?? 0) > 0 || merged.uatStatus === 'failed';
  const readyForMerge = hasBlockers
    ? false
    : (update.readyForMerge !== undefined
        ? update.readyForMerge
        : reviewGatesPassedSync(merged));

  const boundedHistory = rawHistory.slice(-REVIEW_STATUS_HISTORY_LIMIT).map((entry) => ({
    ...entry,
    notes: entry.notes ? truncateReviewStatusNote(entry.notes) : undefined,
  }));

  const dbStatus = normalizeReviewStatusSync({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history: rawHistory,
  });

  const updated: ReviewStatus = normalizeReviewStatusSync({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history: boundedHistory,  // Return bounded (truncated) history in the event payload
  });

  // Report commit statuses to GitHub when readyForMerge transitions to true (PAN-536)
  if (readyForMerge && !status.readyForMerge && !updated.retiredAt && updated.prUrl) {
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

  // PAN-1908 + PAN-1988: the journal record is the SOURCE OF TRUTH for the verdict; the SQLite
  // row is a rebuildable cache. Write the journal FIRST. Since PAN-2541 it lives in
  // ${OVERDECK_HOME}/state/<project>/records/ — unwritable in a sandbox, so the writer falls back
  // to <workspace>/.overdeck/pipeline-verdict.json (PAN-2583). Fire-and-forget: a short-lived CLI
  // MUST drain via flushReviewStatusJournalWrites() before exit (PAN-2689). No xBRIEF mirror (PAN-1124).
  // PAN-3092: a NEW terminal verdict is the write the agent cannot cheaply retry,
  // so it gets the journal writer's backoff instead of an immediate fallback drop.
  const verdictWrite = carriesNewTerminalVerdict(status as unknown as Record<string, unknown>, update);
  updateIssueRecordForReviewStatusSync(issueId, updated, { verdictWrite });

  // The DB cache write is best-effort. A sandboxed agent's write throws SQLITE_READONLY, but
  // the verdict is already durable in the journal above, and the host reconciles the cache on
  // read (getReviewStatusSync's journal→DB reconcile). Tolerating this is what removes the
  // sandbox-escalation "smoke and mirrors" — the agent never has to break out of its jail to
  // record a verdict.
  // Write the raw (full) history to the database for archival (PAN-3253)
  try {
    dbUpsert(dbStatus);
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
    if (update.reviewStatus === 'passed') void capturePipelineStageForIssue(issueId, 'review_passed');
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
  if (updated.readyForMerge && !status.readyForMerge) {
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
  // PAN-1862 (FR-14): reviewStatus 'skipped' (review mode none) advances the
  // lifecycle exactly like an approved review — same event, same downstream.
  if (
    (update.reviewStatus === 'passed' || update.reviewStatus === 'skipped') &&
    status.reviewStatus !== 'passed' && status.reviewStatus !== 'skipped' &&
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

  // A UAT failure can enter through the REST route, specialist completion, or
  // deacon recovery. Route from this write door so every entry point reaches the
  // same feedback-target resurrection and needs-you escalation path.
  if (update.uatStatus === 'failed') {
    void deliverUatFailureToWorkAgentHostSide(issueId, updated);
  } else if (update.uatStatus) {
    void clearUatFailureAnchorHostSide(issueId);
  }

  return updated;
}

function emitReactiveLifecycleEvent(
  type: 'review.approved' | 'test.passed',
  issueId: string,
): void {
  try {
    notifyPipelineSync({ type, issueId });
  } catch (error) {
    console.warn(`[review-status] Failed to emit ${type} for ${issueId}:`, error);
  }
}

export type ReviewVerdictFeedbackDelivery = (
  issueId: string,
  status: ReviewStatus,
) => Promise<void>;

let reviewVerdictFeedbackDelivery: ReviewVerdictFeedbackDelivery | null = null;

export function registerReviewVerdictFeedbackDelivery(
  delivery: ReviewVerdictFeedbackDelivery,
): void {
  reviewVerdictFeedbackDelivery = delivery;
}

async function deliverReviewVerdictFeedbackHostSide(
  issueId: string,
  status: ReviewStatus,
): Promise<void> {
  if (!reviewVerdictFeedbackDelivery) {
    console.warn(`[review-status] review feedback delivery is not registered for ${issueId}; preserving durable feedback state for a host retry`);
    return;
  }
  try {
    await reviewVerdictFeedbackDelivery(issueId, status);
  } catch (err) {
    console.warn(`[review-status] host-side review feedback delivery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

const reviewDispatchAttemptAt = new Map<string, number>();
const staleReviewRequestClearAttemptedAt = new Map<string, number>();
const REVIEW_AUTO_DISPATCH_THROTTLE_MS = 30_000;
const STRANDED_REVIEW_SPAWN_AGE_MS = 20 * 60_000;
const STRANDED_REDISPATCH_COOLDOWN_MS = 10 * 60_000;
const strandedReviewRedispatchAt = new Map<string, number>();
let loggedMissingPipelineHandler = false;

/**
 * PAN-3674: a pending review whose dispatch already ran (reviewSpawnedAt set)
 * but produced no live reviewer sessions is stranded by a failed spawn — the
 * 2026-08-13 PAN-3668 incident sat like this for 5h while the dashboard showed
 * a benign 'Pending'. needsReviewDispatch stands down once spawnedAt covers the
 * request, so without this repair nothing ever retries.
 */
function isStrandedPendingReview(status: ReviewStatus, now = Date.now()): boolean {
  if (status.reviewStatus !== 'pending') return false;
  if (status.readyForMerge === true || status.mergeStatus === 'merged') return false;
  // Verification must have passed — a pending row with failed or absent
  // verification waits on the work agent, not on a review re-dispatch.
  if (status.verificationStatus !== 'passed' && status.verificationStatus !== 'skipped') return false;
  const spawned = status.reviewSpawnedAt;
  if (spawned === undefined || spawned === null) return false;
  const spawnedMs = typeof spawned === 'number' ? spawned : Date.parse(spawned);
  if (!Number.isFinite(spawnedMs)) return false;
  return now - spawnedMs >= STRANDED_REVIEW_SPAWN_AGE_MS;
}

/** @internal Test-only export — the stranded predicate is the safety gate for the repair. */
export function _isStrandedPendingReviewForTest(status: ReviewStatus, now?: number): boolean {
  return isStrandedPendingReview(status, now);
}

function maybeRedispatchStrandedReviewHostSide(issueId: string, status: ReviewStatus): void {
  if (!isStrandedPendingReview(status)) return;
  const last = strandedReviewRedispatchAt.get(issueId) ?? 0;
  if (Date.now() - last < STRANDED_REDISPATCH_COOLDOWN_MS) return;
  strandedReviewRedispatchAt.set(issueId, Date.now());
  void redispatchStrandedReviewHostSide(issueId, status);
}

async function redispatchStrandedReviewHostSide(issueId: string, status: ReviewStatus): Promise<void> {
  try {
    const { listSessions } = await import('./tmux.js');
    const { isReviewSessionForIssue } = await import('./cloister/specialists-registry.js');
    const sessions = await Effect.runPromise(listSessions()).catch(() => [] as readonly { name: string }[]);
    // A live reviewer session means the row — not the pipeline — is stale;
    // there is nothing to repair.
    if (sessions.some((s) => isReviewSessionForIssue(s.name, undefined, issueId))) return;
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return;
    const { existsSync } = await import('fs');
    const workspace = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspace)) return;
    const { dispatchRegisteredReviewHostSide } = await import('./cloister/durable-review-pipeline.js');
    // Dispatch-only: verification already passed at this HEAD (the predicate
    // requires it), so the full pipeline's gate re-run would be pure waste.
    const result = await dispatchRegisteredReviewHostSide({
      issueId,
      workspace,
      branch: `feature/${issueId.toLowerCase()}`,
      ...(status.prUrl ? { prUrl: status.prUrl } : {}),
    });
    if (!result) return; // No dispatcher registered (CLI process) — stay silent.
    const message = result.success
      ? `${issueId} — stranded pending review re-dispatched after a failed spawn (PAN-3674): ${result.message ?? 'ok'}`
      : `${issueId} — stranded pending review re-dispatch failed (PAN-3674): ${result.error ?? result.message ?? 'unknown'}`;
    console.log(`[review-status] ${message}`);
    emitActivityEntrySync({ source: 'review', level: result.success ? 'info' : 'warn', issueId, message });
  } catch (err) {
    console.warn(`[review-status] stranded review re-dispatch for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function maybeAutoDispatchReviewHostSide(issueId: string, status: ReviewStatus): void {
  if (!needsReviewDispatch({
    reviewRequestedAt: status.reviewRequestedAt,
    reviewSpawnedAt: status.reviewSpawnedAt,
    reviewStatus: status.reviewStatus,
    mergeStatus: status.mergeStatus,
    readyForMerge: status.readyForMerge,
  })) {
    // PAN-3674: the dispatch gate has nothing to do, but a stale spawn with no
    // live reviewers means the last dispatch died — repair it.
    maybeRedispatchStrandedReviewHostSide(issueId, status);
    if (!isReviewRequestStale({ reviewRequestedAt: status.reviewRequestedAt }) ||
        staleReviewRequestClearAttemptedAt.has(issueId)) return;
    staleReviewRequestClearAttemptedAt.set(issueId, Date.now());
    try {
      setReviewStatusSync(issueId, { reviewRequestedAt: undefined }, status);
      const message = `${issueId} — cleared stale review request older than 7 days`;
      console.warn(`[review-status] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'warn', issueId, message });
    } catch {
      // Sandboxed read-only callers cannot repair durable state; a host process will retry.
    }
    return;
  }
  const last = reviewDispatchAttemptAt.get(issueId) ?? 0;
  if (Date.now() - last < REVIEW_AUTO_DISPATCH_THROTTLE_MS) return;
  reviewDispatchAttemptAt.set(issueId, Date.now());
  void dispatchReviewHostSide(issueId, status.prUrl);
}
export async function dispatchReviewHostSide(issueId: string, prUrl?: string): Promise<void> {
  try {
    const {
      hasDurableReviewPipelineDispatch,
      startRegisteredDurableReviewPipelineHostSide,
    } = await import('./cloister/durable-review-pipeline.js');
    if (!hasDurableReviewPipelineDispatch()) {
      if (!loggedMissingPipelineHandler) {
        loggedMissingPipelineHandler = true;
        console.debug('[review-status] durable review pipeline handler is not registered; skipping host-side review auto-dispatch');
      }
      return;
    }
    const started = await startRegisteredDurableReviewPipelineHostSide({
      issueId,
      ...(prUrl ? { prUrl } : {}),
      setReviewPending: (update) => setReviewStatusSync(issueId, update),
    });
    if (!started) {
      console.log(`[review-status] durable review pipeline unavailable or already in flight for ${issueId} (host-side)`);
    }
  } catch (err) {
    console.warn(`[review-status] host-side review auto-dispatch for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

const testVerdictRecoveryAt = new Map<string, number>();
const TEST_VERDICT_RECOVERY_THROTTLE_MS = 60_000;

function maybeRecoverTestVerdictHostSide(issueId: string, status: ReviewStatus): void {
  if (status.reviewStatus !== 'passed') return;
  if (status.mergeStatus === 'merged' || status.readyForMerge) return;
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
    if (!artifact) return;
    setReviewStatusSync(issueId, {
      testStatus: artifact.status,
      testNotes: artifact.notes ??
        `Recovered from .pan/test/result.json (${artifact.status}) — the test agent wrote the verdict but never signaled`,
    });
    console.log(`[review-status] recovered unsignaled test verdict for ${issueId}: ${artifact.status} (host-side, from .pan/test/result.json)`);
  } catch (err) {
    console.warn(`[review-status] host-side test verdict recovery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function resetPipelineVerdictsForWorkStartSync(issueId: string, options: { force?: boolean } = {}): ReviewStatus | null {
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

  if (isPending && !options.force) return null;

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
    reviewRequestedAt: undefined, reviewSpawnedAt: undefined,
    conflictResolutionDispatchedAt: undefined, blockerReasons: undefined,
    retiredAt: undefined,
  });
}

async function deliverUatFailureToWorkAgentHostSide(issueId: string, status: ReviewStatus): Promise<void> {
  try {
    const { relayUatFailureFeedbackPromise } = await import('./cloister/uat-failure-feedback.js');
    await relayUatFailureFeedbackPromise({
      issueId,
      uatNotes: status.uatNotes,
      anchor: status.reviewedAtCommit,
    });
  } catch (err) {
    console.warn(`[review-status] host-side UAT-failure delivery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function clearUatFailureAnchorHostSide(issueId: string): Promise<void> {
  try {
    const { clearUatFailureFeedbackAnchor } = await import('./cloister/uat-failure-feedback.js');
    clearUatFailureFeedbackAnchor(issueId);
  } catch (err) {
    console.warn(`[review-status] host-side UAT-failure anchor clear for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deliverTestFailureToWorkAgentHostSide(issueId: string, status: ReviewStatus): Promise<void> {
  try {
    const { resolveProjectFromIssueSync } = await import('./projects.js');
    const resolved = resolveProjectFromIssueSync(issueId);
    const workspace = resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined;
    const notes = status.testNotes; let feedbackPath: string | undefined;
    try {
      const { writeFeedbackFile } = await import('./cloister/feedback-writer.js');
      const r = await Effect.runPromise(writeFeedbackFile({
        issueId, workspacePath: workspace, specialist: 'test-agent', outcome: 'failed', summary: `Tests FAILED for ${issueId}`,
        markdownBody: `# Test failure\n\n${notes ?? 'The test gate reported failures. See .pan/test/result.json and re-run the project test suite.'}\n\n## Required\nFix the failing tests, commit and push, then re-run \`pan done ${issueId}\`.`,
      }));
      if (r.success) feedbackPath = r.filePath;
    } catch { /* non-fatal — the message below still carries the summary */ }

    const message = `SPECIALIST FEEDBACK: test-agent reported FAILED for ${issueId}.\n\n${feedbackPath ? `MUST READ: ${feedbackPath}\n\n` : ''}${notes ? `${notes.slice(0, 400)}\n\n` : ''}Fix the failing tests, commit and push, then re-run pan done ${issueId}. Do NOT stop at the prompt.`;
    const { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } = await import('./cloister/feedback-target.js');
    const target = await resolveIssueFeedbackTarget(issueId);
    if ('agentId' in target) {
      const { messageAgent } = await import('./agents.js');
      await messageAgent(target.agentId, message, 'internal', { owesRework: true });
      console.log(`[review-status] delivered test failure to ${target.agentId} for ${issueId} (host-side)`);
    } else {
      await surfaceIssueFeedbackNeedsYou(issueId, target.reason, { specialist: 'test-agent', feedbackPath });
    }
  } catch (err) {
    console.warn(`[review-status] host-side test-failure delivery for ${issueId} did not complete (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function resolveReviewStatusSync(issueId: string, dbStatus: ReviewStatus | null | undefined): ReviewStatus | null {
  return resolveJournalReconciledReviewStatusSync(issueId, dbStatus, {
    deleteStatus: dbDelete,
    notifyStatusChanged: (id, status) => notifyPipelineSync({ type: 'status_changed', issueId: id, status }),
    deliverReviewVerdictFeedbackHostSide,
    emitReactiveLifecycleEvent,
    maybeAutoDispatchReviewHostSide,
    maybeRecoverTestVerdictHostSide,
  });
}

export function getReviewStatusSync(issueId: string): ReviewStatus | null {
  return resolveReviewStatusSync(issueId, getReviewStatusFromDbSync(issueId));
}

export function getReviewStatusesSync(issueIds: string[]): Record<string, ReviewStatus> {
  const ids = [...new Set(issueIds.map((issueId) => issueId.trim().toUpperCase()).filter(Boolean))];
  const dbStatuses = getReviewStatusesFromDb(ids);
  return Object.fromEntries(ids.flatMap((id) => {
    const status = resolveReviewStatusSync(id, dbStatuses[id]);
    return status ? [[id, status]] : [];
  }));
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
 * Restore merge eligibility after a restart only when every gate passes and
 * canonical pipeline membership confirms that the issue still has an open PR.
 */
export async function fixStuckReadyForMerge(
  gatherEligibility?: typeof import('./cloister/merge-eligibility.js').gatherMergeEligibility,
): Promise<void> {
  const statuses = loadReviewStatuses();
  const stuck = Object.values(statuses).filter(s =>
    !s.retiredAt &&
    s.readyForMerge === false &&
    s.reviewStatus === 'passed' &&
    (s.testStatus === 'passed' || s.testStatus === 'skipped') &&
    verificationSatisfied(s) &&
    // Failed and merged attempts are terminal; only pending/queued rows are repairable.
    (s.mergeStatus === 'pending' || s.mergeStatus === 'queued' || s.mergeStatus === undefined || s.mergeStatus === null) &&
    (s.uatStatus === undefined || s.uatStatus === 'passed')
  );
  if (stuck.length === 0) return;
  const mergeEligibility = await import('./cloister/merge-eligibility.js');
  const memberships = await (gatherEligibility ?? mergeEligibility.gatherMergeEligibility)(stuck.map((status) => status.issueId));
  console.log(`[review-status] Restoring readyForMerge for ${stuck.length} issue(s) with passed review+test`);
  for (const s of stuck) {
    const membership = memberships.get(s.issueId.toUpperCase());
    if (!membership || !mergeEligibility.isMergeEligible(membership)) {
      if (membership) setReviewStatusSync(s.issueId, { readyForMerge: false, retiredAt: new Date().toISOString() });
      console.log(`[review-status] skipping ${s.issueId} — pipeline membership is ${membership?.bucket ?? 'unavailable'}, not merge-eligible`);
      continue;
    }
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
  // Terminal lifecycle owns removal of the UAT feedback dedup entry. The relay
  // stays dynamically imported to preserve the Node ESM boot graph.
  void clearUatFailureAnchorHostSide(issueId);
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

/** PAN-3151: clear stuck and reset review cycle history when unsticking from review-not-converging. */
export function clearWorkspaceStuckAndResetHistory(issueId: string): void {
  try {
    dbClearStuckAndResetHistory(issueId);
    console.log(`[review-status] Cleared stuck state and reset cycle history for ${issueId}`);
    const updated = getReviewStatusSync(issueId);
    if (updated) notifyPipelineSync({ type: 'status_changed', issueId, status: updated });
  } catch (err) {
    console.error(`[review-status] Failed to clear stuck state for ${issueId}:`, err);
  }
}

/** Stuck reason recorded when specialist feedback could not reach a live agent (feedback-target.ts). */
export const FEEDBACK_DELIVERY_STUCK_REASON = 'feedback_delivery_needs_you';

/**
 * PAN-3074: clear a feedback-delivery stuck flag once the condition it recorded
 * no longer holds — the feedback reached a live agent, or the agent completed
 * the fix-and-resubmit loop (`pan review request`). Any other stuck reason is
 * operator territory and stays put.
 */
export function clearFeedbackDeliveryStuck(issueId: string): void {
  const status = getReviewStatusSync(issueId);
  if (status?.stuck !== true || status.stuckReason !== FEEDBACK_DELIVERY_STUCK_REASON) return;
  clearWorkspaceStuck(issueId);
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
  update: ReviewStatusUpdate,
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
