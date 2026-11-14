import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveFlywheelHealth,
  localMidnightIso,
  resetFlywheelHealthMemo,
  type FlywheelHealthDeps,
} from '../../../../src/lib/flywheel/health.js';

// 14:00 local on 2026-11-14, whatever the host timezone (H5).
const NOW = new Date(2026, 10, 14, 14, 0, 0).getTime();
const at = (hours: number, minutes = 0) => new Date(2026, 10, 14, hours, minutes).toISOString();
const SEP = '\x1f';
const BUILD = 'b'.repeat(40);
const VERDICT = 'abc'.padEnd(40, '0');

interface GitScript {
  log?: string;
  tags?: string;
  /** SHAs on origin/main the build does not contain. */
  undeployed?: string[];
  behind?: number;
  buildInRepo?: boolean;
}

function fakeGit(script: GitScript) {
  return vi.fn(async (args: readonly string[]) => {
    const [cmd] = args;
    if (cmd === 'cat-file') {
      if (script.buildInRepo === false) throw new Error('fatal: Not a valid object name');
      return '';
    }
    if (cmd === 'log') return script.log ?? '';
    if (cmd === 'for-each-ref') return script.tags ?? '';
    if (cmd === 'rev-list' && args[1] === '--count') return `${script.behind ?? 0}\n`;
    if (cmd === 'rev-list') return (script.undeployed ?? []).join('\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  });
}

function fakeGh(runs: unknown[] = [{ conclusion: 'success', head_sha: VERDICT, html_url: 'https://github.com/o/r/actions/runs/1', updated_at: at(13) }]) {
  return vi.fn(async (_path: string) => ({ workflow_runs: runs }));
}

function deps(overrides: FlywheelHealthDeps = {}): FlywheelHealthDeps {
  return {
    git: fakeGit({}),
    ghApi: fakeGh(),
    githubRepo: () => 'o/r',
    defaultBranch: () => 'main',
    buildCommit: () => BUILD,
    readGateQueue: async () => ({ slots: 2, owners: [], waiters: [] }),
    nextBatch: () => null,
    batchingPausedUntil: () => null,
    restartEvents: () => [],
    trackerTitle: () => null,
    now: () => NOW,
    ...overrides,
  };
}

const logLine = (sha: string, when: string, subject: string) => [sha, when, subject].join(SEP);

beforeEach(() => resetFlywheelHealthMemo());

describe('deriveFlywheelHealth (PAN-5283 WI-8)', () => {
  it('mainCi takes the newest completed CI run', async () => {
    const ghApi = fakeGh();
    const { health } = await deriveFlywheelHealth({ projectRoot: '/repo', deps: deps({ ghApi }) });
    expect(health.mainCi).toEqual({ conclusion: 'success', sha: VERDICT, url: 'https://github.com/o/r/actions/runs/1', at: at(13) });
    expect(ghApi).toHaveBeenCalledWith('repos/o/r/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1');
  });

  it('mainCi is null when the project has no GitHub repo', async () => {
    const ghApi = fakeGh();
    const { health } = await deriveFlywheelHealth({ projectRoot: '/repo', deps: deps({ ghApi, githubRepo: () => null }) });
    expect(health.mainCi).toBeNull();
    expect(ghApi).not.toHaveBeenCalled();
  });

  it('deployed reports commits behind the CI verdict', async () => {
    const { health } = await deriveFlywheelHealth({ projectRoot: '/repo', deps: deps({ git: fakeGit({ behind: 3 }) }) });
    expect(health.deployed).toEqual({ buildCommit: BUILD, behindVerdict: 3 });
  });

  it('deploy fields are null when the build commit is not in the project repo', async () => {
    const git = fakeGit({ buildInRepo: false, log: logLine('m1', at(9), 'feat: x PAN-5246 (#5273)') });
    const { health, shipped } = await deriveFlywheelHealth({
      projectRoot: '/repo',
      deps: deps({ git, restartEvents: () => [{ ts: at(10), trigger: 'pan reload', success: true, durationMs: 1, attempts: 1 }] }),
    });
    expect(health.deployed).toBeNull();
    expect(shipped.merges.map((merge) => merge.deployed)).toEqual([null]);
    expect(shipped.events.some((event) => event.kind === 'deploy')).toBe(false);
  });

  it('merges keep only PR-merge subjects and split deploy from done', async () => {
    const git = fakeGit({
      log: [
        logLine('m2', at(11), 'fix(dashboard): PAN-5250 later (#5280)'),
        logLine('s1', at(10, 30), 'chore: flywheel state'),
        logLine('m1', at(9), 'feat(dashboard): PAN-5246 board (#5273)'),
      ].join('\n'),
      undeployed: ['m2'],
    });
    const { shipped } = await deriveFlywheelHealth({
      projectRoot: '/repo',
      deps: deps({ git, trackerTitle: (id) => (id === 'PAN-5246' ? 'Board' : null) }),
    });
    expect(shipped.merges).toEqual([
      { sha: 'm2', at: at(11), subject: 'fix(dashboard): PAN-5250 later (#5280)', prNumber: 5280, prUrl: 'https://github.com/o/r/pull/5280', issueId: 'PAN-5250', title: null, deployed: false },
      { sha: 'm1', at: at(9), subject: 'feat(dashboard): PAN-5246 board (#5273)', prNumber: 5273, prUrl: 'https://github.com/o/r/pull/5273', issueId: 'PAN-5246', title: 'Board', deployed: true },
    ]);
    expect(git).toHaveBeenCalledWith(['log', 'origin/main', '--first-parent', `--since=${localMidnightIso(NOW)}`, `--format=%H${SEP}%cI${SEP}%s`]);
  });

  it('events sort newest first and include today\'s release tag', async () => {
    const git = fakeGit({
      log: logLine('m1', at(9), 'feat: PAN-5246 (#5273)'),
      tags: [`v0.85.0${SEP}${at(12)}`, `v0.84.0${SEP}${new Date(2026, 10, 13, 18).toISOString()}`].join('\n'),
    });
    const { health, shipped } = await deriveFlywheelHealth({
      projectRoot: '/repo',
      deps: deps({
        git,
        restartEvents: () => [
          { ts: at(10), trigger: 'pan reload', success: true, phase: 'healthy', durationMs: 1, attempts: 1, issueId: 'PAN-5246' },
          { ts: at(10, 5), trigger: 'pan reload', success: true, phase: 'stopping', durationMs: 1, attempts: 1 },
          { ts: at(10, 10), trigger: 'pan restart', success: true, durationMs: 1, attempts: 1 },
          { ts: new Date(2026, 10, 13, 20).toISOString(), trigger: 'pan reload', success: true, durationMs: 1, attempts: 1 },
        ],
      }),
    });
    expect(shipped.events.map((event) => `${event.kind}@${event.at}`)).toEqual([`release@${at(12)}`, `deploy@${at(10)}`, `merge@${at(9)}`]);
    expect(health.lastRelease).toEqual({ tag: 'v0.85.0', at: at(12), url: 'https://github.com/o/r/releases/tag/v0.85.0' });
  });

  it('reports the gate queue, next batch and batching pause', async () => {
    const { health } = await deriveFlywheelHealth({
      projectRoot: '/repo',
      deps: deps({
        readGateQueue: async () => ({
          slots: 2,
          owners: [{ workspacePath: '/a', gateName: 'vitest', createdAt: NOW - 1000, acquiredAt: NOW - 500 }],
          waiters: [{ workspacePath: '/b', gateName: 'vitest', createdAt: NOW - 60_000 }, { workspacePath: '/c', gateName: 'vitest', createdAt: NOW - 1000 }],
        }),
        nextBatch: () => ({ name: 'uat/pan-train-0614', status: 'assembling', members: ['PAN-1', 'PAN-2'], createdAt: at(13) }),
        batchingPausedUntil: () => at(15),
      }),
    });
    expect(health.gateQueue).toEqual({ running: 1, queued: 2, slots: 2, oldestWaitSince: new Date(NOW - 60_000).toISOString() });
    expect(health.nextBatch).toEqual({ name: 'uat/pan-train-0614', status: 'assembling', members: ['PAN-1', 'PAN-2'], createdAt: at(13) });
    expect(health.batchingPausedUntil).toBe(at(15));
  });

  it('a failed sub-read nulls only its own field', async () => {
    const git = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'cat-file') return '';
      throw new Error('git broke');
    });
    const { health, shipped } = await deriveFlywheelHealth({
      projectRoot: '/repo',
      deps: deps({ git, ghApi: async () => { throw new Error('rate limited'); } }),
    });
    expect(health.mainCi).toBeNull();
    expect(health.deployed).toEqual({ buildCommit: BUILD, behindVerdict: null });
    expect(health.lastRelease).toBeNull();
    expect(shipped).toEqual({ merges: [], events: [] });
  });

  describe('memo (D6)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('the health result is reused within 30 seconds and refreshed after', async () => {
      const git = fakeGit({});
      const ghApi = fakeGh();
      const live = deps({ git, ghApi, now: () => Date.now() });
      await deriveFlywheelHealth({ projectRoot: '/repo', deps: live });
      const gitCalls = git.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      await deriveFlywheelHealth({ projectRoot: '/repo', deps: live });
      expect(git.mock.calls.length).toBe(gitCalls);
      expect(ghApi).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(31_000);
      await deriveFlywheelHealth({ projectRoot: '/repo', deps: live });
      expect(git.mock.calls.length).toBeGreaterThan(gitCalls);
      // The forge read keeps its own 60 s memo (NFR-5): 41 s in, gh is not asked again.
      expect(ghApi).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(31_000);
      await deriveFlywheelHealth({ projectRoot: '/repo', deps: live });
      expect(ghApi).toHaveBeenCalledTimes(2);
    });
  });
});
