import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWatchdogConfig,
  SupervisorWatchdog,
  type SpawnRestart,
  type SupervisorWatchdogConfig,
} from '../watchdog.js';
import { stampBootReconciliation } from '../../lib/overdeck/control-settings.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

const config: SupervisorWatchdogConfig = {
  enabled: true,
  dashboardApiPort: 3011,
  pollMs: 10_000,
  failThreshold: 1,
  busyFailThreshold: 12,
  maxRestarts: 3,
  windowMs: 5 * 60_000,
  requestTimeoutMs: 2_000,
  bootGraceMs: 0,
};

function makeWatchdog(overrides: Partial<{
  now: () => number;
  spawns: { count: number };
  logs: string[];
  fetchOk: boolean;
  fetchTimeout: boolean;
  healthBody: unknown;
  deaconStatus: unknown;
  spawnOptions: Array<Parameters<SpawnRestart>[0]>;
  config: SupervisorWatchdogConfig;
  evictPortHoldersFn: (port: number) => Promise<{ pids: number[]; error: string | null }>;
}> = {}): SupervisorWatchdog {
  const spawns = overrides.spawns ?? { count: 0 };
  const logs = overrides.logs ?? [];
  const fetchOk = overrides.fetchOk ?? false;
  const fetchTimeout = overrides.fetchTimeout ?? false;
  const healthBody = overrides.healthBody;
  const deaconStatus = overrides.deaconStatus ?? {
    isRunning: true,
    config: { patrolIntervalMs: 60_000 },
    state: { lastPatrol: '2026-05-17T15:29:00.000Z' },
  };
  return new SupervisorWatchdog({
    config: overrides.config ?? config,
    now: overrides.now ?? (() => Date.parse('2026-05-17T15:30:00.000Z')),
    log: (msg) => logs.push(msg),
    spawnRestart: (options) => {
      overrides.spawnOptions?.push(options);
      spawns.count += 1;
      return { pid: 1000 + spawns.count, error: null };
    },
    evictPortHoldersFn: overrides.evictPortHoldersFn,
    fetchFn: async (input) => {
      if (input.endsWith('/api/deacon/status')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => deaconStatus,
        };
      }
      if (fetchTimeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return fetchOk
        ? {
            ok: true,
            status: 200,
            statusText: 'OK',
            ...(healthBody === undefined ? {} : { json: async () => healthBody }),
          }
        : { ok: false, status: 503, statusText: 'Service Unavailable' };
    },
  });
}

describe('SupervisorWatchdog', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `overdeck-watchdog-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
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

  it('does not restart on timeout failures at failThreshold — only at busyFailThreshold', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      fetchTimeout: true,
      config: { ...config, failThreshold: 3, busyFailThreshold: 5 },
    });

    for (let i = 0; i < 4; i += 1) {
      await watchdog.checkOnce();
    }
    expect(spawns.count).toBe(0);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 4,
      consecutiveHardFailures: 0,
    });
    expect(logs.some((msg) => msg.includes('deferring restart'))).toBe(true);

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(logs.some((msg) => msg.includes('dashboard starved'))).toBe(true);
  });

  it('restarts at failThreshold when failures are hard (server actually down)', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      config: { ...config, failThreshold: 3, busyFailThreshold: 12 },
    });

    await watchdog.checkOnce();
    await watchdog.checkOnce();
    expect(spawns.count).toBe(0);

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status().consecutiveHardFailures).toBe(3);
    expect(logs.some((msg) => msg.includes('dashboard unreachable'))).toBe(true);
  });

  it('defers hard-failure restart during boot grace before first healthy check', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      now: () => now,
      config: { ...config, failThreshold: 3, bootGraceMs: 300_000 },
    });

    await watchdog.checkOnce();
    now += 1_000;
    await watchdog.checkOnce();
    now += 1_000;
    await watchdog.checkOnce();

    expect(spawns.count).toBe(0);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 3,
      consecutiveHardFailures: 3,
    });
    expect(logs.some((msg) => msg.includes('deferring restart during boot grace'))).toBe(true);
  });

  it('restarts after hard failures once the dashboard has been healthy', async () => {
    let fetchOk = true;
    const spawns = { count: 0 };
    const watchdog = new SupervisorWatchdog({
      config: { ...config, failThreshold: 3, bootGraceMs: 300_000 },
      now: () => Date.parse('2026-05-17T15:30:00.000Z'),
      log: () => undefined,
      spawnRestart: () => {
        spawns.count += 1;
        return { pid: 1000 + spawns.count, error: null };
      },
      fetchFn: async (input) => {
        if (input.endsWith('/api/deacon/status')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              isRunning: true,
              config: { patrolIntervalMs: 60_000 },
              state: { lastPatrol: '2026-05-17T15:29:00.000Z' },
            }),
          };
        }
        return fetchOk
          ? { ok: true, status: 200, statusText: 'OK' }
          : { ok: false, status: 503, statusText: 'Service Unavailable' };
      },
    });

    await watchdog.checkOnce();
    fetchOk = false;
    await watchdog.checkOnce();
    await watchdog.checkOnce();
    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
  });

  it('restarts a never-healthy dashboard after boot grace expires', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      now: () => now,
      config: { ...config, failThreshold: 3, bootGraceMs: 10_000 },
    });

    await watchdog.checkOnce();
    now += 1_000;
    await watchdog.checkOnce();
    now += 10_000;
    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
  });

  it('starts a fresh boot-grace window after a watchdog restart', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      now: () => now,
      config: { ...config, failThreshold: 1, bootGraceMs: 10_000 },
    });

    now += 10_001;
    await watchdog.checkOnce();
    expect(spawns.count).toBe(1);

    now += 1_000;
    await watchdog.checkOnce();
    expect(spawns.count).toBe(1);

    now += 10_000;
    await watchdog.checkOnce();
    expect(spawns.count).toBe(2);
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

  it('treats a peer dashboard health response as a hard failure', async () => {
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      fetchOk: true,
      config: {
        ...config,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      },
      healthBody: { status: 'ok', repoRoot: '/repo', mode: 'peer' },
      evictPortHoldersFn: async () => ({ pids: [4242], error: null }),
    });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 1,
      consecutiveHardFailures: 1,
    });
    expect(watchdog.status().lastError).toContain('mode=peer');
  });

  it('treats a foreign repoRoot health response as unhealthy', async () => {
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      fetchOk: true,
      config: {
        ...config,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      },
      healthBody: { status: 'ok', repoRoot: '/other-repo', mode: 'primary' },
      evictPortHoldersFn: async () => ({ pids: [4242], error: null }),
    });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 1,
      consecutiveHardFailures: 1,
    });
    expect(watchdog.status().lastError).toContain('/other-repo');
  });

  it('evicts a health-verified foreign dashboard before restarting the primary', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const evict = vi.fn(async () => ({ pids: [15589], error: null }));
    const watchdog = makeWatchdog({
      spawns,
      logs,
      fetchOk: true,
      config: { ...config, failThreshold: 3, expectedIdentity: { repoRoot: '/repo', mode: 'primary' } },
      healthBody: { status: 'ok', repoRoot: '/repo/workspaces/feature-pan-2542', mode: 'primary' },
      evictPortHoldersFn: evict,
    });

    await watchdog.checkOnce();

    expect(evict).toHaveBeenCalledWith(3011);
    expect(logs).toContain('watchdog evicted foreign dashboard PID(s) 15589 from port 3011 with SIGTERM');
    expect(spawns.count).toBe(1);
  });

  it('emits a needs-you escalation when foreign-dashboard eviction fails', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      fetchOk: true,
      config: { ...config, expectedIdentity: { repoRoot: '/repo', mode: 'primary' } },
      healthBody: { status: 'ok', repoRoot: '/other-repo', mode: 'primary' },
      evictPortHoldersFn: async () => ({ pids: [], error: 'no holder PID found for port 3011' }),
    });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(0);
    expect(watchdog.status().gaveUp).toBe(true);
    expect(logs.some((message) => message.startsWith('NEEDS YOU:'))).toBe(true);
  });

  it('marks a matching primary dashboard health response healthy', async () => {
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      fetchOk: true,
      config: {
        ...config,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      },
      healthBody: { status: 'ok', repoRoot: '/repo', mode: 'primary' },
    });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(0);
    expect(watchdog.status()).toMatchObject({
      healthy: true,
      consecutiveFailures: 0,
      consecutiveHardFailures: 0,
    });
  });

  it('defers restart when dashboard health is OK but deacon patrol heartbeat is stale', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      fetchOk: true,
      config: { ...config, failThreshold: 1, busyFailThreshold: 3 },
      now: () => Date.parse('2026-05-17T15:35:00.000Z'),
      deaconStatus: {
        isRunning: true,
        config: { patrolIntervalMs: 60_000 },
        state: { lastPatrol: '2026-05-17T15:30:00.000Z' },
      },
    });

    await watchdog.checkOnce();
    await watchdog.checkOnce();

    expect(spawns.count).toBe(0);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 2,
      consecutiveHardFailures: 0,
    });
    expect(logs.some((msg) => msg.includes('deferring restart until 3'))).toBe(true);

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status()).toMatchObject({
      healthy: false,
      consecutiveFailures: 3,
      consecutiveHardFailures: 0,
    });
    expect(watchdog.status().lastError).toContain('deacon patrol heartbeat stale');
    expect(logs.some((msg) => msg.includes('deacon patrol heartbeat stale'))).toBe(true);
  });

  it('does not apply boot grace to deacon patrol stale restarts', async () => {
    const spawns = { count: 0 };
    const logs: string[] = [];
    const watchdog = makeWatchdog({
      spawns,
      logs,
      fetchOk: true,
      config: {
        ...config,
        busyFailThreshold: 1,
        bootGraceMs: 300_000,
      },
      now: () => Date.parse('2026-05-17T15:35:00.000Z'),
      deaconStatus: {
        isRunning: true,
        config: { patrolIntervalMs: 60_000 },
        state: { lastPatrol: '2026-05-17T15:30:00.000Z' },
      },
    });

    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(logs.some((msg) => msg.includes('deferring restart during boot grace'))).toBe(false);
    expect(logs.some((msg) => msg.includes('deacon patrol heartbeat stale'))).toBe(true);
  });

  it('ends boot grace after the first successful health response even when deacon patrol is stale', async () => {
    let fetchOk = true;
    let now = Date.parse('2026-05-17T15:35:00.000Z');
    const spawns = { count: 0 };
    const watchdog = new SupervisorWatchdog({
      config: { ...config, failThreshold: 3, busyFailThreshold: 12, bootGraceMs: 300_000 },
      now: () => now,
      log: () => undefined,
      spawnRestart: () => {
        spawns.count += 1;
        return { pid: 1000 + spawns.count, error: null };
      },
      fetchFn: async (input) => {
        if (input.endsWith('/api/deacon/status')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              isRunning: true,
              config: { patrolIntervalMs: 60_000 },
              state: { lastPatrol: '2026-05-17T15:30:00.000Z' },
            }),
          };
        }
        return fetchOk
          ? { ok: true, status: 200, statusText: 'OK' }
          : { ok: false, status: 503, statusText: 'Service Unavailable' };
      },
    });

    await watchdog.checkOnce();
    expect(spawns.count).toBe(0);

    fetchOk = false;
    now += 1_000;
    await watchdog.checkOnce();
    now += 1_000;
    await watchdog.checkOnce();
    now += 1_000;
    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
  });

  it('waits three patrol intervals before restarting a missing initial patrol heartbeat', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      fetchOk: true,
      config: { ...config, busyFailThreshold: 3 },
      now: () => now,
      deaconStatus: {
        isRunning: true,
        config: { patrolIntervalMs: 60_000 },
        state: {},
      },
    });

    await watchdog.checkOnce();
    now += 180_000;
    await watchdog.checkOnce();
    expect(spawns.count).toBe(0);

    now += 1_000;
    await watchdog.checkOnce();

    expect(spawns.count).toBe(1);
    expect(watchdog.status().lastError).toContain('deacon patrol heartbeat missing');
  });

  it('grants a fresh patrol-grace window after a triggered restart (PAN-2219)', async () => {
    let now = Date.parse('2026-05-17T15:30:00.000Z');
    const spawns = { count: 0 };
    const watchdog = makeWatchdog({
      spawns,
      fetchOk: true,
      config: { ...config, busyFailThreshold: 1 },
      now: () => now,
      deaconStatus: {
        isRunning: true,
        config: { patrolIntervalMs: 60_000 },
        state: {},
      },
    });

    await watchdog.checkOnce(); // starts the missing-heartbeat clock
    now += 180_001;
    await watchdog.checkOnce(); // exceeds grace → restart #1
    expect(spawns.count).toBe(1);

    // The freshly restarted server must get its own full grace window; the
    // pre-restart staleness clock must not carry over and kill it instantly.
    now += 1_000;
    await watchdog.checkOnce();
    expect(spawns.count).toBe(1);
    now += 170_000; // 171s into the new window — still within grace
    await watchdog.checkOnce();
    expect(spawns.count).toBe(1);
    now += 10_001; // past 180s since the restart → second restart is legitimate
    await watchdog.checkOnce();
    expect(spawns.count).toBe(2);
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

  it('passes the persisted boot id to watchdog restart spawns', async () => {
    mkdirSync(testHome, { recursive: true });
    stampBootReconciliation(
      'boot-watchdog',
      '2026-05-17T15:30:30.000Z',
      '2026-05-17T15:30:00.000Z',
    );
    const spawnOptions: Array<Parameters<SpawnRestart>[0]> = [];

    await makeWatchdog({ spawnOptions }).checkOnce();

    expect(spawnOptions[0]).toMatchObject({
      restartLockHeld: true,
      bootId: 'boot-watchdog',
    });
  });

  it('parses supervisor boot-grace environment configuration', () => {
    expect(readWatchdogConfig({}, 3011).bootGraceMs).toBe(300_000);
    expect(readWatchdogConfig({ OVERDECK_SUPERVISOR_BOOT_GRACE_MS: '45000' }, 3011).bootGraceMs).toBe(45_000);
  });

  it('waits for a restart that completes after a 60s dashboard boot', async () => {
    mkdirSync(testHome, { recursive: true });
    let resolveSpawned: () => void = () => {};
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });
    try {
      const logs: string[] = [];
      const watchdog = new SupervisorWatchdog({
        config,
        now: () => Date.parse('2026-05-17T15:30:00.000Z'),
        log: (msg) => logs.push(msg),
        spawnRestart: () => {
          vi.useFakeTimers();
          resolveSpawned();
          return {
            pid: 1001,
            error: null,
            done: new Promise<void>((resolve) => {
              setTimeout(resolve, 60_000);
            }),
          };
        },
        fetchFn: async (input) => {
          if (input.endsWith('/api/deacon/status')) {
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({
                isRunning: true,
                config: { patrolIntervalMs: 60_000 },
                state: { lastPatrol: '2026-05-17T15:29:00.000Z' },
              }),
            };
          }
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        },
      });

      const check = watchdog.checkOnce();
      await spawned;
      await vi.advanceTimersByTimeAsync(59_000);
      expect(logs).toContain('watchdog spawned pan restart --dashboard (pid 1001)');
      expect(logs.some((msg) => msg.includes('watchdog restart failed'))).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await check;

      expect(logs.some((msg) => msg.includes('watchdog restart failed'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
