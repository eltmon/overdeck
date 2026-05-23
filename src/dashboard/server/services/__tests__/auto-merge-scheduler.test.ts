import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoMergeScheduler, type AutoMergeSchedulerDeps } from '../auto-merge-scheduler.js';
import type { AutoMergeRow, AutoMergeStatus } from '../../../../lib/database/auto-merge-db.js';
import type { NormalizedAutoMergeConfig } from '../../../../lib/config-yaml.js';
import type { ReviewStatus } from '../../../../lib/review-status.js';

const appendAsyncMock = vi.hoisted(() => vi.fn());
const activityEntryMock = vi.hoisted(() => vi.fn());
const activityTtsMock = vi.hoisted(() => vi.fn());

vi.mock('../../event-store.js', () => ({
  getEventStore: () => ({ appendAsync: appendAsyncMock }),
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: activityEntryMock,
  emitActivityTtsSync: activityTtsMock,
}));

const baseNow = new Date('2026-05-23T12:00:00.000Z');

function config(overrides: Partial<NormalizedAutoMergeConfig> = {}): NormalizedAutoMergeConfig {
  return {
    enabled: true,
    cooldownMinutes: 5,
    maxStaleMinutes: 60,
    requireGitHubCiPassing: true,
    requireAllCommitStatusChecks: true,
    requireNoBlockerLabels: ['do-not-merge', 'wip'],
    ...overrides,
  };
}

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1',
    reviewStatus: 'passed',
    testStatus: 'passed',
    updatedAt: baseNow.toISOString(),
    readyForMerge: true,
    mergeStatus: 'pending',
    prUrl: 'https://github.com/acme/app/pull/1',
    ...overrides,
  };
}

function row(issueId: string, executeAt: string, status: AutoMergeStatus = 'pending'): AutoMergeRow {
  return {
    issueId,
    scheduledAt: baseNow.toISOString(),
    executeAt,
    status,
    cancelReason: null,
    abortReason: null,
  };
}

function createHarness(options: {
  config?: NormalizedAutoMergeConfig;
  status?: ReviewStatus | null;
  pendingRows?: AutoMergeRow[];
  getConfig?: AutoMergeSchedulerDeps['getConfig'];
  getStatus?: AutoMergeSchedulerDeps['getStatus'];
  getLabels?: AutoMergeSchedulerDeps['getLabels'];
  getCombinedStatus?: AutoMergeSchedulerDeps['getCombinedStatus'];
  triggerMerge?: AutoMergeSchedulerDeps['triggerMerge'];
} = {}) {
  const rows = new Map<string, AutoMergeRow>();
  for (const pending of options.pendingRows ?? []) rows.set(pending.issueId, { ...pending });

  const deps: AutoMergeSchedulerDeps = {
    now: () => new Date(Date.now()),
    setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
    getConfig: options.getConfig ?? vi.fn().mockResolvedValue(options.config ?? config()),
    getStatus: options.getStatus ?? vi.fn().mockResolvedValue(options.status ?? reviewStatus()),
    getPendingRows: vi.fn(() => [...rows.values()]),
    schedulePending: vi.fn((issueId, executeAt) => {
      if (rows.get(issueId)?.status === 'pending') return false;
      rows.set(issueId, row(issueId, executeAt));
      return true;
    }),
    cancelPending: vi.fn((issueId, reason) => {
      const current = rows.get(issueId);
      if (current?.status !== 'pending') return false;
      rows.set(issueId, { ...current, status: 'cancelled', cancelReason: reason });
      return true;
    }),
    markExecuting: vi.fn((issueId) => {
      const current = rows.get(issueId);
      if (current?.status !== 'pending') return false;
      rows.set(issueId, { ...current, status: 'executing' });
      return true;
    }),
    markExecuted: vi.fn((issueId) => {
      const current = rows.get(issueId);
      if (current) rows.set(issueId, { ...current, status: 'executed' });
    }),
    markAborted: vi.fn((issueId, reason) => {
      const current = rows.get(issueId) ?? row(issueId, baseNow.toISOString());
      rows.set(issueId, { ...current, status: 'aborted', abortReason: reason });
    }),
    markFailed: vi.fn((issueId, reason) => {
      const current = rows.get(issueId) ?? row(issueId, baseNow.toISOString(), 'executing');
      rows.set(issueId, { ...current, status: 'failed', abortReason: reason });
    }),
    getLabels: options.getLabels ?? vi.fn().mockResolvedValue([]),
    getCombinedStatus: options.getCombinedStatus ?? vi.fn().mockResolvedValue({ passing: true }),
    triggerMerge: options.triggerMerge ?? vi.fn().mockResolvedValue({ success: true }),
  };

  return { scheduler: new AutoMergeScheduler(deps), deps, rows };
}

async function scheduleReadyIssue(harness: ReturnType<typeof createHarness>): Promise<void> {
  await expect(harness.scheduler.maybeSchedule('pan-1', 'pan')).resolves.toBe(true);
}

function expectLastTts(payload: Record<string, unknown>): void {
  expect(activityTtsMock).toHaveBeenLastCalledWith(expect.objectContaining(payload));
}

describe('AutoMergeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
    vi.clearAllMocks();
    delete process.env.PANOPTICON_DISABLE_AUTO_MERGE;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PANOPTICON_DISABLE_AUTO_MERGE;
  });

  it('schedules and persists a ready issue', async () => {
    const harness = createHarness();

    await scheduleReadyIssue(harness);

    expect(harness.deps.schedulePending).toHaveBeenCalledWith('PAN-1', '2026-05-23T12:05:00.000Z');
    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'pending', executeAt: '2026-05-23T12:05:00.000Z' });
    expect(appendAsyncMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'merge.auto.scheduled',
      payload: { issueId: 'PAN-1', executeAt: '2026-05-23T12:05:00.000Z', cooldownSeconds: 300 },
    }));
    expect(activityTtsMock).toHaveBeenCalledTimes(1);
    expectLastTts({
      issueId: 'PAN-1',
      utterance: 'Auto merging pan 1 in 5 minutes — say pan merge cancel pan 1 to abort',
      priority: 1,
      source: 'dashboard',
      eventType: 'merge.auto.scheduled',
    });
  });

  it('does not double-schedule an existing pending issue', async () => {
    const harness = createHarness();

    await scheduleReadyIssue(harness);
    await expect(harness.scheduler.maybeSchedule('PAN-1', 'pan')).resolves.toBe(false);

    expect(harness.deps.schedulePending).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(2);
  });

  it('emits a single T-30s reminder when cooldown is greater than one minute', async () => {
    const harness = createHarness();
    await scheduleReadyIssue(harness);
    activityTtsMock.mockClear();

    await vi.advanceTimersByTimeAsync(4 * 60_000 + 30_000);

    expect(activityTtsMock).toHaveBeenCalledTimes(1);
    expectLastTts({
      issueId: 'PAN-1',
      utterance: 'Auto merge of pan 1 in 30 seconds',
      priority: 2,
      source: 'dashboard',
      eventType: 'merge.auto.scheduled',
    });
  });

  it('does not emit a T-30s reminder when cooldown is one minute', async () => {
    const harness = createHarness({ config: config({ cooldownMinutes: 1 }) });
    await scheduleReadyIssue(harness);
    activityTtsMock.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(activityTtsMock).not.toHaveBeenCalled();
  });

  it('cancels during cooldown by clearing the timer and updating the row', async () => {
    const harness = createHarness();
    await scheduleReadyIssue(harness);

    await expect(harness.scheduler.cancel('pan-1', 'operator_cancelled', 'human')).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'cancelled', cancelReason: 'operator_cancelled' });
    expect(harness.deps.triggerMerge).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(appendAsyncMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'merge.auto.cancelled',
      payload: { issueId: 'PAN-1', reason: 'operator_cancelled', cancelledBy: 'human' },
    }));
    expectLastTts({
      issueId: 'PAN-1',
      utterance: 'Auto merge of pan 1 cancelled',
      priority: 1,
      source: 'dashboard',
      eventType: 'merge.auto.cancelled',
    });
  });

  it('fires after cooldown and triggers merge when gates pass', async () => {
    const harness = createHarness();
    await scheduleReadyIssue(harness);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.deps.markExecuting).toHaveBeenCalledWith('PAN-1');
    expect(harness.deps.triggerMerge).toHaveBeenCalledWith('PAN-1');
    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'executed' });
    expect(appendAsyncMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'merge.auto.executed',
      payload: { issueId: 'PAN-1' },
    }));
    expectLastTts({
      issueId: 'PAN-1',
      utterance: 'Auto merging pan 1 now',
      priority: 1,
      source: 'dashboard',
      eventType: 'merge.auto.executing',
    });
  });

  it.each([
    ['ready gate', { getStatus: vi.fn().mockResolvedValueOnce(reviewStatus()).mockResolvedValue(reviewStatus({ readyForMerge: false })) }, 'no-longer-ready'],
    ['label gate', { getLabels: vi.fn().mockResolvedValue(['do-not-merge']) }, 'blocker-label:do-not-merge'],
    ['CI gate', { getCombinedStatus: vi.fn().mockResolvedValue({ passing: false }) }, 'ci-failing'],
    ['timeout gate', { getCombinedStatus: vi.fn().mockRejectedValue(new Error('timeout')) }, 'ci-check-timeout'],
  ])('aborts after cooldown when the %s fails', async (_name, options, expectedReason) => {
    const harness = createHarness(options);
    await scheduleReadyIssue(harness);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.deps.triggerMerge).not.toHaveBeenCalled();
    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'aborted', abortReason: expectedReason });
    expect(appendAsyncMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'merge.auto.aborted',
      payload: { issueId: 'PAN-1', gateFailureReason: expectedReason },
    }));
    expectLastTts({
      issueId: 'PAN-1',
      utterance: `Auto merge of pan 1 aborted — ${expectedReason}`,
      priority: 1,
      source: 'dashboard',
      eventType: 'merge.auto.aborted',
    });
  });

  it('re-arms pending rows on boot', async () => {
    const executeAt = '2026-05-23T12:05:00.000Z';
    const harness = createHarness({ pendingRows: [row('PAN-1', executeAt)] });

    await harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.deps.getPendingRows).toHaveBeenCalledTimes(1);
    expect(harness.deps.triggerMerge).toHaveBeenCalledWith('PAN-1');
  });

  it('aborts stale pending rows on boot without firing', async () => {
    const staleExecuteAt = '2026-05-23T10:59:59.000Z';
    const harness = createHarness({ pendingRows: [row('PAN-1', staleExecuteAt)] });

    await harness.scheduler.start();
    await vi.runAllTimersAsync();

    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'aborted', abortReason: 'stale' });
    expect(harness.deps.triggerMerge).not.toHaveBeenCalled();
    expect(appendAsyncMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'merge.auto.aborted' }));
  });

  it('lets executing win a cancel-vs-fire race without double-triggering merge', async () => {
    let releaseFireConfig!: (value: NormalizedAutoMergeConfig) => void;
    let configCalls = 0;
    const getConfig = vi.fn(() => {
      configCalls += 1;
      if (configCalls === 1) return Promise.resolve(config());
      return new Promise<NormalizedAutoMergeConfig>((resolve) => {
        releaseFireConfig = resolve;
      });
    });
    const harness = createHarness({ getConfig });
    await scheduleReadyIssue(harness);

    const firePromise = (harness.scheduler as unknown as { fire: (issueId: string, projectKey?: string) => Promise<void> }).fire('PAN-1', 'pan');
    await Promise.resolve();
    await expect(harness.scheduler.cancel('PAN-1', 'too_late', 'human')).resolves.toBe(false);
    releaseFireConfig(config());
    await firePromise;

    expect(harness.rows.get('PAN-1')).toMatchObject({ status: 'executed', cancelReason: null });
    expect(harness.deps.triggerMerge).toHaveBeenCalledTimes(1);
  });

  it('makes start and scheduling no-ops when PANOPTICON_DISABLE_AUTO_MERGE is set', async () => {
    process.env.PANOPTICON_DISABLE_AUTO_MERGE = '1';
    const harness = createHarness({ pendingRows: [row('PAN-1', '2026-05-23T12:05:00.000Z')] });

    await harness.scheduler.start();
    await expect(harness.scheduler.maybeSchedule('PAN-2', 'pan')).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.deps.getPendingRows).not.toHaveBeenCalled();
    expect(harness.deps.schedulePending).not.toHaveBeenCalled();
    expect(harness.deps.triggerMerge).not.toHaveBeenCalled();
  });
});
