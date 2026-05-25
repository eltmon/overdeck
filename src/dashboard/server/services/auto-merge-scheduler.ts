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
import { getCommitStatusChecks, getGitHubCiStatus, getPrLabels } from '../../../lib/forge.js';
import { listProjects, resolveProjectFromIssue } from '../../../lib/projects.js';
import { getReviewStatus, type ReviewStatus } from '../../../lib/review-status.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../../lib/activity-logger.js';
import { getEventStore } from '../event-store.js';
import { triggerRegisteredMerge } from './merge-queue-service.js';
import type { DomainEvent } from '@panctl/contracts';

type TimerHandle = ReturnType<typeof setTimeout>;
type AutoMergeEventPayloads = {
  'merge.auto.scheduled': { issueId: string; executeAt: string; scheduledAt: string; cooldownSeconds: number };
  'merge.auto.cancelled': { issueId: string; reason: string; cancelledBy: string };
  'merge.auto.executed': { issueId: string };
  'merge.auto.aborted': { issueId: string; gateFailureReason: string };
  'merge.auto.failed': { issueId: string; reason: string };
};
type AutoMergeEventType = keyof AutoMergeEventPayloads;
type AutoMergeTtsEventType = AutoMergeEventType | 'merge.auto.executing';

export interface AutoMergeSchedulerDeps {
  now: () => Date;
  setTimer: (fn: () => void, delayMs: number) => TimerHandle;
  clearTimer: (timer: TimerHandle) => void;
  getConfig: (projectKey?: string) => Promise<NormalizedAutoMergeConfig>;
  resolveProjectKey: (issueId: string) => Promise<string | undefined>;
  getStatus: (issueId: string) => Promise<ReviewStatus | null>;
  getPendingRows: () => AutoMergeRow[];
  schedulePending: (issueId: string, executeAt: string) => boolean;
  cancelPending: (issueId: string, reason: string) => boolean;
  markExecuting: (issueId: string) => boolean;
  markExecuted: (issueId: string) => void;
  markAborted: (issueId: string, reason: string) => void;
  markFailed: (issueId: string, reason: string) => void;
  getLabels: (prUrl: string) => Promise<string[]>;
  getGitHubCiStatus: (prUrl: string) => Promise<{ passing: boolean }>;
  getCommitStatusChecks: (prUrl: string) => Promise<{ passing: boolean }>;
  triggerMerge: (issueId: string) => Promise<unknown>;
}

const DEFAULT_DEPS: AutoMergeSchedulerDeps = {
  now: () => new Date(),
  setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  getConfig: (projectKey) => Effect.runPromise(getAutoMergeConfig(projectKey)),
  resolveProjectKey: async (issueId) => (await Effect.runPromise(resolveProjectFromIssue(issueId)))?.projectKey,
  getStatus: (issueId) => Effect.runPromise(getReviewStatus(issueId)),
  getPendingRows: getPendingAutoMerges,
  schedulePending: schedulePendingAutoMerge,
  cancelPending: cancelPendingAutoMerge,
  markExecuting: markAutoMergeExecuting,
  markExecuted: markAutoMergeExecuted,
  markAborted: markAutoMergeAborted,
  markFailed: markAutoMergeFailed,
  getLabels: getPrLabels,
  getGitHubCiStatus,
  getCommitStatusChecks,
  triggerMerge: triggerRegisteredMerge,
};

function disabledByEnv(): boolean {
  return process.env.PANOPTICON_DISABLE_AUTO_MERGE === '1';
}

const MAX_TTS_LENGTH = 139;

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function spokenIssueId(issueId: string): string {
  return normalizeIssueId(issueId).replace(/-/g, ' ').toLowerCase();
}

function truncateTtsUtterance(utterance: string): string {
  if (utterance.length <= MAX_TTS_LENGTH) return utterance;
  return `${utterance.slice(0, MAX_TTS_LENGTH - 3)}...`;
}

function formatMinutes(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

async function resolveProjectKey(deps: AutoMergeSchedulerDeps, issueId: string, explicitProjectKey?: string): Promise<string | undefined> {
  return explicitProjectKey ?? deps.resolveProjectKey(issueId);
}

function transitionLog(issueId: string, event: string, context?: Record<string, unknown>): void {
  const suffix = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  console.log(`[merge-auto] ${issueId} ${event}${suffix}`);
}

function emitAutoMergeEvent<T extends AutoMergeEventType>(type: T, payload: AutoMergeEventPayloads[T]): void {
  try {
    void getEventStore().appendAsync({
      type,
      timestamp: new Date().toISOString(),
      payload,
    } as Omit<DomainEvent, 'sequence'>).catch(() => undefined);
  } catch {
    // Event store may not be initialized during early boot.
  }
}

function emitAutoMergeActivity(issueId: string, level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  emitActivityEntrySync({ source: 'dashboard', level, message, issueId });
}

function emitAutoMergeTts(issueId: string, utterance: string, eventType: AutoMergeTtsEventType, priority = 2): void {
  emitActivityTtsSync({ issueId, utterance: truncateTtsUtterance(utterance), eventType, priority, source: 'dashboard' });
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { _tag?: string; message?: string };
  return candidate._tag === 'ForgeTimeoutError' || candidate.message?.toLowerCase().includes('timeout') === true;
}

export class AutoMergeScheduler {
  private readonly timers = new Map<string, TimerHandle>();
  private readonly reminderTimers = new Map<string, TimerHandle>();
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
    for (const timer of this.reminderTimers.values()) {
      this.deps.clearTimer(timer);
    }
    this.timers.clear();
    this.reminderTimers.clear();
    this.started = false;
  }

  async maybeSchedule(issueId: string, projectKey?: string): Promise<boolean> {
    const normalizedIssueId = normalizeIssueId(issueId);
    if (disabledByEnv()) return false;

    const resolvedProjectKey = await resolveProjectKey(this.deps, normalizedIssueId, projectKey);
    const config = await this.deps.getConfig(resolvedProjectKey);
    if (!config.enabled) return false;

    const status = await this.deps.getStatus(normalizedIssueId);
    if (!status?.readyForMerge) return false;
    if (status.mergeStatus && status.mergeStatus !== 'pending') return false;

    const scheduledAtMs = this.deps.now().getTime();
    const scheduledAt = new Date(scheduledAtMs).toISOString();
    const executeAt = new Date(scheduledAtMs + config.cooldownMinutes * 60_000).toISOString();
    const scheduled = this.deps.schedulePending(normalizedIssueId, executeAt);
    if (!scheduled) return false;

    this.arm(normalizedIssueId, executeAt, resolvedProjectKey, config.cooldownMinutes > 1);
    transitionLog(normalizedIssueId, 'scheduled', { executeAt });
    emitAutoMergeEvent('merge.auto.scheduled', {
      issueId: normalizedIssueId,
      executeAt,
      scheduledAt,
      cooldownSeconds: config.cooldownMinutes * 60,
    });
    emitAutoMergeActivity(normalizedIssueId, 'info', `Auto-merge scheduled for ${normalizedIssueId}`);
    emitAutoMergeTts(
      normalizedIssueId,
      `Auto merging ${spokenIssueId(normalizedIssueId)} in ${formatMinutes(config.cooldownMinutes)} — say pan merge cancel ${spokenIssueId(normalizedIssueId)} to abort`,
      'merge.auto.scheduled',
      1,
    );
    return true;
  }

  async cancel(issueId: string, reason: string, cancelledBy: string): Promise<boolean> {
    const normalizedIssueId = normalizeIssueId(issueId);
    this.clearIssueTimers(normalizedIssueId);

    const cancelled = this.deps.cancelPending(normalizedIssueId, reason);
    if (!cancelled) return false;

    transitionLog(normalizedIssueId, 'cancelled', { reason, cancelledBy });
    emitAutoMergeEvent('merge.auto.cancelled', { issueId: normalizedIssueId, reason, cancelledBy });
    emitAutoMergeActivity(normalizedIssueId, 'warn', `Auto-merge cancelled for ${normalizedIssueId}: ${reason}`);
    emitAutoMergeTts(normalizedIssueId, `Auto merge of ${spokenIssueId(normalizedIssueId)} cancelled`, 'merge.auto.cancelled', 1);
    return true;
  }

  private async recoverPending(row: AutoMergeRow): Promise<void> {
    const projectKey = await resolveProjectKey(this.deps, row.issueId);
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

    this.arm(row.issueId, row.executeAt, projectKey, config.cooldownMinutes > 1);
  }

  private arm(issueId: string, executeAt: string, projectKey?: string, emitReminder = false): void {
    const normalizedIssueId = normalizeIssueId(issueId);
    this.clearIssueTimers(normalizedIssueId);

    const executeAtMs = Date.parse(executeAt);
    const delayMs = Math.max(0, executeAtMs - this.deps.now().getTime());
    const timer = this.deps.setTimer(() => {
      this.timers.delete(normalizedIssueId);
      void this.fire(normalizedIssueId, executeAt, projectKey);
    }, delayMs);
    this.timers.set(normalizedIssueId, timer);

    const reminderDelayMs = executeAtMs - this.deps.now().getTime() - 30_000;
    if (emitReminder && reminderDelayMs > 0) {
      const reminderTimer = this.deps.setTimer(() => {
        this.reminderTimers.delete(normalizedIssueId);
        emitAutoMergeTts(
          normalizedIssueId,
          `Auto merge of ${spokenIssueId(normalizedIssueId)} in 30 seconds`,
          'merge.auto.scheduled',
          2,
        );
      }, reminderDelayMs);
      this.reminderTimers.set(normalizedIssueId, reminderTimer);
    }
  }

  private clearIssueTimers(issueId: string): void {
    const normalizedIssueId = normalizeIssueId(issueId);
    const timer = this.timers.get(normalizedIssueId);
    if (timer) {
      this.deps.clearTimer(timer);
      this.timers.delete(normalizedIssueId);
    }

    const reminderTimer = this.reminderTimers.get(normalizedIssueId);
    if (reminderTimer) {
      this.deps.clearTimer(reminderTimer);
      this.reminderTimers.delete(normalizedIssueId);
    }
  }

  private async fire(issueId: string, executeAt: string, projectKey?: string): Promise<void> {
    const normalizedIssueId = normalizeIssueId(issueId);
    if (!this.deps.markExecuting(normalizedIssueId)) return;
    this.clearIssueTimers(normalizedIssueId);

    try {
      const config = await this.deps.getConfig(await resolveProjectKey(this.deps, normalizedIssueId, projectKey));
      if (!config.enabled) {
        this.abort(normalizedIssueId, 'disabled');
        return;
      }

      const executeAtMs = Date.parse(executeAt);
      if (Number.isNaN(executeAtMs)) {
        this.abort(normalizedIssueId, 'invalid_execute_at');
        return;
      }

      const overdueMs = this.deps.now().getTime() - executeAtMs;
      if (overdueMs > config.maxStaleMinutes * 60_000) {
        this.abort(normalizedIssueId, 'stale');
        return;
      }

      transitionLog(normalizedIssueId, 'executing');
      emitAutoMergeTts(normalizedIssueId, `Auto merging ${spokenIssueId(normalizedIssueId)} now`, 'merge.auto.executing', 1);

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
    if (!status?.readyForMerge) return 'no-longer-ready';
    if (status.mergeStatus && status.mergeStatus !== 'pending') return `merge-status:${status.mergeStatus}`;

    const needsPrUrl = config.requireNoBlockerLabels.length > 0 || config.requireGitHubCiPassing || config.requireAllCommitStatusChecks;
    if (needsPrUrl && !status.prUrl) return 'missing-pr-url';

    if (status.prUrl && config.requireNoBlockerLabels.length > 0) {
      try {
        const blockerLabels = new Set(config.requireNoBlockerLabels.map(label => label.toLowerCase()));
        const labels = await this.deps.getLabels(status.prUrl);
        const blocker = labels.find(label => blockerLabels.has(label.toLowerCase()));
        if (blocker) return `blocker-label:${blocker}`;
      } catch (error) {
        return isTimeoutError(error) ? 'label-check-timeout' : `label-check-failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (status.prUrl && config.requireGitHubCiPassing) {
      try {
        const ciStatus = await this.deps.getGitHubCiStatus(status.prUrl);
        if (!ciStatus.passing) return 'ci-failing';
      } catch (error) {
        return isTimeoutError(error) ? 'ci-check-timeout' : `ci-check-failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (status.prUrl && config.requireAllCommitStatusChecks) {
      try {
        const statusChecks = await this.deps.getCommitStatusChecks(status.prUrl);
        if (!statusChecks.passing) return 'status-check-failing';
      } catch (error) {
        return isTimeoutError(error) ? 'status-check-timeout' : `status-check-failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return null;
  }

  private abort(issueId: string, reason: string): void {
    const normalizedIssueId = normalizeIssueId(issueId);
    this.clearIssueTimers(normalizedIssueId);
    this.deps.markAborted(normalizedIssueId, reason);
    transitionLog(normalizedIssueId, 'aborted', { reason });
    emitAutoMergeEvent('merge.auto.aborted', { issueId: normalizedIssueId, gateFailureReason: reason });
    emitAutoMergeActivity(normalizedIssueId, 'warn', `Auto-merge aborted for ${normalizedIssueId}: ${reason}`);
    emitAutoMergeTts(
      normalizedIssueId,
      `Auto merge of ${spokenIssueId(normalizedIssueId)} aborted — ${reason}`,
      'merge.auto.aborted',
      1,
    );
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

export async function logEnabledAutoMergeProjects(): Promise<void> {
  const projects = await Effect.runPromise(listProjects());
  const enabledProjects: string[] = [];

  for (const project of projects) {
    const config = await Effect.runPromise(getAutoMergeConfig(project.key));
    if (config.enabled) enabledProjects.push(project.key);
  }

  if (enabledProjects.length > 0) {
    console.log(`[merge-auto] AUTO-MERGE ENABLED for project(s): ${enabledProjects.join(', ')}`);
  }
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
