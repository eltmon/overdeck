import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetForTests,
  BUILD_INPUT_PATHS,
  computeBuildStaleness,
  type GitExec,
} from '../../../../src/lib/deploy/staleness.js';

const REPO_ROOT = '/repo';
const BUILD_COMMIT = 'build-sha';

function createExec(options: {
  behindTotal?: number;
  behindBuildInputs?: number;
  fetchError?: Error;
  unknownBuild?: boolean;
} = {}) {
  const calls: string[][] = [];
  const exec: GitExec = async (_command, args) => {
    calls.push([...args]);
    if (args[0] === 'fetch' && options.fetchError) throw options.fetchError;
    if (args[0] === 'rev-parse' && args[1] === '--verify' && options.unknownBuild) {
      throw new Error('bad object');
    }
    if (args[0] === 'rev-parse' && args[1] === 'origin/main') return { stdout: 'origin-sha\n' };
    if (args[0] === 'rev-list' && args.includes('--')) {
      return { stdout: `${options.behindBuildInputs ?? 0}\n` };
    }
    if (args[0] === 'rev-list') return { stdout: `${options.behindTotal ?? 0}\n` };
    if (args[0] === 'log') return { stdout: '1710000000\n' };
    return { stdout: `${BUILD_COMMIT}\n` };
  };
  return { exec, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
  _resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeBuildStaleness', () => {
  it('reports build-input commits behind origin/main', async () => {
    const { exec, calls } = createExec({ behindTotal: 5, behindBuildInputs: 2 });

    const result = await computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec });

    expect(result).toMatchObject({ status: 'stale', behindTotal: 5, behindBuildInputs: 2 });
    expect(calls).toContainEqual([
      'rev-list', '--count', `${BUILD_COMMIT}..origin/main`, '--', ...BUILD_INPUT_PATHS,
    ]);
  });

  it('reports fresh when origin/main has no newer build-input commits', async () => {
    const { exec } = createExec({ behindTotal: 3, behindBuildInputs: 0 });

    await expect(computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec }))
      .resolves.toMatchObject({
        status: 'fresh',
        originMainSha: 'origin-sha',
        behindTotal: 3,
        behindBuildInputs: 0,
        originMainLastCommitAt: 1_710_000_000_000,
      });
  });

  it('returns unknown without rejecting for a missing or unknown build commit', async () => {
    const missing = createExec();
    const unknown = createExec({ unknownBuild: true });

    await expect(computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: null, exec: missing.exec }))
      .resolves.toMatchObject({ status: 'unknown', buildCommit: null, reason: expect.any(String) });
    expect(missing.calls).toHaveLength(0);

    await expect(computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec: unknown.exec }))
      .resolves.toMatchObject({ status: 'unknown', buildCommit: BUILD_COMMIT, reason: expect.any(String) });
  });

  it('throttles fetches while continuing to read local refs', async () => {
    const { exec, calls } = createExec();

    await computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec });
    await vi.advanceTimersByTimeAsync(1_000);
    await computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec });

    expect(calls.filter(([command]) => command === 'fetch')).toHaveLength(1);
    expect(calls.filter(([command, ref]) => command === 'rev-parse' && ref === 'origin/main')).toHaveLength(2);
  });

  it('uses the last-fetched origin/main when fetch fails', async () => {
    const { exec } = createExec({ fetchError: new Error('offline'), behindBuildInputs: 1 });

    await expect(computeBuildStaleness({ repoRoot: REPO_ROOT, buildCommit: BUILD_COMMIT, exec }))
      .resolves.toMatchObject({ status: 'stale', originMainSha: 'origin-sha', behindBuildInputs: 1 });
  });

  it('bounds a stalled fetch and continues with the local origin/main ref', async () => {
    const { exec: baseExec, calls } = createExec({ behindBuildInputs: 1 });
    const exec: GitExec = async (command, args, options) => {
      if (args[0] === 'fetch') {
        calls.push([...args]);
        return new Promise(() => undefined);
      }
      return baseExec(command, args, options);
    };

    const result = computeBuildStaleness({
      repoRoot: REPO_ROOT,
      buildCommit: BUILD_COMMIT,
      exec,
      fetchTimeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({
      status: 'stale',
      originMainSha: 'origin-sha',
      behindBuildInputs: 1,
    });
  });
});
