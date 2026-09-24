import { emitActivityTts } from '../../../lib/activity-logger.js';
import {
  listDuePendingAutoMerges,
  markBlocked,
  markFailed,
  markMerged,
  markMergeRetriesExhausted,
  requeueToPending,
  transitionToMerging,
  type PendingAutoMerge,
} from '../../../lib/overdeck/merge-sync.js';
import { isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import { isMergeTrainEnabled } from '../../../lib/overdeck/control-settings.js';
import { evaluateIssueMergeGate } from '../../../lib/cloister/merge-gate.js';
import type { MergeReadiness, PrFacts } from '../../../lib/cloister/pr-facts.js';

export const AUTO_MERGE_EXECUTOR_INTERVAL_MS = 30_000;

/**
 * Consecutive retryable merge failures before the circuit breaker trips.
 * PAN-3917: was `FAILED_MERGE_MAX_RETRIES` in the deleted `cloister/deacon-merge.ts`.
 */
export const FAILED_MERGE_MAX_RETRIES = 3;

/**
 * Retries consumed by the current executor process, per issue.
 *
 * This is the state of a retry loop this process is running, not a fact about
 * the issue — the forge cannot answer "how many times have we tried". It used
 * to live on the review-status record as `mergeRetryCount`; keeping it in
 * memory means a restart starts the budget over, which is the correct behavior
 * for a circuit breaker whose whole purpose is to stop a hot loop.
 */
const mergeRetryCounts = new Map<string, number>();

function readMergeRetryCount(issueId: string): number {
  return mergeRetryCounts.get(issueId.toUpperCase()) ?? 0;
}

function writeMergeRetryCount(issueId: string, count: number): void {
  mergeRetryCounts.set(issueId.toUpperCase(), count);
}

/** Test seam: forget every retry budget. */
export function _resetMergeRetryCountsForTests(): void {
  mergeRetryCounts.clear();
}

interface MergeResult {
  success: boolean;
  error?: string;
  message?: string;
  statusCode?: number;
  outcome?: string;
  retryable?: boolean;
  deferred?: boolean;
}

export interface AutoMergeExecutorDeps {
  now?: () => Date;
  listEntries?: () => PendingAutoMerge[];
  /** The merge train must be on for auto-merge to act. */
  isPaused?: () => boolean;
  isEligible?: (issueId: string) => Promise<AutoMergeEligibility>;
  /** The one merge gate (#4040); `evaluateIssueMergeGate` by default. */
  mergeGate?: (issueId: string) => Promise<MergeReadiness & { facts: Pick<PrFacts, 'headSha'> }>;
  hasPendingDeploy?: () => Promise<boolean>;
  transition?: (id: number) => boolean;
  markBlocked?: (id: number, reason: string) => boolean;
  markMergeRetriesExhausted?: (id: number, reason: string) => boolean;
  markMerged?: (id: number) => boolean;
  markFailed?: (id: number, reason: string) => boolean;
  requeueToPending?: (id: number, nextScheduledMergeAt: string) => boolean;
  mergeIssue?: (issueId: string, headSha?: string) => Promise<MergeResult>;
  /**
   * #3983: the tracker's live answer for the issue; null when no tracker
   * answered. `readIssueFromTracker` by default.
   */
  readTrackerIssue?: (issueId: string) => Promise<{ open: boolean } | null>;
  /** The cached tracker row, consulted when the live read gets no answer. */
  cachedTrackerIssue?: (issueId: string) => Promise<{ open: boolean } | null> | { open: boolean } | null;
  getMergeRetryCount?: (issueId: string) => number;
  setMergeRetryCount?: (issueId: string, count: number) => void;
  announceFailure?: (issueId: string, reason: string) => void;
  log?: (message: string) => void;
}

const REQUEUE_BACKOFF_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

/** True when two SHAs (full or abbreviated) name the same commit. */
function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

async function defaultReadTrackerIssue(issueId: string): Promise<{ open: boolean } | null> {
  const { readIssueFromTracker } = await import('./derived-issue-state.js');
  return readIssueFromTracker(issueId);
}

async function defaultCachedTrackerIssue(issueId: string): Promise<{ open: boolean } | null> {
  try {
    const { getSharedIssueService } = await import('./issue-service-singleton.js');
    return getSharedIssueService().getTrackerIssue(issueId);
  } catch {
    return null;
  }
}

/** True when the tracker (live, else cached) says the issue is closed. */
async function trackerIssueClosed(
  issueId: string,
  deps: AutoMergeExecutorDeps,
  log: (message: string) => void,
): Promise<boolean> {
  let live: { open: boolean } | null = null;
  try {
    live = await (deps.readTrackerIssue ?? defaultReadTrackerIssue)(issueId);
  } catch (error) {
    log(`[auto-merge] live tracker read for ${issueId} failed: ${errorMessage(error)}`);
  }
  if (live) return !live.open;
  return (await (deps.cachedTrackerIssue ?? defaultCachedTrackerIssue)(issueId))?.open === false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function failureReason(result: MergeResult): string {
  return result.error ?? result.message ?? `merge returned status ${result.statusCode ?? 'unknown'}`;
}

async function defaultMergeIssue(issueId: string, headSha?: string): Promise<MergeResult> {
  const { triggerMerge } = await import('../routes/workspaces/merge-ops.js');
  // #3983: pin the merge to the head this row was scheduled for.
  return triggerMerge(issueId, headSha ? { kind: 'normal', expectedHeadSha: headSha } : { kind: 'normal' });
}

function defaultAnnounceFailure(issueId: string, reason: string): void {
  emitActivityTts({
    utterance: `${issueId} auto-merge failed: ${reason}`,
    priority: 1,
    issueId,
    source: 'dashboard',
    eventType: 'auto-merge-failed',
  });
}

export async function tickAutoMergeExecutor(deps: AutoMergeExecutorDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const nowDate = now();
  const entries = deps.listEntries
    ? deps.listEntries()
      .filter((entry) => entry.status === 'pending' && Date.parse(entry.scheduledMergeAt) <= nowDate.getTime())
      .sort((a, b) => a.scheduledMergeAt.localeCompare(b.scheduledMergeAt) || a.id - b.id)
    : listDuePendingAutoMerges(nowDate.toISOString());

  if (entries.length === 0) return;

  const isPaused = deps.isPaused ?? (() => !isMergeTrainEnabled());
  const log = deps.log ?? console.log;
  if (isPaused()) {
    log('[auto-merge] merge train disabled, skipping tick');
    return;
  }
  // PAN-3917 D1: there is no deploy queue to defer to — the post-merge deploy
  // patrol and its pending-deploy file are gone.
  if (deps.hasPendingDeploy && await deps.hasPendingDeploy()) {
    log(`[auto-merge] deploy in progress, deferring ${entries.length} merge(s) before preparation`);
    return;
  }

  for (const entry of entries) {
    if (isPaused()) {
      log('[auto-merge] merge train disabled, skipping tick');
      return;
    }

    const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(entry.issueId);
    if (!eligibility.eligible) {
      if (!(deps.markBlocked ?? markBlocked)(entry.id, eligibility.reason)) {
        log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
      }
      continue;
    }

    // FR-9/D3: the merge gate is the forge — approvals (a forge review or a
    // trusted verdict marker), green checks, and mergeability (#4040, #3983).
    // Re-read on every tick, because a push or a failing check between
    // scheduling and the cooldown expiring must stop the merge.
    const gate = await (deps.mergeGate ?? ((id: string) => evaluateIssueMergeGate(id, {}, { requireApprovalAtHead: true })))(entry.issueId);
    // #3983: the cooldown covered the head that was scheduled. A new head gets
    // its own cooldown: blocking this row lets the scheduler re-arm it.
    const liveHead = gate.facts.headSha;
    const headMoved = Boolean(entry.headSha && liveHead && !sameCommit(entry.headSha, liveHead));
    if (!gate.ready || headMoved) {
      const reason = headMoved
        ? `${entry.issueId} PR head moved from ${entry.headSha!.slice(0, 12)} to ${liveHead!.slice(0, 12)} since the auto-merge was scheduled`
        : `${entry.issueId} is not ready to merge: ${gate.reason ?? 'the merge gate refused it'}`;
      if (!(deps.markBlocked ?? markBlocked)(entry.id, reason)) {
        log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
      }
      continue;
    }

    // #3983: the merge gate never reads the tracker. A closed issue is not
    // merged: ask the tracker itself, falling back to the cached row.
    if (await trackerIssueClosed(entry.issueId, deps, log)) {
      if (!(deps.markBlocked ?? markBlocked)(entry.id, `${entry.issueId} is closed in the tracker`)) {
        log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
      }
      continue;
    }

    if (!(deps.transition ?? transitionToMerging)(entry.id)) {
      log(`[auto-merge] lost transition race for ${entry.issueId} (#${entry.id}), skipping`);
      continue;
    }

    try {
      const result = await (deps.mergeIssue ?? defaultMergeIssue)(entry.issueId, entry.headSha);
      if (result.success) {
        if (result.outcome === 'merged') {
          (deps.markMerged ?? markMerged)(entry.id);
        } else {
          // Reviewer P1: triggerMerge() returns success=true with outcome='queued'
          // when another merge is already in progress. The row was just transitioned
          // to 'merging'; without recovery it stays there forever (cancel breaks, no
          // completion record). Revert to 'pending' with a short backoff so the next
          // tick re-evaluates eligibility and retries.
          const retryAt = new Date(nowDate.getTime() + REQUEUE_BACKOFF_MS).toISOString();
          const requeued = (deps.requeueToPending ?? requeueToPending)(entry.id, retryAt);
          if (requeued) {
            log(`[auto-merge] merge for ${entry.issueId} accepted as ${result.outcome ?? 'queued'}; requeued for ${retryAt}`);
          } else {
            log(`[auto-merge] failed to requeue ${entry.issueId} (#${entry.id}) after non-terminal status ${result.outcome ?? 'queued'}`);
          }
        }
        continue;
      }

      const reason = failureReason(result);
      if (result.deferred) {
        const retryAt = new Date(nowDate.getTime() + REQUEUE_BACKOFF_MS).toISOString();
        const requeued = (deps.requeueToPending ?? requeueToPending)(entry.id, retryAt);
        log(requeued
          ? `[auto-merge] merge deferred for ${entry.issueId}; requeued without consuming retry budget for ${retryAt}`
          : `[auto-merge] failed to requeue deferred merge for ${entry.issueId} (#${entry.id})`);
        continue;
      }
      if (result.retryable) {
        const retryCount = (deps.getMergeRetryCount ?? readMergeRetryCount)(entry.issueId);
        if (retryCount >= FAILED_MERGE_MAX_RETRIES) {
          const blockedReason = `Auto-merge for ${entry.issueId} blocked: ${reason} (retried ${retryCount} times — fix the underlying cause and re-schedule)`;
          const blocked = (deps.markMergeRetriesExhausted ?? markMergeRetriesExhausted)(entry.id, blockedReason);
          if (blocked) {
            (deps.announceFailure ?? defaultAnnounceFailure)(entry.issueId, blockedReason);
          } else {
            log(`[auto-merge] lost circuit-breaker block race for ${entry.issueId} (#${entry.id}), skipping announcement`);
          }
        } else {
          const nextRetryCount = retryCount + 1;
          (deps.setMergeRetryCount ?? writeMergeRetryCount)(entry.issueId, nextRetryCount);
          const retryAt = new Date(nowDate.getTime() + REQUEUE_BACKOFF_MS).toISOString();
          const requeued = (deps.requeueToPending ?? requeueToPending)(entry.id, retryAt);
          log(requeued
            ? `[auto-merge] retryable merge failure for ${entry.issueId}; requeued attempt ${nextRetryCount}/${FAILED_MERGE_MAX_RETRIES} for ${retryAt}`
            : `[auto-merge] failed to requeue retryable merge for ${entry.issueId} (#${entry.id})`);
        }
        continue;
      }
      (deps.markFailed ?? markFailed)(entry.id, reason);
      (deps.announceFailure ?? defaultAnnounceFailure)(entry.issueId, reason);
    } catch (error) {
      const reason = errorMessage(error);
      (deps.markFailed ?? markFailed)(entry.id, reason);
      (deps.announceFailure ?? defaultAnnounceFailure)(entry.issueId, reason);
    }
  }
}

function runTick(deps: AutoMergeExecutorDeps): void {
  if (activeTick) {
    (deps.log ?? console.log)('[auto-merge] previous tick still running, skipping tick');
    return;
  }

  activeTick = tickAutoMergeExecutor(deps).catch((error) => {
    console.warn('[auto-merge] tick failed:', error);
  }).finally(() => {
    activeTick = null;
  });
}

export function startAutoMergeExecutor(deps: AutoMergeExecutorDeps = {}): boolean {
  if (process.env.OVERDECK_DISABLE_AUTO_MERGE === '1') return false;
  // fix10: a peer dashboard shares the primary's database and forge. It must
  // not merge, and must not start the post-merge work a merge sets off.
  if (isPeerDashboardProcess()) return false;
  if (timer) return false;

  timer = setInterval(() => runTick(deps), AUTO_MERGE_EXECUTOR_INTERVAL_MS);
  return true;
}

export function stopAutoMergeExecutor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
