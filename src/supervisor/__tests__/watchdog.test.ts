import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

function makeWatchdog(overrides: Partial<{
  now: () => number;
  spawns: { count: number };
  logs: string[];
  fetchOk: boolean;
  config: SupervisorWatchdogConfig;
}> = {}): SupervisorWatchdog {
  const spawns = overrides.spawns ?? { count: 0 };
  const logs = overrides.logs ?? [];
  const fetchOk = overrides.fetchOk ?? false;
  return new SupervisorWatchdog({
    config: overrides.config ?? config,
    now: overrides.now ?? (() => Date.parse('2026-05-17T15:30:00.000Z')),
    log: (msg) => logs.push(msg),
    spawnRestart: () => {
      spawns.count += 1;
      return { pid: 1000 + spawns.count, error: null };
    },
    fetchFn: async () => fetchOk
      ? { ok: true, status: 200, statusText: 'OK' }
      : { ok: false, status: 503, statusText: 'Service Unavailable' },
  });
}

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

  it('triggers a restart after three consecutive health failures', async () => {
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      config: { ...config, failThreshold: 3 },
    });

    await watchdog.checkOnce();
    await watchdog.checkOnce();
    expect(spawns.count).toBe(0);

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 3,
      gaveUp: false,
    });
  });

  it('clears consecutive failures and restart attempts on health success', async () => {
    const spawns = { count: 0 };
    await makeWatchdog({ spawns }).checkOnce();
    expect(spawns.count).toBe(1);

    const recovered = makeWatchdog({ spawns, fetchOk: true });
    await recovered.checkOnce();

    expect(recovered.status()).toMatchObject({
      healthy: true,
      consecutiveFailures: 0,
      gaveUp: false,
    });
    expect(recovered.status().restartAttempts).toEqual([]);
  });

  it('preserves the restart cap across supervisor restarts', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const logs: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await makeWatchdog({
        now: () => now,
        spawns,
        logs,
      }).checkOnce();
      now += 1_000;
    }

    const restartedSupervisor = makeWatchdog({
      now: () => now,
      spawns,
      logs,
    });

    await restartedSupervisor.checkOnce();

    expect(spawns.count).toBe(3);
    expect(restartedSupervisor.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 1,
      gaveUp: true,
    });
    expect(restartedSupervisor.status().restartAttempts).toHaveLength(3);
    expect(logs.some((msg) => msg.includes('WATCHDOG GIVING UP'))).toBe(true);
  });

  it('skips a locked restart cycle without consuming an attempt', async () => {
    mkdirSync(testHome, { recursive: true });
    writeFileSync(
      join(testHome, 'restart.lock'),
      `${JSON.stringify({ pid: 1, ts: Date.now(), caller: 'pan reload' })}\n`,
      'utf8',
    );
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({ spawns, logs });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(0);
    expect(watchdog.status().restartAttempts).toEqual([]);
    expect(logs).toContain('watchdog restart skipped: restart lock held');
  });
});
