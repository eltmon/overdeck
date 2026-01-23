/**
 * Tests for deacon.ts queue processing - PAN-74
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  checkSpecialistHealth,
  forceKillSpecialist,
  checkMassDeath,
  runPatrol,
  startDeacon,
  stopDeacon,
  isDeaconRunning,
  getDeaconStatus,
  type DeaconConfig,
  type DeaconState,
} from '../../../src/lib/cloister/deacon.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from '../../../src/lib/paths.js';

const DEACON_DIR = join(PANOPTICON_HOME, 'deacon');
const STATE_FILE = join(DEACON_DIR, 'health-state.json');
const CONFIG_FILE = join(DEACON_DIR, 'config.json');

// Mock specialist functions for testing
vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn(() => []),
  getTmuxSessionName: vi.fn((name) => `specialist-${name}`),
  isRunning: vi.fn(() => false),
  isIdleAtPrompt: vi.fn(() => false),
  initializeSpecialist: vi.fn(async () => ({ success: true, message: 'Initialized' })),
  checkSpecialistQueue: vi.fn(() => ({ hasWork: false, urgentCount: 0, items: [] })),
  getNextSpecialistTask: vi.fn(() => null),
  wakeSpecialistWithTask: vi.fn(async () => ({ success: true, message: 'Woken' })),
  completeSpecialistTask: vi.fn(() => true),
}));

describe('Deacon Configuration', () => {
  beforeEach(() => {
    // Clean up test files
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  });

  afterEach(() => {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  });

  it('should load default config when file does not exist', () => {
    const config = loadConfig();

    expect(config.pingTimeoutMs).toBe(30_000);
    expect(config.consecutiveFailures).toBe(3);
    expect(config.cooldownMs).toBe(5 * 60_000);
    expect(config.patrolIntervalMs).toBe(30_000);
    expect(config.massDeathThreshold).toBe(2);
    expect(config.massDeathWindowMs).toBe(60_000);
  });

  it('should save and load config', () => {
    const customConfig: Partial<DeaconConfig> = {
      pingTimeoutMs: 60_000,
      consecutiveFailures: 5,
    };

    saveConfig(customConfig);
    const loaded = loadConfig();

    expect(loaded.pingTimeoutMs).toBe(60_000);
    expect(loaded.consecutiveFailures).toBe(5);
    // Other values should still be defaults
    expect(loaded.cooldownMs).toBe(5 * 60_000);
  });

  it('should merge custom config with defaults', () => {
    saveConfig({ pingTimeoutMs: 45_000 });
    const config = loadConfig();

    expect(config.pingTimeoutMs).toBe(45_000);
    expect(config.consecutiveFailures).toBe(3); // Still default
  });
});

describe('Deacon State Management', () => {
  beforeEach(() => {
    // Clean up test files
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
    if (!existsSync(DEACON_DIR)) {
      mkdirSync(DEACON_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  it('should load empty state when file does not exist', () => {
    const state = loadState();

    expect(state.specialists).toBeDefined();
    expect(state.patrolCycle).toBe(0);
    expect(state.recentDeaths).toHaveLength(0);
  });

  it('should save and load state', () => {
    const state: DeaconState = {
      specialists: {
        'test-agent': {
          specialistName: 'test-agent',
          consecutiveFailures: 2,
          forceKillCount: 1,
          lastPingTime: new Date().toISOString(),
        },
      },
      patrolCycle: 5,
      recentDeaths: [new Date().toISOString()],
    };

    saveState(state);
    const loaded = loadState();

    expect(loaded.patrolCycle).toBe(5);
    expect(loaded.recentDeaths).toHaveLength(1);
    expect(loaded.specialists['test-agent']).toBeDefined();
    expect(loaded.specialists['test-agent'].consecutiveFailures).toBe(2);
  });
});

describe('checkSpecialistHealth', () => {
  beforeEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  afterEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  it('should report not running when specialist is not active', () => {
    const { isRunning } = require('../../../src/lib/cloister/specialists.js');
    vi.mocked(isRunning).mockReturnValue(false);

    const result = checkSpecialistHealth('test-agent');

    expect(result.isResponsive).toBe(false);
    expect(result.wasRunning).toBe(false);
    expect(result.shouldForceKill).toBe(false);
  });

  it('should increment failure count on unresponsive specialist', () => {
    const { isRunning } = require('../../../src/lib/cloister/specialists.js');
    vi.mocked(isRunning).mockReturnValue(true);

    // First failure
    const result1 = checkSpecialistHealth('test-agent');
    expect(result1.consecutiveFailures).toBe(1);
    expect(result1.shouldForceKill).toBe(false);

    // Second failure
    const result2 = checkSpecialistHealth('test-agent');
    expect(result2.consecutiveFailures).toBe(2);
    expect(result2.shouldForceKill).toBe(false);

    // Third failure - should trigger force kill
    const result3 = checkSpecialistHealth('test-agent');
    expect(result3.consecutiveFailures).toBe(3);
    expect(result3.shouldForceKill).toBe(true);
  });

  it('should not force kill during cooldown period', () => {
    const { isRunning } = require('../../../src/lib/cloister/specialists.js');
    vi.mocked(isRunning).mockReturnValue(true);

    // Simulate a previous force kill
    const state = loadState();
    state.specialists['test-agent'] = {
      specialistName: 'test-agent',
      consecutiveFailures: 3,
      forceKillCount: 1,
      lastForceKillTime: new Date().toISOString(), // Just killed
    };
    saveState(state);

    const result = checkSpecialistHealth('test-agent');

    expect(result.shouldForceKill).toBe(false);
    expect(result.inCooldown).toBe(true);
    expect(result.cooldownRemainingMs).toBeGreaterThan(0);
  });
});

describe('forceKillSpecialist', () => {
  beforeEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  afterEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  it('should not kill during cooldown', () => {
    // Set up a specialist that was just killed
    const state = loadState();
    state.specialists['test-agent'] = {
      specialistName: 'test-agent',
      consecutiveFailures: 3,
      forceKillCount: 1,
      lastForceKillTime: new Date().toISOString(),
    };
    saveState(state);

    const result = forceKillSpecialist('test-agent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('cooldown');
  });

  it('should record death timestamp for mass death detection', () => {
    const result = forceKillSpecialist('test-agent');

    const state = loadState();
    expect(state.recentDeaths.length).toBeGreaterThan(0);
  });
});

describe('checkMassDeath', () => {
  beforeEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  afterEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  it('should not detect mass death with few deaths', () => {
    const state = loadState();
    state.recentDeaths = [new Date().toISOString()];
    saveState(state);

    const result = checkMassDeath();

    expect(result.isMassDeath).toBe(false);
    expect(result.deathCount).toBe(1);
  });

  it('should detect mass death with multiple deaths in window', () => {
    const now = Date.now();
    const state = loadState();
    state.recentDeaths = [
      new Date(now - 10000).toISOString(), // 10s ago
      new Date(now - 5000).toISOString(),  // 5s ago
      new Date(now).toISOString(),         // now
    ];
    saveState(state);

    const result = checkMassDeath();

    expect(result.isMassDeath).toBe(true);
    expect(result.deathCount).toBeGreaterThanOrEqual(2);
    expect(result.message).toContain('ALERT');
  });

  it('should prune old deaths outside window', () => {
    const now = Date.now();
    const state = loadState();
    state.recentDeaths = [
      new Date(now - 120000).toISOString(), // 2 minutes ago (outside 1 min window)
      new Date(now).toISOString(),          // now
    ];
    saveState(state);

    checkMassDeath();

    const updatedState = loadState();
    expect(updatedState.recentDeaths.length).toBe(1); // Old death pruned
  });

  it('should respect alert cooldown', () => {
    const now = Date.now();
    const state = loadState();
    state.recentDeaths = [
      new Date(now - 10000).toISOString(),
      new Date(now - 5000).toISOString(),
      new Date(now).toISOString(),
    ];
    state.lastMassDeathAlert = new Date(now - 60000).toISOString(); // 1 min ago
    saveState(state);

    const result = checkMassDeath();

    // Should detect mass death but note already alerted
    expect(result.isMassDeath).toBe(true);
    expect(result.message).toContain('already alerted');
  });
});

describe('runPatrol', () => {
  beforeEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  });

  it('should increment patrol cycle', async () => {
    const { getEnabledSpecialists } = require('../../../src/lib/cloister/specialists.js');
    vi.mocked(getEnabledSpecialists).mockReturnValue([]);

    const result1 = await runPatrol();
    expect(result1.cycle).toBe(1);

    const result2 = await runPatrol();
    expect(result2.cycle).toBe(2);
  });

  it('should check all enabled specialists', async () => {
    const { getEnabledSpecialists, isRunning } = require('../../../src/lib/cloister/specialists.js');
    vi.mocked(getEnabledSpecialists).mockReturnValue([
      { name: 'test-agent', enabled: true },
      { name: 'review-agent', enabled: true },
    ]);
    vi.mocked(isRunning).mockReturnValue(false);

    const result = await runPatrol();

    expect(result.specialists).toHaveLength(2);
    expect(result.specialists[0].specialistName).toBe('test-agent');
    expect(result.specialists[1].specialistName).toBe('review-agent');
  });

  it('should process queued tasks when specialist is idle', async () => {
    const {
      getEnabledSpecialists,
      isRunning,
      isIdleAtPrompt,
      checkSpecialistQueue,
      getNextSpecialistTask,
      wakeSpecialistWithTask,
      completeSpecialistTask,
    } = require('../../../src/lib/cloister/specialists.js');

    vi.mocked(getEnabledSpecialists).mockReturnValue([
      { name: 'test-agent', enabled: true },
    ]);
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(isIdleAtPrompt).mockResolvedValue(true); // Idle
    vi.mocked(checkSpecialistQueue).mockReturnValue({
      hasWork: true,
      urgentCount: 1,
      items: [
        {
          id: 'task-1',
          type: 'task',
          priority: 'urgent',
          source: 'handoff',
          payload: { issueId: 'PAN-74' },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(getNextSpecialistTask).mockReturnValue({
      id: 'task-1',
      type: 'task',
      priority: 'urgent',
      source: 'handoff',
      payload: { issueId: 'PAN-74' },
      createdAt: new Date().toISOString(),
    });
    vi.mocked(wakeSpecialistWithTask).mockResolvedValue({
      success: true,
      message: 'Task sent',
      tmuxSession: 'test-agent',
      wasAlreadyRunning: true,
    });

    const result = await runPatrol();

    expect(wakeSpecialistWithTask).toHaveBeenCalledWith('test-agent', {
      issueId: 'PAN-74',
      branch: undefined,
      workspace: undefined,
      prUrl: undefined,
      context: undefined,
    });
    expect(completeSpecialistTask).toHaveBeenCalledWith('test-agent', 'task-1');
    expect(result.actionsToken).toContain('Processed queued task for test-agent: PAN-74');
  });

  it('should not process queue when specialist is busy', async () => {
    const {
      getEnabledSpecialists,
      isRunning,
      isIdleAtPrompt,
      checkSpecialistQueue,
      wakeSpecialistWithTask,
    } = require('../../../src/lib/cloister/specialists.js');

    vi.mocked(getEnabledSpecialists).mockReturnValue([
      { name: 'test-agent', enabled: true },
    ]);
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(isIdleAtPrompt).mockResolvedValue(false); // Busy
    vi.mocked(checkSpecialistQueue).mockReturnValue({
      hasWork: true,
      urgentCount: 1,
      items: [{ id: 'task-1', payload: { issueId: 'PAN-74' } }],
    });

    await runPatrol();

    // Should not wake specialist since it's busy
    expect(wakeSpecialistWithTask).not.toHaveBeenCalled();
  });
});

describe('Deacon Lifecycle', () => {
  afterEach(() => {
    stopDeacon();
  });

  it('should start and stop deacon', () => {
    expect(isDeaconRunning()).toBe(false);

    startDeacon();
    expect(isDeaconRunning()).toBe(true);

    stopDeacon();
    expect(isDeaconRunning()).toBe(false);
  });

  it('should not start twice', () => {
    startDeacon();
    expect(isDeaconRunning()).toBe(true);

    // Try to start again (should log warning)
    startDeacon();
    expect(isDeaconRunning()).toBe(true);

    stopDeacon();
  });

  it('should return status', () => {
    const status1 = getDeaconStatus();
    expect(status1.isRunning).toBe(false);

    startDeacon();

    const status2 = getDeaconStatus();
    expect(status2.isRunning).toBe(true);
    expect(status2.config).toBeDefined();
    expect(status2.state).toBeDefined();

    stopDeacon();
  });
});
