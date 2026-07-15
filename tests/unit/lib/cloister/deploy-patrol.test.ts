import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetDeployPatrolForTests,
  runDeployPatrol,
} from '../../../../src/lib/cloister/deploy-patrol.js';
import type { BuildStaleness } from '../../../../src/lib/deploy/staleness.js';

const NOW = new Date('2026-07-15T12:00:00.000Z').getTime();

function stale(overrides: Partial<BuildStaleness> = {}): BuildStaleness {
  return {
    status: 'stale',
    buildCommit: 'build123456789',
    originMainSha: 'origin123456789',
    behindTotal: 4,
    behindBuildInputs: 2,
    originMainLastCommitAt: NOW - 10 * 60 * 1000,
    computedAt: NOW,
    ...overrides,
  };
}

function context(staleness: BuildStaleness = stale()) {
  return {
    repoRoot: '/repo',
    config: { auto_deploy: true, debounce_minutes: 5 },
    computeStaleness: vi.fn(async () => staleness),
    getBlockReason: vi.fn(async () => null),
    spawnReload: vi.fn(async () => undefined),
    emitEntry: vi.fn(),
    emitTts: vi.fn(),
    now: () => Date.now(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  _resetDeployPatrolForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runDeployPatrol', () => {
  it('starts one reload and announces it when the safety window is clear', async () => {
    const ctx = context();

    await runDeployPatrol(ctx);

    expect(ctx.spawnReload).toHaveBeenCalledWith({
      command: process.execPath,
      args: ['/repo/dist/cli/index.js', 'reload', '--health-timeout', '120000'],
      cwd: '/repo',
      detached: true,
    });
    expect(ctx.emitEntry).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Automatic deployment started'),
    }));
    expect(ctx.emitTts).toHaveBeenCalledWith(expect.objectContaining({
      utterance: 'Automatic dashboard deployment started.',
    }));
  });

  it('emits a throttled deferral when the deploy window is blocked', async () => {
    const ctx = context();
    ctx.getBlockReason.mockResolvedValue('Deployment deferred because verification is in flight for PAN-1.');

    await runDeployPatrol(ctx);
    await runDeployPatrol(ctx);

    expect(ctx.spawnReload).not.toHaveBeenCalled();
    expect(ctx.emitEntry.mock.calls.filter(([entry]) => entry.message.includes('verification'))).toHaveLength(1);
  });

  it('waits for the merge debounce interval under fake timers', async () => {
    const ctx = context(stale({ originMainLastCommitAt: NOW - 4 * 60 * 1000 }));

    await runDeployPatrol(ctx);
    expect(ctx.spawnReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    await runDeployPatrol(ctx);
    expect(ctx.spawnReload).toHaveBeenCalledTimes(1);
  });

  it('remains signal-only when automatic deployment is disabled', async () => {
    const ctx = context();
    ctx.config.auto_deploy = false;

    await runDeployPatrol(ctx);

    expect(ctx.emitEntry).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('operator action is required'),
    }));
    expect(ctx.spawnReload).not.toHaveBeenCalled();
  });

  it('suppresses another spawn for ten minutes', async () => {
    const ctx = context();

    await runDeployPatrol(ctx);
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    await runDeployPatrol(ctx);

    expect(ctx.spawnReload).toHaveBeenCalledTimes(1);
  });

  it('does not repeatedly observe fresh or unknown builds', async () => {
    const freshCtx = context(stale({ status: 'fresh', behindTotal: 0, behindBuildInputs: 0 }));
    await runDeployPatrol(freshCtx);
    expect(freshCtx.spawnReload).not.toHaveBeenCalled();
    expect(freshCtx.emitEntry).not.toHaveBeenCalled();

    const unknownCtx = context(stale({ status: 'unknown', reason: 'missing stamp' }));
    await runDeployPatrol(unknownCtx);
    await runDeployPatrol(unknownCtx);
    expect(unknownCtx.spawnReload).not.toHaveBeenCalled();
    expect(unknownCtx.emitEntry).toHaveBeenCalledTimes(1);
  });
});
