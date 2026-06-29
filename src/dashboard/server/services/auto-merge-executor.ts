import { emitActivityTtsSync } from '../../../lib/activity-logger.js';
import {
  isFlywheelGloballyPaused,
  listDuePendingAutoMerges,
  markBlocked,
  markFailed,
  markMerged,
  requeueToPending,
  transitionToMerging,
  type PendingAutoMerge,
} from '../../../lib/overdeck/merge-sync.js';
import { isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';

export const AUTO_MERGE_EXECUTOR_INTERVAL_MS = 30_000;

interface MergeResult {
  success: boolean;
  error?: string;
  message?: string;
  statusCode?: number;
  mergeStatus?: string;
}

export interface AutoMergeExecutorDeps {
  now?: () => Date;
  listEntries?: () => PendingAutoMerge[];
  isPaused?: () => boolean;
  isEligible?: (issueId: string) => Promise<AutoMergeEligibility>;
  transition?: (id: number) => boolean;
  markBlocked?: (id: number, reason: string) => boolean;
  markMerged?: (id: number) => boolean;
  markFailed?: (id: number, reason: string) => boolean;
  requeueToPending?: (id: number, nextScheduledMergeAt: string) => boolean;
  mergeIssue?: (issueId: string) => Promise<MergeResult>;
  announceFailure?: (issueId: string, reason: string) => void;
  log?: (message: string) => void;
}

const REQUEUE_BACKOFF_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function failureReason(result: MergeResult): string {
  return result.error ?? result.message ?? `merge returned status ${result.statusCode ?? 'unknown'}`;
}

async function defaultMergeIssue(issueId: string): Promise<MergeResult> {
  const { triggerMerge } = await import('../routes/workspaces/merge-ops.js');
  return triggerMerge(issueId);
}

function defaultAnnounceFailure(issueId: string, reason: string): void {
  emitActivityTtsSync({
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

  const isPaused = deps.isPaused ?? isFlywheelGloballyPaused;
  const log = deps.log ?? console.log;
  if (isPaused()) {
    log('[auto-merge] flywheel paused, skipping tick');
    return;
  }

  for (const entry of entries) {
    if (isPaused()) {
      log('[auto-merge] flywheel paused, skipping tick');
      return;
    }

    const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(entry.issueId);
    if (!eligibility.eligible) {
      if (!(deps.markBlocked ?? markBlocked)(entry.id, eligibility.reason)) {
        log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
      }
      continue;
    }

    if (!(deps.transition ?? transitionToMerging)(entry.id)) {
      log(`[auto-merge] lost transition race for ${entry.issueId} (#${entry.id}), skipping`);
      continue;
    }

    try {
      const result = await (deps.mergeIssue ?? defaultMergeIssue)(entry.issueId);
      if (result.success) {
        if (result.mergeStatus === 'merged') {
          (deps.markMerged ?? markMerged)(entry.id);
        } else {
          // Reviewer P1: triggerMerge() returns success=true with mergeStatus='queued'
          // when another merge is already in progress. The row was just transitioned
          // to 'merging'; without recovery it stays there forever (cancel breaks, no
          // completion record). Revert to 'pending' with a short backoff so the next
          // tick re-evaluates eligibility and retries.
          const retryAt = new Date(nowDate.getTime() + REQUEUE_BACKOFF_MS).toISOString();
          const requeued = (deps.requeueToPending ?? requeueToPending)(entry.id, retryAt);
          if (requeued) {
            log(`[auto-merge] merge for ${entry.issueId} accepted as ${result.mergeStatus ?? 'queued'}; requeued for ${retryAt}`);
          } else {
            log(`[auto-merge] failed to requeue ${entry.issueId} (#${entry.id}) after non-terminal status ${result.mergeStatus ?? 'queued'}`);
          }
        }
        continue;
      }

      const reason = failureReason(result);
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
  if (timer) return false;

  timer = setInterval(() => runTick(deps), AUTO_MERGE_EXECUTOR_INTERVAL_MS);
  return true;
}

export function stopAutoMergeExecutor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
