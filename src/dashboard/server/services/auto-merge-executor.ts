import { emitActivityTtsSync } from '../../../lib/activity-logger.js';
import { isFlywheelGloballyPaused } from '../../../lib/database/app-settings.js';
import {
  listPendingAutoMerges,
  markBlocked,
  markFailed,
  markMerged,
  transitionToMerging,
  type PendingAutoMerge,
} from '../../../lib/database/pending-auto-merges-db.js';
import { isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';

export const AUTO_MERGE_EXECUTOR_INTERVAL_MS = 30_000;

interface MergeResult {
  success: boolean;
  error?: string;
  message?: string;
  statusCode?: number;
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
  mergeIssue?: (issueId: string) => Promise<MergeResult>;
  announceFailure?: (issueId: string, reason: string) => void;
  log?: (message: string) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function dueTime(entry: PendingAutoMerge): number {
  return new Date(entry.scheduledMergeAt).getTime();
}

function isDuePending(entry: PendingAutoMerge, nowMs: number): boolean {
  return entry.status === 'pending' && dueTime(entry) <= nowMs;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function failureReason(result: MergeResult): string {
  return result.error ?? result.message ?? `merge returned status ${result.statusCode ?? 'unknown'}`;
}

async function defaultMergeIssue(issueId: string): Promise<MergeResult> {
  const { triggerMerge } = await import('../routes/workspaces.js');
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
  const now = (deps.now ?? (() => new Date()))().getTime();
  const entries = (deps.listEntries ?? listPendingAutoMerges)()
    .filter((entry) => isDuePending(entry, now))
    .sort((a, b) => a.scheduledMergeAt.localeCompare(b.scheduledMergeAt) || a.id - b.id);

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
      (deps.markBlocked ?? markBlocked)(entry.id, eligibility.reason);
      continue;
    }

    if (!(deps.transition ?? transitionToMerging)(entry.id)) {
      log(`[auto-merge] lost transition race for ${entry.issueId} (#${entry.id}), skipping`);
      continue;
    }

    try {
      const result = await (deps.mergeIssue ?? defaultMergeIssue)(entry.issueId);
      if (result.success) {
        (deps.markMerged ?? markMerged)(entry.id);
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
  if (process.env.PANOPTICON_DISABLE_AUTO_MERGE === '1') return false;
  if (timer) return false;

  timer = setInterval(() => runTick(deps), AUTO_MERGE_EXECUTOR_INTERVAL_MS);
  return true;
}

export function stopAutoMergeExecutor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
