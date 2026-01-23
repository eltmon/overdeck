/**
 * Tests for deacon.ts configuration and state management - PAN-74
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  checkMassDeath,
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
    // consecutiveFailures should still be default (saved config persists)
    expect(config.consecutiveFailures).toBeGreaterThan(0);
  });

  it('should persist config across multiple loads', () => {
    saveConfig({ pingTimeoutMs: 90_000 });

    const config1 = loadConfig();
    const config2 = loadConfig();

    expect(config1.pingTimeoutMs).toBe(90_000);
    expect(config2.pingTimeoutMs).toBe(90_000);
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

  it('should preserve specialist state across saves', () => {
    const state1 = loadState();
    state1.specialists['review-agent'] = {
      specialistName: 'review-agent',
      consecutiveFailures: 1,
      forceKillCount: 0,
    };
    saveState(state1);

    const state2 = loadState();
    state2.specialists['merge-agent'] = {
      specialistName: 'merge-agent',
      consecutiveFailures: 0,
      forceKillCount: 2,
    };
    saveState(state2);

    const final = loadState();
    expect(final.specialists['review-agent']).toBeDefined();
    expect(final.specialists['merge-agent']).toBeDefined();
  });
});

describe('checkMassDeath', () => {
  beforeEach(() => {
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

  it('should handle empty death list', () => {
    const state = loadState();
    state.recentDeaths = [];
    saveState(state);

    const result = checkMassDeath();

    expect(result.isMassDeath).toBe(false);
    expect(result.deathCount).toBe(0);
  });

  it('should update lastMassDeathAlert on new alert', () => {
    const now = Date.now();
    const state = loadState();
    state.recentDeaths = [
      new Date(now - 10000).toISOString(),
      new Date(now - 5000).toISOString(),
      new Date(now).toISOString(),
    ];
    // No previous alert
    delete state.lastMassDeathAlert;
    saveState(state);

    const result = checkMassDeath();

    expect(result.isMassDeath).toBe(true);

    const updatedState = loadState();
    expect(updatedState.lastMassDeathAlert).toBeDefined();
  });
});

describe('Deacon Status', () => {
  it('should return status when not running', () => {
    const status = getDeaconStatus();

    expect(status.isRunning).toBe(false);
    expect(status.config).toBeDefined();
    expect(status.state).toBeDefined();
  });

  it('should report not running initially', () => {
    expect(isDeaconRunning()).toBe(false);
  });
});
