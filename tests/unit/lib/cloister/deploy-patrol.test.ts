import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  _resetDeployPatrolForTests,
  buildSystemdReloadArgs,
  getDeployCiState,
  runDeployPatrol,
  waitForChildSpawn,
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
    originMainLastBuildInputCommitAt: NOW - 10 * 60 * 1000,
    computedAt: NOW,
    ...overrides,
  };
}

function context(staleness: BuildStaleness = stale()) {
  return {
    repoRoot: '/repo',
    config: { auto_deploy: true, debounce_minutes: 5 },
    computeStaleness: vi.fn(async () => staleness),
    getCiState: vi.fn(async () => ({ status: 'green' as const })),
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

describe('getDeployCiState', () => {
  const sha = 'origin123456789';

  it('requires a successful CI workflow run for the exact origin/main tip', async () => {
    const runGh = vi.fn(async () => JSON.stringify([{
      databaseId: 42,
      status: 'completed',
      conclusion: 'success',
      headSha: sha,
      attempt: 1,
      createdAt: '2026-07-15T11:55:00Z',
    }]));

    await expect(getDeployCiState('/repo', sha, runGh)).resolves.toEqual({ status: 'green' });
    expect(runGh).toHaveBeenCalledWith([
      'run', 'list',
      '--branch', 'main',
      '--commit', sha,
      '--workflow', 'ci.yml',
      '--limit', '10',
      '--json', 'databaseId,status,conclusion,headSha,attempt,createdAt',
    ], '/repo');
  });

  it.each([
    ['in_progress', null, 'pending'],
    ['completed', 'failure', 'red'],
  ] as const)('classifies a %s CI run with conclusion %s as %s', async (status, conclusion, expected) => {
    const runGh = vi.fn(async () => JSON.stringify([{
      databaseId: 42,
      status,
      conclusion,
      headSha: sha,
      attempt: 1,
      createdAt: '2026-07-15T11:55:00Z',
    }]));

    await expect(getDeployCiState('/repo', sha, runGh)).resolves.toEqual(expect.objectContaining({
      status: expected,
    }));
  });

  it('fails closed when CI cannot be read', async () => {
    const runGh = vi.fn(async () => { throw new Error('GitHub unavailable'); });

    await expect(getDeployCiState('/repo', sha, runGh)).resolves.toEqual({
      status: 'unknown',
      reason: expect.stringContaining('GitHub unavailable'),
    });
  });
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
      initiator: 'deploy-patrol',
    });
    expect(ctx.emitEntry).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Automatic deployment started'),
    }));
    expect(ctx.emitTts).toHaveBeenCalledWith(expect.objectContaining({
      utterance: 'Automatic dashboard deployment started.',
    }));
  });

  it('defers while CI for the origin/main tip is pending', async () => {
    const ctx = context();
    ctx.getCiState.mockResolvedValue({
      status: 'pending',
      reason: 'Automatic deployment deferred because CI is still in progress for origin/main origin12.',
    });

    await runDeployPatrol(ctx);
    await runDeployPatrol(ctx);

    expect(ctx.spawnReload).not.toHaveBeenCalled();
    expect(ctx.getBlockReason).not.toHaveBeenCalled();
    expect(ctx.emitEntry.mock.calls.filter(([entry]) => entry.message.includes('CI is still in progress'))).toHaveLength(1);
  });

  it('defers when CI for the origin/main tip is red', async () => {
    const ctx = context();
    ctx.getCiState.mockResolvedValue({
      status: 'red',
      reason: 'Automatic deployment blocked because CI failed for origin/main origin12.',
    });

    await runDeployPatrol(ctx);

    expect(ctx.spawnReload).not.toHaveBeenCalled();
    expect(ctx.getBlockReason).not.toHaveBeenCalled();
    expect(ctx.emitEntry).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('CI failed'),
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

  it('waits for the build-input debounce interval under fake timers', async () => {
    const ctx = context(stale({
      originMainLastBuildInputCommitAt: NOW - 4 * 60 * 1000,
    }));

    await runDeployPatrol(ctx);
    expect(ctx.spawnReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    await runDeployPatrol(ctx);
    expect(ctx.spawnReload).toHaveBeenCalledTimes(1);
  });

  it('ignores recent non-build commits when the build-input debounce is clear', async () => {
    const ctx = context(stale({
      originMainLastCommitAt: NOW - 1 * 60 * 1000,
      originMainLastBuildInputCommitAt: NOW - 10 * 60 * 1000,
    }));

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

describe('buildSystemdReloadArgs', () => {
  it('runs the reload in a retrying unit outside the dashboard cgroup with captured output', () => {
    const args = buildSystemdReloadArgs(
      {
        command: '/usr/bin/node',
        args: ['/repo/dist/cli/index.js', 'reload', '--health-timeout', '120000'],
        cwd: '/repo',
        detached: true,
        initiator: 'deploy-patrol',
      },
      NOW,
      '/home/test/.overdeck/logs/auto-deploy.log',
      { PATH: '/usr/bin', OVERDECK_AGENT_ID: 'flywheel-orchestrator', 'BASH_FUNC_bad%%': '() { :; }' },
    );

    expect(args).toEqual([
      '--user', '--unit', `overdeck-auto-deploy-${NOW}`,
      '--collect', '--quiet',
      '--property=Restart=on-failure',
      '--property=RestartSec=10s',
      '--property=StartLimitBurst=2',
      '--property=StartLimitIntervalSec=300s',
      '--property=StandardOutput=append:/home/test/.overdeck/logs/auto-deploy.log',
      '--property=StandardError=append:/home/test/.overdeck/logs/auto-deploy.log',
      '--property=WorkingDirectory=/repo',
      '--setenv', 'PATH=/usr/bin',
      '--setenv', 'OVERDECK_AGENT_ID=deploy-patrol',
      '/usr/bin/node', '/repo/dist/cli/index.js', 'reload', '--health-timeout', '120000',
    ]);
  });
});

describe('waitForChildSpawn', () => {
  it('unrefs only after the detached child reports a successful spawn', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();

    const spawned = waitForChildSpawn(child);
    child.emit('spawn');

    await expect(spawned).resolves.toBeUndefined();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('rejects an asynchronous spawn error without leaving an unhandled error event', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();
    const error = new Error('spawn failed');

    const spawned = waitForChildSpawn(child);
    child.emit('error', error);

    await expect(spawned).rejects.toBe(error);
    expect(child.unref).not.toHaveBeenCalled();
  });
});
