import { Effect } from 'effect';
import { getAutoMergeConfig, type NormalizedAutoMergeConfig } from '../../../lib/config-yaml.js';
import {
  cancelPendingAutoMerge,
  getPendingAutoMerges,
  markAutoMergeAborted,
  markAutoMergeExecuted,
  markAutoMergeExecuting,
  markAutoMergeFailed,
  schedulePendingAutoMerge,
  type AutoMergeRow,
} from '../../../lib/database/auto-merge-db.js';
import { getCombinedCommitStatus, getPrLabels } from '../../../lib/forge.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getReviewStatus, type ReviewStatus } from '../../../lib/review-status.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../../lib/activity-logger.js';
import { getEventStore } from '../event-store.js';
import { triggerRegisteredMerge } from './merge-queue-service.js';

type TimerHandle = ReturnType<typeof setTimeout>;
type AutoMergeEventType = 'merge.auto.scheduled' | 'merge.auto.cancelled' | 'merge.auto.executing' | 'merge.auto.executed' | 'merge.auto.aborted' | 'merge.auto.failed';

export interface AutoMergeSchedulerDeps {
  now: () => Date;
  setTimer: (fn: () => void, delayMs: number) => TimerHandle;
  clearTimer: (timer: TimerHandle) => void;
  getConfig: (projectKey?: string) => Promise<NormalizedAutoMergeConfig>;
  getStatus: (issueId: string) => Promise<ReviewStatus | null>;
  getPendingRows: () => AutoMergeRow[];
  schedulePending: (issueId: string, executeAt: string) => boolean;
  cancelPending: (issueId: string, reason: string) => boolean;
  markExecuting: (issueId: string) => boolean;
  markExecuted: (issueId: string) => void;
  markAborted: (issueId: string, reason: string) => void;
  markFailed: (issueId: string, reason: string) => void;
  getLabels: (prUrl: string) => Promise<string[]>;
  getCombinedStatus: (prUrl: string) => Promise<{ passing: boolean }>;
  triggerMerge: (issueId: string) => Promise<unknown>;
}

const DEFAULT_DEPS: AutoMergeSchedulerDeps = {
  now: () => new Date(),
  setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  getConfig: (projectKey) => Effect.runPromise(getAutoMergeConfig(projectKey)),
  getStatus: (issueId) => Effect.runPromise(getReviewStatus(issueId)),
  getPendingRows: getPendingAutoMerges,
  schedulePending: schedulePendingAutoMerge,
  cancelPending: cancelPendingAutoMerge,
  markExecuting: markAutoMergeExecuting,
  markExecuted: markAutoMergeExecuted,
  markAborted: markAutoMergeAborted,
  markFailed: markAutoMergeFailed,
  getLabels: getPrLabels,
  getCombinedStatus: getCombinedCommitStatus,
  triggerMerge: triggerRegisteredMerge,
};

function disabledByEnv(): boolean {
  return process.env.PANOPTICON_DISABLE_AUTO_MERGE === '1';
}

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function resolveProjectKey(issueId: string, explicitProjectKey?: string): string | undefined {
  return explicitProjectKey ?? resolveProjectFromIssueSync(issueId)?.projectKey;
}

function transitionLog(issueId: string, event: string, context?: Record<string, unknown>): void {
  const suffix = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  console.log(`[merge-auto] ${issueId} ${event}${suffix}`);
}

function emitAutoMergeEvent(type: AutoMergeEventType, payload: Record<string, unknown>): void {
  try {
    void getEventStore().appendAsync({
      type,
      timestamp: new Date().toISOString(),
      payload,
    } as never).catch(() => undefined);
  } catch {
    // Event store may not be initialized during early boot.
  }
}

function emitAutoMergeActivity(issueId: string, level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  emitActivityEntrySync({ source: 'dashboard', level, message, issueId });
}

function emitAutoMergeTts(issueId: string, utterance: string, eventType: AutoMergeEventType, priority = 2): void {
  emitActivityTtsSync({ issueId, utterance, eventType, priority, source: 'dashboard' });
}

export class AutoMergeScheduler {
  private readonly timers = new Map<string, TimerHandle>();
  private started = false;

  constructor(private readonly deps: AutoMergeSchedulerDeps = DEFAULT_DEPS) {}

  async start(): Promise<void> {
    if (disabledByEnv()) {
      transitionLog('SYSTEM', 'disabled-by-env');
      return;
    }

    if (this.started) return;
    this.started = true;

    const rows = this.deps.getPendingRows();
    for (const row of rows) {
      await this.recoverPending(row);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      this.deps.clearTimer(timer);
    }
    this.timers.clear();
    this.started = false;
  }

  async maybeSchedule(issueId: string, projectKey?: string): Promise<boolean> {
    const normalizedIssueId = normalizeIssueId(issueId);
    if (disabledByEnv()) return false;

    const config = await this.deps.getConfig(resolveProjectKey(normalizedIssueId, projectKey));
    if (!config.enabled) return false;

    const status = await this.deps.getStatus(normalizedIssueId);
    if (!status?.readyForMerge) return false;
    if (status.mergeStatus && status.mergeStatus !== 'pending') return false;

    const executeAt = new Date(this.deps.now().getTime() + config.cooldownMinutes * 60_000).toISOString();
    const scheduled = this.deps.schedulePending(normalizedIssueId, executeAt);
    if (!scheduled) return false;

    this.arm(normalizedIssueId, executeAt, resolveProjectKey(normalizedIssueId, projectKey));
    transitionLog(normalizedIssueId, 'scheduled', { executeAt });
    emitAutoMergeEvent('merge.auto.scheduled', { issueId: normalizedIssueId, executeAt });
    emitAutoMergeActivity(normalizedIssueId, 'info', `Auto-merge scheduled for ${normalizedIssueId}`);
    emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge scheduled`, 'merge.auto.scheduled');
    return true;
  }

  async cancel(issueId: string, reason: string, cancelledBy: string): Promise<boolean> {
    const normalizedIssueId = normalizeIssueId(issueId);
    const timer = this.timers.get(normalizedIssueId);
    if (timer) {
      this.deps.clearTimer(timer);
      this.timers.delete(normalizedIssueId);
    }

    const cancelled = this.deps.cancelPending(normalizedIssueId, reason);
    if (!cancelled) return false;

    transitionLog(normalizedIssueId, 'cancelled', { reason, cancelledBy });
    emitAutoMergeEvent('merge.auto.cancelled', { issueId: normalizedIssueId, reason, cancelledBy });
    emitAutoMergeActivity(normalizedIssueId, 'warn', `Auto-merge cancelled for ${normalizedIssueId}: ${reason}`);
    emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge cancelled`, 'merge.auto.cancelled', 1);
    return true;
  }

  private async recoverPending(row: AutoMergeRow): Promise<void> {
    const projectKey = resolveProjectKey(row.issueId);
    const config = await this.deps.getConfig(projectKey);
    if (!config.enabled) {
      this.abort(row.issueId, 'disabled');
      return;
    }

    const executeAtMs = Date.parse(row.executeAt);
    if (Number.isNaN(executeAtMs)) {
      this.abort(row.issueId, 'invalid_execute_at');
      return;
    }

    const overdueMs = this.deps.now().getTime() - executeAtMs;
    if (overdueMs > config.maxStaleMinutes * 60_000) {
      this.abort(row.issueId, 'stale');
      return;
    }

    this.arm(row.issueId, row.executeAt, projectKey);
  }

  private arm(issueId: string, executeAt: string, projectKey?: string): void {
    const normalizedIssueId = normalizeIssueId(issueId);
    const existing = this.timers.get(normalizedIssueId);
    if (existing) this.deps.clearTimer(existing);

    const delayMs = Math.max(0, Date.parse(executeAt) - this.deps.now().getTime());
    const timer = this.deps.setTimer(() => {
      this.timers.delete(normalizedIssueId);
      void this.fire(normalizedIssueId, projectKey);
    }, delayMs);
    this.timers.set(normalizedIssueId, timer);
  }

  private async fire(issueId: string, projectKey?: string): Promise<void> {
    const normalizedIssueId = normalizeIssueId(issueId);
    if (!this.deps.markExecuting(normalizedIssueId)) return;

    transitionLog(normalizedIssueId, 'executing');
    emitAutoMergeEvent('merge.auto.executing', { issueId: normalizedIssueId });
    emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge cooldown complete`, 'merge.auto.executing');

    try {
      const config = await this.deps.getConfig(resolveProjectKey(normalizedIssueId, projectKey));
      if (!config.enabled) {
        this.abort(normalizedIssueId, 'disabled');
        return;
      }

      const abortReason = await this.validateGates(normalizedIssueId, config);
      if (abortReason) {
        this.abort(normalizedIssueId, abortReason);
        return;
      }

      const result = await this.deps.triggerMerge(normalizedIssueId);
      if (this.mergeResultSucceeded(result)) {
        this.deps.markExecuted(normalizedIssueId);
        transitionLog(normalizedIssueId, 'executed');
        emitAutoMergeEvent('merge.auto.executed', { issueId: normalizedIssueId });
        emitAutoMergeActivity(normalizedIssueId, 'success', `Auto-merge executed for ${normalizedIssueId}`);
        emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge started`, 'merge.auto.executed', 1);
      } else {
        const reason = this.mergeResultMessage(result) ?? 'merge_trigger_failed';
        this.deps.markFailed(normalizedIssueId, reason);
        transitionLog(normalizedIssueId, 'failed', { reason });
        emitAutoMergeEvent('merge.auto.failed', { issueId: normalizedIssueId, reason });
        emitAutoMergeActivity(normalizedIssueId, 'error', `Auto-merge failed for ${normalizedIssueId}: ${reason}`);
        emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge failed`, 'merge.auto.failed', 0);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.markFailed(normalizedIssueId, reason);
      transitionLog(normalizedIssueId, 'failed', { reason });
      emitAutoMergeEvent('merge.auto.failed', { issueId: normalizedIssueId, reason });
      emitAutoMergeActivity(normalizedIssueId, 'error', `Auto-merge failed for ${normalizedIssueId}: ${reason}`);
      emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge failed`, 'merge.auto.failed', 0);
    }
  }

  private async validateGates(issueId: string, config: NormalizedAutoMergeConfig): Promise<string | null> {
    const status = await this.deps.getStatus(issueId);
    if (!status?.readyForMerge) return 'ready_for_merge_false';
    if (status.mergeStatus && status.mergeStatus !== 'pending') return `merge_status_${status.mergeStatus}`;

    const needsPrUrl = config.requireNoBlockerLabels.length > 0 || config.requireGitHubCiPassing || config.requireAllCommitStatusChecks;
    if (needsPrUrl && !status.prUrl) return 'missing_pr_url';

    if (status.prUrl && config.requireNoBlockerLabels.length > 0) {
      const blockerLabels = new Set(config.requireNoBlockerLabels.map(label => label.toLowerCase()));
      const labels = await this.deps.getLabels(status.prUrl);
      const blocker = labels.find(label => blockerLabels.has(label.toLowerCase()));
      if (blocker) return `blocker_label:${blocker}`;
    }

    if (status.prUrl && (config.requireGitHubCiPassing || config.requireAllCommitStatusChecks)) {
      const combinedStatus = await this.deps.getCombinedStatus(status.prUrl);
      if (!combinedStatus.passing) return 'ci_not_passing';
    }

    return null;
  }

  private abort(issueId: string, reason: string): void {
    const normalizedIssueId = normalizeIssueId(issueId);
    const timer = this.timers.get(normalizedIssueId);
    if (timer) {
      this.deps.clearTimer(timer);
      this.timers.delete(normalizedIssueId);
    }
    this.deps.markAborted(normalizedIssueId, reason);
    transitionLog(normalizedIssueId, 'aborted', { reason });
    emitAutoMergeEvent('merge.auto.aborted', { issueId: normalizedIssueId, reason });
    emitAutoMergeActivity(normalizedIssueId, 'warn', `Auto-merge aborted for ${normalizedIssueId}: ${reason}`);
    emitAutoMergeTts(normalizedIssueId, `${normalizedIssueId} auto merge aborted`, 'merge.auto.aborted', 1);
  }

  private mergeResultSucceeded(result: unknown): boolean {
    if (!result || typeof result !== 'object') return true;
    const maybeResult = result as { success?: unknown };
    return maybeResult.success !== false;
  }

  private mergeResultMessage(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null;
    const maybeResult = result as { error?: unknown; message?: unknown };
    if (typeof maybeResult.error === 'string') return maybeResult.error;
    if (typeof maybeResult.message === 'string') return maybeResult.message;
    return null;
  }
}

export const autoMergeScheduler = new AutoMergeScheduler();

export function startAutoMergeScheduler(): Promise<void> {
  return autoMergeScheduler.start();
}

export function stopAutoMergeScheduler(): void {
  autoMergeScheduler.stop();
}

export function maybeScheduleAutoMerge(issueId: string, projectKey?: string): Promise<boolean> {
  return autoMergeScheduler.maybeSchedule(issueId, projectKey);
}

export function cancelAutoMerge(issueId: string, reason: string, cancelledBy: string): Promise<boolean> {
  return autoMergeScheduler.cancel(issueId, reason, cancelledBy);
}
