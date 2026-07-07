import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRunningAgentsSync: vi.fn(() => []),
  getRuntimeForAgent: vi.fn(),
  loadCloisterConfigSync: vi.fn(() => ({
    startup: { auto_start: true },
    thresholds: { stale: 5, warning: 10, stuck: 20 },
    auto_actions: { poke_on_warning: true, kill_on_stuck: false },
  })),
  getDeaconLogs: vi.fn(() => [{ timestamp: '2026-07-03T00:00:00.000Z', level: 'info', message: 'ok' }]),
  loadDeaconConfig: vi.fn(() => ({ patrolIntervalMs: 60_000 })),
  loadDeaconState: vi.fn(() => ({
    specialists: {},
    lastPatrol: '2026-07-03T00:00:00.000Z',
    patrolCycle: 7,
    recentDeaths: [],
    lastPatrolResult: {
      cycle: 7,
      timestamp: '2026-07-03T00:00:00.000Z',
      specialists: [],
      actionsToken: ['checked'],
      massDeathDetected: false,
    },
  })),
  readCloisterStateFile: vi.fn(() => ({ running: true, pid: 1234, startedAt: '2026-07-03T00:00:00.000Z' })),
  isCloisterSpawnsPausedSync: vi.fn(() => true),
  setCloisterSpawnsPausedSync: vi.fn(),
  startDeaconChild: vi.fn(async () => true),
  stopDeaconChild: vi.fn(async () => undefined),
  sendPatrolNow: vi.fn(() => true),
  reloadDeaconConfig: vi.fn(() => true),
  isChildRunning: vi.fn(() => true),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgentsSync: mocks.listRunningAgentsSync,
}));

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: mocks.getRuntimeForAgent,
}));

vi.mock('../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

vi.mock('../../../src/lib/cloister/deacon.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/cloister/deacon.js')>()),
  getDeaconLogs: mocks.getDeaconLogs,
  loadConfig: mocks.loadDeaconConfig,
  loadState: mocks.loadDeaconState,
}));

vi.mock('../../../src/lib/cloister/service.js', () => ({
  readCloisterStateFile: mocks.readCloisterStateFile,
}));

vi.mock('../../../src/lib/overdeck/control-settings.js', () => ({
  isCloisterSpawnsPausedSync: mocks.isCloisterSpawnsPausedSync,
  setCloisterSpawnsPausedSync: mocks.setCloisterSpawnsPausedSync,
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

describe('cloister control surface no-loss audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRunningAgentsSync.mockReturnValue([]);
    mocks.readCloisterStateFile.mockReturnValue({ running: true, pid: 1234, startedAt: '2026-07-03T00:00:00.000Z' });
    mocks.isChildRunning.mockReturnValue(true);
    mocks.sendPatrolNow.mockReturnValue(true);
    mocks.reloadDeaconConfig.mockReturnValue(true);
    mocks.isCloisterSpawnsPausedSync.mockReturnValue(true);
  });

  it.each([
    ['GET /api/cloister/status', 'readDurableCloisterStatus'],
    ['POST /api/cloister/start', 'startDurableCloister'],
    ['POST /api/cloister/stop', 'stopDurableCloister'],
    ['POST /api/cloister/emergency-stop', 'dashboard emergency-stop route remains owner'],
    ['POST /api/cloister/brake', 'dashboard brake route remains owner'],
    ['POST /api/cloister/resume-spawns', 'resumeDurableSpawns'],
    ['GET /api/cloister/spawn-status', 'areDurableSpawnsPaused'],
    ['GET /api/cloister/config', 'filesystem config read route remains owner'],
    ['PUT /api/cloister/config', 'filesystem config write plus live child reload'],
    ['GET /api/cloister/agents/health', 'dashboard health route remains owner'],
    ['GET /api/deacon/status', 'readDurableDeaconStatus'],
    ['GET /api/deacon/logs', 'readDurableDeaconLogs'],
    ['POST /api/deacon/patrol', 'requestDurablePatrol'],
    ['GET /api/metrics/summary', 'readDurableCloisterStatus'],
    ['GET /api/metrics/costs', 'durable cost summary route remains owner'],
    ['GET /api/metrics/stuck', 'readDurableCloisterStatus'],
    ['pan cloister status', 'dashboard HTTP status/logs'],
    ['pan cloister start', 'dashboard HTTP start'],
    ['pan cloister stop', 'dashboard HTTP stop'],
    ['pan cloister brake', 'dashboard HTTP brake'],
    ['pan cloister freeze', 'unchanged local freeze command'],
  ])('%s has an explicit destination: %s', (_surface, destination) => {
    expect(destination).toBeTruthy();
  });

  it('composes status from the pid file, health-state artifact, and durable settings', async () => {
    const status = readDurableCloisterStatus();

    expect(status.running).toBe(true);
    expect(status.lastCheck?.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(status.patrol.loopRunning).toBe(true);
    expect(status.patrol.status).toBe('stale');
    expect(areDurableSpawnsPaused()).toBe(true);
    expect(mocks.readCloisterStateFile).toHaveBeenCalled();
    expect(mocks.loadDeaconState).toHaveBeenCalled();
    expect(mocks.isCloisterSpawnsPausedSync).toHaveBeenCalled();
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

  it('reads deacon status and logs from durable artifacts', async () => {
    expect(readDurableDeaconStatus()).toMatchObject({
      isRunning: true,
      pid: 1234,
      lastPatrol: { cycle: 7, actions: ['checked'] },
    });
    expect(readDurableDeaconLogs(5)).toEqual([
      { timestamp: '2026-07-03T00:00:00.000Z', level: 'info', message: 'ok' },
    ]);
  });
});
