import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SupervisorWatchdog, type SupervisorWatchdogConfig } from '../watchdog.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testHome: string;

const config: SupervisorWatchdogConfig = {
  enabled: true,
  dashboardApiPort: 3011,
  pollMs: 10_000,
  failThreshold: 1,
  maxRestarts: 3,
  windowMs: 5 * 60_000,
  requestTimeoutMs: 2_000,
};

describe('SupervisorWatchdog', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `panopticon-watchdog-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PANOPTICON_HOME = testHome;
  });

  afterEach(() => {
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it('preserves the restart cap across supervisor restarts', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    let spawns = 0;
    const logs: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const watchdog = new SupervisorWatchdog({
        config,
        now: () => now,
        log: (msg) => logs.push(msg),
        spawnRestart: () => {
          spawns += 1;
          return { pid: 1000 + spawns, error: null };
        },
        fetchFn: async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }),
      });

      await watchdog.checkOnce();
      now += 1_000;
    }

    const restartedSupervisor = new SupervisorWatchdog({
      config,
      now: () => now,
      log: (msg) => logs.push(msg),
      spawnRestart: () => {
        spawns += 1;
        return { pid: 1000 + spawns, error: null };
      },
      fetchFn: async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }),
    });

    await restartedSupervisor.checkOnce();

    expect(spawns).toBe(3);
    expect(restartedSupervisor.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 1,
      gaveUp: true,
    });
    expect(restartedSupervisor.status().restartAttempts).toHaveLength(3);
    expect(logs.some((msg) => msg.includes('WATCHDOG GIVING UP'))).toBe(true);
  });
});
