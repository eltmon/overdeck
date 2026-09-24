import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  getRuntimeForAgent: vi.fn(),
  loadCloisterConfigSync: vi.fn(() => ({
    startup: { auto_start: true },
    thresholds: { stale: 5, warning: 10, stuck: 20 },
    auto_actions: { poke_on_warning: true, kill_on_stuck: false },
  })),
  getDeaconLiteStatus: vi.fn(() => ({
    running: true,
    intervalMs: 60_000,
    lastRunAt: '2026-07-03T00:00:00.000Z',
    lastRunError: null,
  })),
  readCloisterStateFile: vi.fn(() => ({ running: true, pid: 1234, startedAt: '2026-07-03T00:00:00.000Z' })),
  isCloisterSpawnsPaused: vi.fn(() => true),
  setCloisterSpawnsPaused: vi.fn(),
  startDeaconChild: vi.fn(async () => true),
  stopDeaconChild: vi.fn(async () => undefined),
  sendPatrolNow: vi.fn(() => true),
  reloadDeaconConfig: vi.fn(() => true),
  isChildRunning: vi.fn(() => true),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
}));

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: mocks.getRuntimeForAgent,
}));

vi.mock('../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

vi.mock('../../../src/lib/cloister/deacon-lite.js', () => ({
  getDeaconLiteStatus: mocks.getDeaconLiteStatus,
}));

vi.mock('../../../src/lib/cloister/service.js', () => ({
  readCloisterStateFile: mocks.readCloisterStateFile,
}));

vi.mock('../../../src/lib/overdeck/control-settings.js', () => ({
  isCloisterSpawnsPaused: mocks.isCloisterSpawnsPaused,
  setCloisterSpawnsPaused: mocks.setCloisterSpawnsPaused,
}));

vi.mock('../../../src/dashboard/server/services/deacon-supervisor.js', () => ({
  startDeaconChild: mocks.startDeaconChild,
  stopDeaconChild: mocks.stopDeaconChild,
  sendPatrolNow: mocks.sendPatrolNow,
  reloadDeaconConfig: mocks.reloadDeaconConfig,
  isChildRunning: mocks.isChildRunning,
}));

// Import once at module scope; vi.mock hoisting ensures mocks are wired.
const controlSurface = await import('../../../src/dashboard/server/services/cloister-control-surface.js');
const {
  readDurableCloisterStatus,
  areDurableSpawnsPaused,
  requestDurablePatrol,
  startDurableCloister,
  stopDurableCloister,
  reloadDurableCloisterConfig,
  readDurableDeaconLogs,
  readDurableDeaconStatus,
} = controlSurface;

describe('cloister control surface (PAN-3917 W4: shrunk to deacon-lite\'s surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.readCloisterStateFile.mockReturnValue({ running: true, pid: 1234, startedAt: '2026-07-03T00:00:00.000Z' });
    mocks.getDeaconLiteStatus.mockReturnValue({
      running: true,
      intervalMs: 60_000,
      lastRunAt: '2026-07-03T00:00:00.000Z',
      lastRunError: null,
    });
    mocks.isChildRunning.mockReturnValue(true);
    mocks.sendPatrolNow.mockReturnValue(true);
    mocks.reloadDeaconConfig.mockReturnValue(true);
    mocks.isCloisterSpawnsPaused.mockReturnValue(true);
  });

  it('composes status from the pid file and deacon-lite\'s in-memory status', async () => {
    const status = await readDurableCloisterStatus();

    expect(status.running).toBe(true);
    expect(status.lastCheck?.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(status.patrol.running).toBe(true);
    expect(status.patrol.intervalMs).toBe(60_000);
    expect(areDurableSpawnsPaused()).toBe(true);
    expect(mocks.readCloisterStateFile).toHaveBeenCalled();
    expect(mocks.getDeaconLiteStatus).toHaveBeenCalled();
    expect(mocks.isCloisterSpawnsPaused).toHaveBeenCalled();
  });

  it('uses the supervisor for start, stop, and manual patrol', async () => {
    await expect(startDurableCloister()).resolves.toBe(true);
    await expect(stopDurableCloister()).resolves.toBeUndefined();
    expect(requestDurablePatrol()).toEqual({ accepted: true });
    expect(mocks.startDeaconChild).toHaveBeenCalled();
    expect(mocks.stopDeaconChild).toHaveBeenCalled();
    expect(mocks.sendPatrolNow).toHaveBeenCalled();
  });

  it('returns not accepted for manual patrol when no child is running', async () => {
    mocks.isChildRunning.mockReturnValue(false);

    expect(requestDurablePatrol()).toEqual({ accepted: false });
    expect(mocks.sendPatrolNow).not.toHaveBeenCalled();
  });

  it('requests live config reload through the child supervisor', async () => {
    expect(reloadDurableCloisterConfig()).toEqual({ accepted: true });
    expect(mocks.reloadDeaconConfig).toHaveBeenCalled();
  });

  it('does not request live config reload when no child is running', async () => {
    mocks.isChildRunning.mockReturnValue(false);

    expect(reloadDurableCloisterConfig()).toEqual({ accepted: false });
    expect(mocks.reloadDeaconConfig).not.toHaveBeenCalled();
  });

  it('reads deacon-lite status; logs are always empty (no patrol-result aggregation)', async () => {
    expect(readDurableDeaconStatus()).toMatchObject({
      isRunning: true,
      pid: 1234,
      startedAt: '2026-07-03T00:00:00.000Z',
      deaconLite: { running: true, intervalMs: 60_000 },
    });
    expect(readDurableDeaconLogs(5)).toEqual([]);
  });
});
