import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patrolDockerBridgePool: vi.fn(async () => [] as string[]),
  reconcileIdleWorkspaceStacks: vi.fn(async () => [] as string[]),
  reapMergedStrikeWorkspaces: vi.fn(async () => [] as string[]),
  reapOrphanedDashboardServers: vi.fn(async () => [] as string[]),
  reapLeftoverPlaywrightBrowsers: vi.fn(async () => [] as string[]),
  sweepTranscriptRetention: vi.fn(async () => [] as string[]),
  patrolDiskPressure: vi.fn(async () => [] as string[]),
  patrolMemoryPressure: vi.fn(async () => [] as string[]),
  loadCloisterConfigSync: vi.fn(() => ({ retention: { transcript_days: 30 } })),
}));

vi.mock('../../../../src/lib/cloister/bridge-pool-patrol.js', () => ({
  patrolDockerBridgePool: mocks.patrolDockerBridgePool,
}));
vi.mock('../../../../src/lib/cloister/idle-stack-reaper.js', () => ({
  reconcileIdleWorkspaceStacks: mocks.reconcileIdleWorkspaceStacks,
}));
vi.mock('../../../../src/lib/cloister/strike-workspace-reaper.js', () => ({
  reapMergedStrikeWorkspaces: mocks.reapMergedStrikeWorkspaces,
}));
vi.mock('../../../../src/lib/cloister/orphan-dashboard-server-reaper.js', () => ({
  reapOrphanedDashboardServers: mocks.reapOrphanedDashboardServers,
}));
vi.mock('../../../../src/lib/cloister/playwright-mcp-reaper.js', () => ({
  reapLeftoverPlaywrightBrowsers: mocks.reapLeftoverPlaywrightBrowsers,
}));
vi.mock('../../../../src/lib/cloister/transcript-retention.js', () => ({
  sweepTranscriptRetention: mocks.sweepTranscriptRetention,
}));
vi.mock('../../../../src/lib/cloister/disk-pressure-patrol.js', () => ({
  patrolDiskPressure: mocks.patrolDiskPressure,
}));
vi.mock('../../../../src/lib/cloister/memory-pressure-patrol.js', () => ({
  patrolMemoryPressure: mocks.patrolMemoryPressure,
}));
vi.mock('../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

const {
  startHygieneScheduler,
  stopHygieneScheduler,
  isHygieneSchedulerRunning,
} = await import('../../../../src/lib/cloister/hygiene-scheduler.js');

describe('hygiene-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopHygieneScheduler();
    vi.useRealTimers();
  });

  it('is not running until started, and running once started', () => {
    expect(isHygieneSchedulerRunning()).toBe(false);
    startHygieneScheduler();
    expect(isHygieneSchedulerRunning()).toBe(true);
  });

  it('runs every routine once immediately on start', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.patrolDockerBridgePool).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileIdleWorkspaceStacks).toHaveBeenCalledTimes(1);
    expect(mocks.reapMergedStrikeWorkspaces).toHaveBeenCalledTimes(1);
    expect(mocks.reapOrphanedDashboardServers).toHaveBeenCalledTimes(1);
    expect(mocks.reapLeftoverPlaywrightBrowsers).toHaveBeenCalledTimes(1);
    expect(mocks.sweepTranscriptRetention).toHaveBeenCalledTimes(1);
    expect(mocks.patrolDiskPressure).toHaveBeenCalledTimes(1);
    expect(mocks.patrolMemoryPressure).toHaveBeenCalledTimes(1);
  });

  it('fires the 60s-cadence routines (bridge pool, idle stacks, strike GC) on their own interval', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);
    vi.clearAllMocks();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.patrolDockerBridgePool).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileIdleWorkspaceStacks).toHaveBeenCalledTimes(1);
    expect(mocks.reapMergedStrikeWorkspaces).toHaveBeenCalledTimes(1);
    // ~10-minute-cadence routines must not have fired yet.
    expect(mocks.reapOrphanedDashboardServers).not.toHaveBeenCalled();
    expect(mocks.reapLeftoverPlaywrightBrowsers).not.toHaveBeenCalled();
  });

  it('fires the 15s-cadence resource-pressure routines on their own interval', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);
    mocks.patrolDiskPressure.mockClear();
    mocks.patrolMemoryPressure.mockClear();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(mocks.patrolDiskPressure).toHaveBeenCalledTimes(1);
    expect(mocks.patrolMemoryPressure).toHaveBeenCalledTimes(1);
  });

  it('fires the ~10-minute-cadence reapers (dashboard servers, playwright) after 10 minutes', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);
    mocks.reapOrphanedDashboardServers.mockClear();
    mocks.reapLeftoverPlaywrightBrowsers.mockClear();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(mocks.reapOrphanedDashboardServers).toHaveBeenCalledTimes(1);
    expect(mocks.reapLeftoverPlaywrightBrowsers).toHaveBeenCalledTimes(1);
  });

  it('fires the hourly transcript retention sweep after an hour', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);
    mocks.sweepTranscriptRetention.mockClear();

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(mocks.sweepTranscriptRetention).toHaveBeenCalledTimes(1);
    expect(mocks.sweepTranscriptRetention).toHaveBeenCalledWith({ transcriptDays: 30 });
  });

  it('stop() clears every interval — no further firings', async () => {
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);
    vi.clearAllMocks();

    stopHygieneScheduler();
    expect(isHygieneSchedulerRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    for (const mock of Object.values(mocks)) {
      if ('mock' in mock) expect(mock).not.toHaveBeenCalled();
    }
  });

  it('starting twice does not double-schedule', async () => {
    startHygieneScheduler();
    startHygieneScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.patrolDockerBridgePool).toHaveBeenCalledTimes(1);
  });
});
