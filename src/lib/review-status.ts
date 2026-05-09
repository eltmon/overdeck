import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { notifyPipeline } from './pipeline-notifier.js';
import { emitActivityEntry, emitActivityTts } from './activity-logger.js';
import {
  upsertReviewStatus as dbUpsert,
  deleteReviewStatus as dbDelete,
  getReviewStatusFromDb,
  getAllReviewStatusesFromDb,
  markWorkspaceStuck as dbMarkStuck,
  clearWorkspaceStuck as dbClearStuck,
  setDeaconIgnored as dbSetDeaconIgnored,
  upsertReviewStatusAsync as dbUpsertAsync,
  getReviewStatusFromDbAsync,
} from './database/review-status-db.js';
import { normalizeReviewStatus } from './review-status-normalize.js';

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
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  inspectNotes?: string;
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
  /** Commits at time of review request — used to detect new commits after review */
  lastReviewCommits?: { ahead: number; behind: number; branch: string; commits: string[] };
  /** Active canonical review-temp stash for the current review cycle. */
  reviewTempStashRef?: string;
  reviewTempStashMessage?: string;
  reviewTempStashSequence?: number;
}

function verificationSatisfied(status: Pick<ReviewStatus, 'verificationStatus'>): boolean {
  // Only block readyForMerge if verification explicitly FAILED.
  // 'pending' means "scheduled but not yet run this cycle" — not a failure signal.
  // request-review resets verificationStatus to 'pending' as part of its cycle reset,
  // but subsequent review+test passing should still yield readyForMerge=true.
  // The post-rebase gate in triggerMerge() is the authoritative quality gate (PAN-XXX).
  return status.verificationStatus !== 'failed';
}

const DEFAULT_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

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

export function setReviewStatus(
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
): ReviewStatus {
  // Read only the single row we're updating (avoids TOCTOU: bulk read-modify-write
  // races when two concurrent calls for different issue IDs run concurrently).
  // If `existing` is provided (e.g. from mutateBlockers), skip the DB read to
  // avoid double-read on the webhook ingestion path (PAN-905).
  const status: ReviewStatus = existing ?? getReviewStatusFromDb(issueId) ?? {
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
    notifyPipeline({ type: 'status_changed', issueId, status: status as ReviewStatus });
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

  // readyForMerge is true when all required gates pass.
  // If uatStatus exists (UAT specialist has been involved), it must also be 'passed'.
  // NOTE: we intentionally do NOT check verificationStatus here. Verification can fail
  // on pre-existing test breakage or environment issues, but the test specialist's pass
  // is the authoritative signal. The post-rebase gate in triggerMerge() is the real
  // quality check. Blocking readyForMerge on a stale verificationStatus causes issues
  // to get stuck after tests pass (PAN-714).
  // PAN-905: GitHub-native blockers (failing checks, merge conflicts, etc.) always
  // override readyForMerge to false, even if the caller explicitly passed true.
  const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
  const readyForMerge = hasBlockers
    ? false
    : (update.readyForMerge !== undefined
        ? update.readyForMerge
        : (
            merged.reviewStatus === 'passed' &&
            merged.testStatus === 'passed' &&
            merged.mergeStatus !== 'merged' &&
            // Don't auto-recompute rfm=true when the previous merge attempt failed —
            // cycling: check-status gate → mergeStatus=failed → deacon restore → rfm=true → retry.
            // checkFailedMergeRetry() handles transient retries explicitly with readyForMerge: true.
            merged.mergeStatus !== 'failed' &&
            // If UAT has been initiated, it must pass too
            (merged.uatStatus === undefined || merged.uatStatus === 'passed')
          ));

  const updated: ReviewStatus = normalizeReviewStatus({
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
          await reportCommitStatus(owner, repo, sha, 'success', 'panopticon/review', 'Review passed');
          await reportCommitStatus(owner, repo, sha, 'success', 'panopticon/test', 'Tests passed');
          console.log(`[review-status] Reported commit statuses for ${issueId} (${sha.slice(0, 8)})`);
        }
      } catch (err: any) {
        console.warn(`[review-status] Failed to report commit status: ${err.message}`);
      }
    })();
  }

  // Single-row upsert — atomic, no TOCTOU risk.
  dbUpsert(updated);

  notifyPipeline({ type: 'status_changed', issueId, status: updated });

  // Emit activity log entries for meaningful pipeline state transitions.
  // Each transition produces one entry so the ActivityPanel shows live pipeline progress.
  if (update.verificationStatus && update.verificationStatus !== status.verificationStatus) {
    const vMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string }> = {
      running:  { level: 'info',    msg: `${issueId} — verification running`, tts: `${issueId} verification running` },
      passed:   { level: 'success', msg: `${issueId} — verification passed`, tts: `${issueId} verification passed` },
      failed:   { level: 'error',   msg: `${issueId} — verification failed`, tts: `${issueId} verification failed` },
      skipped:  { level: 'info',    msg: `${issueId} — verification skipped` },
    };
    const entry = vMap[update.verificationStatus];
    if (entry) emitActivityEntry({ source: 'cloister', level: entry.level, message: entry.msg, details: update.verificationNotes, issueId });
    if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: entry.level === 'error' ? 0 : 1, issueId });
  }
  if (update.reviewStatus && update.reviewStatus !== status.reviewStatus) {
    let reviewMsg = `${issueId} — review started`;
    if (update.reviewStatus === 'reviewing') {
      const retryCount = updated.reviewRetryCount ?? 0;
      reviewMsg = retryCount > 0
        ? `${issueId} — review re-dispatched (retry ${retryCount})`
        : `${issueId} — review started (4 parallel reviewers)`;
    }
    const rMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string }> = {
      reviewing: { level: 'info',    msg: reviewMsg, tts: `${issueId} review started` },
      passed:    { level: 'success', msg: `${issueId} — review passed`, tts: `${issueId} review passed` },
      failed:    { level: 'error',   msg: `${issueId} — review failed`, tts: `${issueId} review failed` },
      blocked:   { level: 'warn',    msg: `${issueId} — review blocked (changes requested)`, tts: `${issueId} review blocked` },
    };
    const entry = rMap[update.reviewStatus];
    if (entry) emitActivityEntry({ source: 'review-specialist', level: entry.level, message: entry.msg, details: update.reviewNotes, issueId });
    if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: entry.level === 'error' ? 0 : 1, issueId });
  }
  if (update.testStatus && update.testStatus !== status.testStatus) {
    const tMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string }> = {
      testing:         { level: 'info',    msg: `${issueId} — tests running` },
      passed:          { level: 'success', msg: `${issueId} — tests passed`, tts: `${issueId} tests passed` },
      failed:          { level: 'error',   msg: `${issueId} — tests failed`, tts: `${issueId} tests failed` },
      skipped:         { level: 'info',    msg: `${issueId} — tests skipped` },
      dispatch_failed: { level: 'warn',    msg: `${issueId} — test dispatch failed` },
    };
    const entry = tMap[update.testStatus];
    if (entry) emitActivityEntry({ source: 'test-specialist', level: entry.level, message: entry.msg, details: update.testNotes, issueId });
    if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: entry.level === 'error' ? 0 : 1, issueId });
  }
  if (update.mergeStatus && update.mergeStatus !== status.mergeStatus) {
    const mMap: Record<string, { level: 'info' | 'warn' | 'error' | 'success'; msg: string; tts?: string }> = {
      queued:    { level: 'info',    msg: `${issueId} — queued for merge` },
      merging:   { level: 'info',    msg: `${issueId} — merge in progress` },
      verifying: { level: 'info',    msg: `${issueId} — post-merge verification` },
      merged:    { level: 'success', msg: `${issueId} — merged`, tts: `${issueId} merged to main` },
      failed:    { level: 'error',   msg: `${issueId} — merge failed`, tts: `${issueId} merge failed` },
    };
    const entry = mMap[update.mergeStatus];
    if (entry) emitActivityEntry({ source: 'merge-agent', level: entry.level, message: entry.msg, details: update.mergeNotes, issueId });
    if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: entry.level === 'error' ? 0 : 1, issueId });
  }
  if (update.readyForMerge === true && !status.readyForMerge) {
    emitActivityEntry({ source: 'cloister', level: 'success', message: `${issueId} — ready for merge`, issueId });
    emitActivityTts({ utterance: `${issueId} ready for merge`, priority: 1, issueId });
  }

  // Dispatch test-agent when review transitions to 'passed'.
  // This fires regardless of how setReviewStatus() is called (API or direct import),
  // ensuring test-agent is dispatched even when review-agent bypasses the specialist
  // dispatch endpoint.
  //
  // OPTIMIZATION: If reviewedAtCommit matches lastVerifiedCommit, no code changed
  // between the pre-review verification gate and review completion (review is
  // read-only). Skip the redundant test-agent and mark tests as passed directly.
  // The post-rebase verification in triggerMerge() is the real quality gate.
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
      console.log(`[review-status] Skipping test-agent for ${issueId} — no code drift since verification (HEAD=${updated.reviewedAtCommit!.slice(0, 8)})`);
      emitActivityEntry({ source: 'cloister', level: 'info', message: `${issueId} — tests skipped (no code change since verification gate)`, issueId });
      setReviewStatus(issueId, { testStatus: 'passed', testNotes: 'Skipped: no code changed since pre-review verification gate', readyForMerge: true });
    } else {
      (async () => {
        try {
          const { spawnEphemeralSpecialist } = await import('./cloister/specialists.js');
          const { resolveProjectFromIssue } = await import('./projects.js');
          const workAgentId = `agent-${issueId.toLowerCase()}`;
          const workStateFile = join(homedir(), '.panopticon', 'agents', workAgentId, 'state.json');
          let workspace: string | undefined;
          let branch: string | undefined;
          try {
            await access(workStateFile);
            const workState = JSON.parse(await readFile(workStateFile, 'utf-8'));
            workspace = workState.workspace;
            branch = workState.branch || `feature/${issueId.toLowerCase()}`;
          } catch {}

          const resolved = resolveProjectFromIssue(issueId);
          if (!resolved) {
            console.warn(`[review-status] No project configured for ${issueId} — cannot dispatch test-agent`);
            setReviewStatus(issueId, { testStatus: 'dispatch_failed', testNotes: `No project configured for ${issueId}` });
            return;
          }
          const reason = updated.reviewedAtCommit && updated.lastVerifiedCommit
            ? `code drift detected (verified=${updated.lastVerifiedCommit.slice(0, 8)}, reviewed=${updated.reviewedAtCommit.slice(0, 8)})`
            : 'no verification snapshot available';
          console.log(`[review-status] Dispatching test-agent for ${issueId} — ${reason}`);
          const result = await spawnEphemeralSpecialist(resolved.projectKey, 'test-agent', {
            issueId,
            workspace,
            branch,
          });
          if (result.success) {
            setReviewStatus(issueId, { testStatus: 'testing' });
            emitActivityEntry({ source: 'cloister', level: 'info', message: `${issueId} — test-agent dispatched (${reason})`, issueId });
          } else {
            console.warn(`[review-status] Failed to dispatch test-agent for ${issueId}: ${result.message}`);
            setReviewStatus(issueId, { testStatus: 'dispatch_failed', testNotes: `Dispatch failed: ${result.message}` });
          }
        } catch (err: any) {
          console.warn(`[review-status] Failed to dispatch test-agent for ${issueId}: ${err.message}`);
        }
      })();
    }
  }

  return updated;
}

export function getReviewStatus(issueId: string): ReviewStatus | null {
  return getReviewStatusFromDb(issueId) ?? null;
}

export async function setReviewStatusAsync(
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
): Promise<ReviewStatus> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(setReviewStatus(issueId, update, existing));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function getReviewStatusAsync(issueId: string): Promise<ReviewStatus | null> {
  return getReviewStatusFromDbAsync(issueId);
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
    setReviewStatus(s.issueId, {
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
    setReviewStatus(s.issueId, { readyForMerge: true });
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
    setReviewStatus(issueId, { reviewStatus: 'passed' });
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
export function markWorkspaceStuck(
  issueId: string,
  reason: string,
  details?: Record<string, unknown>,
): void {
  try {
    dbMarkStuck(issueId, reason, details);
    console.log(`[review-status] Marked ${issueId} as stuck: ${reason}`);
    const updated = getReviewStatus(issueId);
    if (updated) notifyPipeline({ type: 'status_changed', issueId, status: updated });
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
    const updated = getReviewStatus(issueId);
    if (updated) notifyPipeline({ type: 'status_changed', issueId, status: updated });
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
    dbSetDeaconIgnored(issueId, ignored, reason);
    console.log(`[review-status] deaconIgnored=${ignored} for ${issueId}${reason ? ` (${reason})` : ''}`);
    const updated = getReviewStatus(issueId);
    if (updated) notifyPipeline({ type: 'status_changed', issueId, status: updated });
  } catch (err) {
    console.error(`[review-status] Failed to set deaconIgnored for ${issueId}:`, err);
  }
}
