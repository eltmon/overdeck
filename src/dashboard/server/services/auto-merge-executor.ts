import { emitActivityTtsSync } from '../../../lib/activity-logger.js';
import { isFlywheelGloballyPaused } from '../../../lib/database/app-settings.js';
import {
  deferPendingAutoMerge,
  incrementAttempts,
  listDuePendingAutoMerges,
  listProblemAutoMerges,
  markBlocked,
  markFailed,
  markMerged,
  requeueToPending,
  resurrectStrandedAutoMerge,
  transitionToMerging,
  type PendingAutoMerge,
} from '../../../lib/database/pending-auto-merges-db.js';
import { classifyAutoMergeIneligibility, isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';
import { orderMergeCandidates, type MergeCandidateMeta } from '../../../lib/flywheel-merge-order.js';

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
  listProblemEntries?: () => PendingAutoMerge[];
  projectRoot?: string;
  computeMergeOrderMeta?: (
    entries: PendingAutoMerge[],
    projectRoot: string,
  ) => Promise<Array<PendingAutoMerge & MergeCandidateMeta>>;
  isPaused?: () => boolean;
  isEligible?: (issueId: string) => Promise<AutoMergeEligibility>;
  transition?: (id: number) => boolean;
  markBlocked?: (id: number, reason: string) => boolean;
  markMerged?: (id: number) => boolean;
  markFailed?: (id: number, reason: string) => boolean;
  requeueToPending?: (id: number, nextScheduledMergeAt: string) => boolean;
  deferPendingAutoMerge?: (id: number, nextScheduledMergeAt: string) => boolean;
  resurrectStrandedAutoMerge?: (id: number, nextScheduledMergeAt: string) => boolean;
  incrementAttempts?: (id: number) => boolean;
  mergeIssue?: (issueId: string) => Promise<MergeResult>;
  announceFailure?: (issueId: string, reason: string) => void;
  log?: (message: string) => void;
}

const REQUEUE_BACKOFF_MS = 60_000;
const DEFER_BACKOFF_MS = 60_000;
const RECOVERABLE_BACKOFF_MS = 60_000;
const STALE_CEILING_MS = 2 * 60 * 60 * 1000;
const MAX_MERGE_ATTEMPTS = 3;
const MERGE_ORDER_GIT_CONCURRENCY = 4;

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function failureReason(result: MergeResult): string {
  return result.error ?? result.message ?? `merge returned status ${result.statusCode ?? 'unknown'}`;
}

async function defaultComputeMergeOrderMeta(
  entries: PendingAutoMerge[],
  projectRoot: string,
): Promise<Array<PendingAutoMerge & MergeCandidateMeta>> {
  if (entries.length <= 1) {
    return entries.map((entry) => ({ ...entry, issueId: entry.issueId, footprint: 0, conflictCount: 0 }));
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const fileSets: Set<string>[] = [];
  for (let i = 0; i < entries.length; i += MERGE_ORDER_GIT_CONCURRENCY) {
    const batch = entries.slice(i, i + MERGE_ORDER_GIT_CONCURRENCY);
    const batchSets = await Promise.all(
      batch.map(async (entry) => {
        const branch = `feature/${entry.issueId.toLowerCase()}`;
        try {
          const { stdout } = await execFileAsync('git', ['diff', '--name-only', `main...${branch}`], { cwd: projectRoot });
          return new Set(stdout.trim().split('\n').filter(Boolean));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          log(`[auto-merge] cannot compute changed files for ${entry.issueId} (${branch}): ${message}`);
          return new Set<string>();
        }
      }),
    );
    fileSets.push(...batchSets);
  }

  const conflictsMap = new Map<number, Set<number>>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if ([...fileSets[i]!].some((f) => fileSets[j]!.has(f))) {
        if (!conflictsMap.has(i)) conflictsMap.set(i, new Set());
        if (!conflictsMap.has(j)) conflictsMap.set(j, new Set());
        conflictsMap.get(i)!.add(j);
        conflictsMap.get(j)!.add(i);
      }
    }
  }

  return entries.map((entry, i) => ({
    ...entry,
    issueId: entry.issueId,
    footprint: fileSets[i]!.size,
    conflictCount: conflictsMap.get(i)?.size ?? 0,
  }));
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
  const now = deps.now ?? (() => new Date());
  const nowDate = now();
  const isPaused = deps.isPaused ?? isFlywheelGloballyPaused;
  const log = deps.log ?? console.log;

  if (isPaused()) {
    log('[auto-merge] flywheel paused, skipping tick');
    return;
  }

  // Step 1: resurrect recoverable stranded rows (blocked/failed) before trying new merges.
  const problemEntries = (deps.listProblemEntries ?? listProblemAutoMerges)();
  for (const entry of problemEntries) {
    if (entry.attempts >= MAX_MERGE_ATTEMPTS) {
      log(`[auto-merge] ${entry.issueId} (#${entry.id}) at attempt cap, leaving stranded for LLM`);
      continue;
    }

    const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(entry.issueId);
    if (!eligibility.eligible) {
      log(`[auto-merge] ${entry.issueId} (#${entry.id}) still ineligible, staying stranded`);
      continue;
    }

    if ((deps.resurrectStrandedAutoMerge ?? resurrectStrandedAutoMerge)(entry.id, nowDate.toISOString())) {
      log(`[auto-merge] resurrected ${entry.issueId} (#${entry.id}) from ${entry.status} to pending`);
    } else {
      log(`[auto-merge] lost resurrection race for ${entry.issueId} (#${entry.id}), skipping`);
    }
  }

  let entries = deps.listEntries
    ? deps.listEntries()
      .filter((entry) => entry.status === 'pending' && Date.parse(entry.scheduledMergeAt) <= nowDate.getTime())
      .sort((a, b) => a.scheduledMergeAt.localeCompare(b.scheduledMergeAt) || a.id - b.id)
    : listDuePendingAutoMerges(nowDate.toISOString());

  if (entries.length === 0) return;

  // PAN-1691: when multiple entries are due, order by conflict-aware merge
  // order (disjoint first, then conflicting broadest-footprint first).
  if (entries.length >= 2) {
    const projectRoot = deps.projectRoot ?? process.cwd();
    const metas = await (deps.computeMergeOrderMeta ?? defaultComputeMergeOrderMeta)(entries, projectRoot);
    const ordered = orderMergeCandidates(
      metas.map((m) => ({ issueId: m.issueId, footprint: m.footprint, conflictCount: m.conflictCount })),
    );
    entries = ordered.map((candidate) => metas.find((m) => m.issueId === candidate.issueId)!);
  }

  for (const entry of entries) {
    if (isPaused()) {
      log('[auto-merge] flywheel paused, skipping tick');
      return;
    }

    const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(entry.issueId);
    if (!eligibility.eligible) {
      const classification = classifyAutoMergeIneligibility(eligibility.code);
      if (classification === 'retryable') {
        const entryAgeMs = nowDate.getTime() - Date.parse(entry.scheduledAt);
        if (entryAgeMs > STALE_CEILING_MS) {
          const reason = `stuck: ineligible over ${STALE_CEILING_MS / 60 / 60 / 1000}h`;
          if ((deps.markBlocked ?? markBlocked)(entry.id, reason)) {
            log(`[auto-merge] ${entry.issueId} (#${entry.id}) ineligible past staleness ceiling, marked blocked`);
          } else {
            log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
          }
        } else {
          const retryAt = new Date(nowDate.getTime() + DEFER_BACKOFF_MS).toISOString();
          if ((deps.deferPendingAutoMerge ?? deferPendingAutoMerge)(entry.id, retryAt)) {
            log(`[auto-merge] ${entry.issueId} (#${entry.id}) transiently ineligible, deferred to ${retryAt}`);
          } else {
            log(`[auto-merge] lost defer race for ${entry.issueId} (#${entry.id}), skipping`);
          }
        }
      } else {
        if ((deps.markBlocked ?? markBlocked)(entry.id, eligibility.reason)) {
          log(`[auto-merge] ${entry.issueId} (#${entry.id}) terminally ineligible, marked blocked`);
        } else {
          log(`[auto-merge] lost block race for ${entry.issueId} (#${entry.id}), skipping`);
        }
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
      const incremented = (deps.incrementAttempts ?? incrementAttempts)(entry.id);
      const nextAttempts = incremented ? entry.attempts + 1 : entry.attempts;
      if (nextAttempts < MAX_MERGE_ATTEMPTS) {
        const retryAt = new Date(nowDate.getTime() + RECOVERABLE_BACKOFF_MS * 2 ** (nextAttempts - 1)).toISOString();
        if ((deps.requeueToPending ?? requeueToPending)(entry.id, retryAt)) {
          log(`[auto-merge] ${entry.issueId} (#${entry.id}) merge attempt ${nextAttempts} failed, requeued for ${retryAt}`);
        } else {
          log(`[auto-merge] lost requeue race for ${entry.issueId} (#${entry.id}) after failed merge`);
        }
      } else {
        const marked = (deps.markFailed ?? markFailed)(entry.id, reason);
        if (marked) (deps.announceFailure ?? defaultAnnounceFailure)(entry.issueId, reason);
      }
    } catch (error) {
      const reason = errorMessage(error);
      const incremented = (deps.incrementAttempts ?? incrementAttempts)(entry.id);
      const nextAttempts = incremented ? entry.attempts + 1 : entry.attempts;
      if (nextAttempts < MAX_MERGE_ATTEMPTS) {
        const retryAt = new Date(nowDate.getTime() + RECOVERABLE_BACKOFF_MS * 2 ** (nextAttempts - 1)).toISOString();
        if ((deps.requeueToPending ?? requeueToPending)(entry.id, retryAt)) {
          log(`[auto-merge] ${entry.issueId} (#${entry.id}) merge attempt ${nextAttempts} threw, requeued for ${retryAt}`);
        } else {
          log(`[auto-merge] lost requeue race for ${entry.issueId} (#${entry.id}) after merge exception`);
        }
      } else {
        const marked = (deps.markFailed ?? markFailed)(entry.id, reason);
        if (marked) (deps.announceFailure ?? defaultAnnounceFailure)(entry.issueId, reason);
      }
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
