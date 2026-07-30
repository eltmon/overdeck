import { Effect } from 'effect';
/**
 * Tests for src/lib/platform-lifecycle.ts.
 *
 * The scope invariants below are the whole point of this module — `pan restart`
 * exists so a dashboard restart cannot tear down CLIProxy, Traefik, or TLDR.
 * If these tests start failing it means scope leakage has been introduced and
 * the restart/recovery design is broken.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  restartCliproxy,
  restartDashboard,
  waitForDashboardHealth,
  StageError,
  parseHealthTimeoutMs,
  pidsOnPort,
} from '../../../src/lib/platform-lifecycle.js';

// Use ephemeral ports so stopDashboard's lsof scan never hits a real
// dashboard process during verification-gate test runs.
const baseConfig = {
  dashboardPort: 43990,
  dashboardApiPort: 43991,
  traefikEnabled: false,
  traefikDomain: 'overdeck.localhost',
  traefikDir: '/tmp/does-not-exist/traefik',
};

describe('pidsOnPort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses lsof first so IPv4 and IPv6 TCP listeners are covered', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '4123\n' });

    await expect(pidsOnPort(3011, run)).resolves.toEqual([4123]);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('lsof -nP -iTCP:3011 -sTCP:LISTEN -t');
  });

  it('treats lsof exit code 1 with empty stdout as a free port', async () => {
    const run = vi.fn().mockRejectedValue({ code: 1, stdout: '' });

    await expect(pidsOnPort(3011, run)).resolves.toEqual([]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('falls back from unavailable lsof to fuser and stops on its result', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('lsof not found'), { code: 127 }))
      .mockResolvedValueOnce({ stdout: '5234 5235\n' });

    await expect(pidsOnPort(3011, run)).resolves.toEqual([5234, 5235]);
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      'lsof -nP -iTCP:3011 -sTCP:LISTEN -t',
      'fuser 3011/tcp',
    ]);
  });

  it('falls back to ss and returns only pids from lines matching the exact port', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('lsof not found'), { code: 127 }))
      .mockRejectedValueOnce(Object.assign(new Error('fuser not found'), { code: 127 }))
      .mockResolvedValueOnce({
        stdout:
          'LISTEN 0 511 127.0.0.1:13011 0.0.0.0:* users:(("node",pid=6000,fd=1))\n' +
          'LISTEN 0 511 [::]:3011 [::]:* users:(("node",pid=6234,fd=2))\n',
      });

    await expect(pidsOnPort(3011, run)).resolves.toEqual([6234]);
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      'lsof -nP -iTCP:3011 -sTCP:LISTEN -t',
      'fuser 3011/tcp',
      'ss -ltnp',
    ]);
  });

  it('warns once with every attempted tool when no port probe executes', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 127 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(pidsOnPort(3011, run)).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/lsof.*fuser.*ss/));
  });
});

describe('restartDashboard — scope contract', () => {
  beforeEach(() => {
    // stopDashboard internally shells out to lsof; with no matching process it
    // returns immediately. Tests here assert orchestration, not shell-out.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('invokes the caller-provided start hook exactly once', async () => {
    const startHook = vi.fn().mockResolvedValue(undefined);
    await Effect.runPromise(restartDashboard(baseConfig, startHook, { healthTimeoutMs: 2000 }));
    expect(startHook).toHaveBeenCalledTimes(1);
  });

  it('does NOT import or call CLIProxy / Traefik / TLDR modules', async () => {
    // If restartDashboard ever stops CLIProxy, this import graph check will
    // catch it at runtime: we fail the test if any of those symbols get
    // touched. This is the primary scope guard.
    const cliproxySpies = {
      stopCliproxy: vi.fn(),
      startCliproxy: vi.fn(),
      isCliproxyRunning: vi.fn().mockReturnValue(true),
    };
    const startHook = vi.fn().mockResolvedValue(undefined);

    await Effect.runPromise(restartDashboard(baseConfig, startHook, { healthTimeoutMs: 2000 }));

    // We never passed cliproxySpies to the function, so none of its methods
    // should have been called. The assertion doubles as documentation: the
    // signature of restartDashboard does not mention CLIProxy at all.
    expect(cliproxySpies.stopCliproxy).not.toHaveBeenCalled();
    expect(cliproxySpies.startCliproxy).not.toHaveBeenCalled();
    expect(cliproxySpies.isCliproxyRunning).not.toHaveBeenCalled();
  });

  it('LEAVES the spawned dashboard running if health check never passes (#3099: no zero-listener exit)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.unstubAllGlobals();
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const stop = vi.fn().mockResolvedValue(undefined);
    const startHook = vi.fn().mockResolvedValue({ stop });

    try {
      const restart = Effect.runPromise(
        restartDashboard(baseConfig, startHook, { healthTimeoutMs: 300 }),
      );
      while (fetchMock.mock.calls.length === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const rejection = expect(restart).rejects.toMatchObject({
        failure: {
          stage: 'dashboard',
          reason: expect.stringContaining('LEFT RUNNING'),
          recovery: 'dashboard-left-running',
        },
      });
      await vi.advanceTimersByTimeAsync(500);

      await rejection;
      // The 2026-07-26 incident: a 120ms timeout false-failed a healthy boot and
      // the old policy reaped it, leaving zero listeners. The spawn must survive.
      expect(stop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseHealthTimeoutMs (#3099)', () => {
  it('returns the default when the flag is absent', () => {
    expect(parseHealthTimeoutMs(undefined, 15_000)).toBe(15_000);
    expect(parseHealthTimeoutMs('', 30_000)).toBe(30_000);
  });

  it('treats bare numbers as milliseconds, floored at 1000ms', () => {
    expect(parseHealthTimeoutMs('30000', 15_000)).toBe(30_000);
    expect(parseHealthTimeoutMs('1000', 15_000)).toBe(1000);
  });

  it('rejects sub-floor bare values with a did-you-mean-seconds hint', () => {
    expect(() => parseHealthTimeoutMs('120', 15_000)).toThrow(/below the 1000ms floor.*did you mean 120s\?/s);
  });

  it('supports s and m suffixes', () => {
    expect(parseHealthTimeoutMs('120s', 15_000)).toBe(120_000);
    expect(parseHealthTimeoutMs('2m', 15_000)).toBe(120_000);
  });

  it('rejects garbage and non-numeric input instead of silently NaN-ing', () => {
    expect(() => parseHealthTimeoutMs('abc', 15_000)).toThrow(/--health-timeout must be a positive integer/);
    expect(() => parseHealthTimeoutMs('10x', 15_000)).toThrow(/--health-timeout must be a positive integer/);
    expect(() => parseHealthTimeoutMs('-5', 15_000)).toThrow(/--health-timeout must be a positive integer/);
  });
});

describe('restartCliproxy — scope contract', () => {
  it('stops and starts CLIProxy; never dashboard or Traefik', async () => {
    const cliproxy = {
      stopCliproxy: vi.fn(),
      startCliproxy: vi.fn(),
      isCliproxyRunning: vi.fn().mockReturnValue(true),
    };

    await Effect.runPromise(restartCliproxy(cliproxy, { verifyTimeoutMs: 1000 }));

    expect(cliproxy.stopCliproxy).toHaveBeenCalledTimes(1);
    expect(cliproxy.startCliproxy).toHaveBeenCalledTimes(1);
    expect(cliproxy.isCliproxyRunning).toHaveBeenCalled();
    // Stop must happen before start — otherwise a still-listening instance
    // would conflict with the new one binding to port 8317.
    const stopOrder = cliproxy.stopCliproxy.mock.invocationCallOrder[0]!;
    const startOrder = cliproxy.startCliproxy.mock.invocationCallOrder[0]!;
    expect(stopOrder).toBeLessThan(startOrder);
  });

  it('throws StageError if CLIProxy never confirms running', async () => {
    const cliproxy = {
      stopCliproxy: vi.fn(),
      startCliproxy: vi.fn(),
      isCliproxyRunning: vi.fn().mockReturnValue(false),
    };

    await expect(Effect.runPromise(
      restartCliproxy(cliproxy, { verifyTimeoutMs: 300 }),
    )).rejects.toBeInstanceOf(StageError);
  });
});

describe('waitForDashboardHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves once /api/health returns 200', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 2) return { ok: false, status: 503 };
        return { ok: true, status: 200 };
      }),
    );
    await expect(Effect.runPromise(
      waitForDashboardHealth(43991, { timeoutMs: 2000, pollIntervalMs: 50 }),
    )).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('rejects a 200 health response from a non-primary dashboard identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          repoRoot: '/repo/workspaces/feature-pan-2252',
          mode: 'peer',
        }),
      }),
    );

    await expect(Effect.runPromise(
      waitForDashboardHealth(43991, {
        timeoutMs: 200,
        pollIntervalMs: 50,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      }),
    )).rejects.toMatchObject({
      failure: {
        stage: 'dashboard',
        reason: expect.stringContaining('port held by non-primary server (cwd=/repo/workspaces/feature-pan-2252, mode=peer)'),
      },
    });
  });

  it('accepts a 200 health response matching the expected dashboard identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          repoRoot: '/repo',
          mode: 'primary',
        }),
      }),
    );

    await expect(Effect.runPromise(
      waitForDashboardHealth(43991, {
        timeoutMs: 200,
        pollIntervalMs: 50,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      }),
    )).resolves.toBeUndefined();
  });

  it('StageError reports the dashboard stage on timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('nope')),
    );
    try {
      await Effect.runPromise(waitForDashboardHealth(43991, { timeoutMs: 200, pollIntervalMs: 50 }));
      throw new Error('should not reach here');
    } catch (err) {
      expect(err).toBeInstanceOf(StageError);
      expect((err as StageError).failure.stage).toBe('dashboard');
    }
  });
});

describe('dashboard health ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a healthy responder whose pid differs from the freshly spawned server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', repoRoot: '/repo', mode: 'primary', pid: 7101 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const restart = Effect.runPromise(restartDashboard(
      baseConfig,
      () => ({ stop: vi.fn(), pid: async () => 7202 }),
      {
        healthTimeoutMs: 200,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      },
    ));
    const rejection = expect(restart).rejects.toMatchObject({
      failure: {
        stage: 'dashboard',
        reason: expect.stringMatching(/pid 7101.*pid 7202.*LEFT RUNNING/s),
        recovery: 'dashboard-left-running',
      },
    });
    while (fetchMock.mock.calls.length === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    await vi.advanceTimersByTimeAsync(300);
    await rejection;
  });

  it('accepts a healthy responder whose pid matches the freshly spawned server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', repoRoot: '/repo', mode: 'primary', pid: 7303 }),
    }));

    await expect(Effect.runPromise(restartDashboard(
      baseConfig,
      () => ({ stop: vi.fn(), pid: async () => 7303 }),
      { expectedIdentity: { repoRoot: '/repo', mode: 'primary' } },
    ))).resolves.toEqual({ ownershipVerified: true, spawnedPid: 7303 });
  });

  it('rejects a pre-fix health payload that omits pid when ownership is expected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', repoRoot: '/repo', mode: 'primary' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const restart = Effect.runPromise(restartDashboard(
      baseConfig,
      () => ({ stop: vi.fn(), pid: async () => 7404 }),
      {
        healthTimeoutMs: 200,
        expectedIdentity: { repoRoot: '/repo', mode: 'primary' },
      },
    ));
    const rejection = expect(restart).rejects.toMatchObject({
      failure: {
        reason: expect.stringMatching(/pid \(unreported\).*pid 7404.*LEFT RUNNING/s),
      },
    });
    while (fetchMock.mock.calls.length === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    await vi.advanceTimersByTimeAsync(300);
    await rejection;
  });

  it('preserves legacy 200 behavior when no expected pid or identity is provided', async () => {
    const response = { ok: true, status: 200 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(Effect.runPromise(
      waitForDashboardHealth(43991, { timeoutMs: 200, pollIntervalMs: 50 }),
    )).resolves.toBeUndefined();
  });

  it('reports unverified ownership when a spawn handle cannot resolve its pid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', repoRoot: '/repo', mode: 'primary' }),
    }));

    await expect(Effect.runPromise(restartDashboard(
      baseConfig,
      () => ({ stop: vi.fn(), pid: async () => null }),
      { expectedIdentity: { repoRoot: '/repo', mode: 'primary' } },
    ))).resolves.toEqual({ ownershipVerified: false, spawnedPid: null });
  });
});
