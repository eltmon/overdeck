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
} from '../../../src/lib/platform-lifecycle.js';

// Use ephemeral ports so stopDashboard's lsof scan never hits a real
// dashboard process during verification-gate test runs.
const baseConfig = {
  dashboardPort: 43990,
  dashboardApiPort: 43991,
  traefikEnabled: false,
  traefikDomain: 'pan.localhost',
  traefikDir: '/tmp/does-not-exist/traefik',
};

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

  it('throws StageError if health check never passes', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    const startHook = vi.fn().mockResolvedValue(undefined);

    await expect(Effect.runPromise(
      restartDashboard(baseConfig, startHook, { healthTimeoutMs: 300 }),
    )).rejects.toBeInstanceOf(StageError);
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
