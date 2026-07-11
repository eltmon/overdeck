import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { runRelease } from '../release-engine.js';

const mocks = vi.hoisted(() => ({
  mergeSet: null as any,
  project: null as any,
  reviewUpdates: [] as Array<{ issueId: string; update: any }>,
  persistedSets: [] as any[],
}));

vi.mock('../../merge-set.js', () => ({
  getMergeSetSync: vi.fn(() => mocks.mergeSet),
}));

vi.mock('../../projects.js', () => ({
  getProjectSync: vi.fn(() => mocks.project),
  findProjectByPathSync: vi.fn(() => mocks.project),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatusSync: vi.fn((issueId: string, update: any) => {
    mocks.reviewUpdates.push({ issueId, update });
    return {
      issueId,
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
      ...update,
    };
  }),
}));

vi.mock('../../release-set.js', () => ({
  upsertReleaseSetSync: vi.fn((releaseSet: any) => {
    mocks.persistedSets.push(structuredClone(releaseSet));
  }),
  withComponentStateSync: vi.fn((releaseSet: any, componentKey: string, patch: any) => ({
    ...releaseSet,
    updatedAt: new Date().toISOString(),
    components: releaseSet.components.map((component: any) =>
      component.componentKey === componentKey ? { ...component, ...patch, componentKey } : component,
    ),
  })),
}));

function seedMergeAndProject(release: any): void {
  mocks.mergeSet = {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'merged',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    repos: [],
  };
  mocks.project = {
    name: 'Overdeck',
    path: '/repo/overdeck',
    release,
  };
}

describe('runRelease integration with fake timers', () => {
  beforeEach(() => {
    mocks.mergeSet = null;
    mocks.project = null;
    mocks.reviewUpdates = [];
    mocks.persistedSets = [];
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs components in depends_on order and passes when health and smoke checks succeed', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          health_url: 'https://api.example.com/health',
          smoke_test: 'npm run smoke:api',
        },
        frontend: {
          trigger: 'auto',
          depends_on: ['api'],
          version_check: 'npm run version:frontend',
          smoke_test: 'npm run smoke:frontend',
        },
        worker: {
          trigger: 'auto',
          depends_on: ['frontend'],
          smoke_test: 'npm run smoke:worker',
        },
      },
    });

    const commands: string[] = [];
    let healthCalls = 0;
    const resultPromise = runRelease('PAN-399', '/repo/overdeck', {
      commandTimeoutMs: 5000,
      healthTimeoutMs: 10_000,
      healthPollIntervalMs: 500,
      fetchHealth: vi.fn(async () => {
        healthCalls++;
        return { ok: true, status: 200 };
      }),
      runCommand: vi.fn(async (command) => {
        commands.push(command);
      }),
    });

    const result = await resultPromise;

    expect(result?.status).toBe('passed');
    expect(result?.components.map((c) => [c.componentKey, c.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'passed'],
      ['worker', 'passed'],
    ]);
    expect(commands).toEqual([
      'npm run smoke:api',
      'npm run version:frontend',
      'npm run smoke:frontend',
      'npm run smoke:worker',
    ]);
    expect(mocks.reviewUpdates.at(-1)).toMatchObject({
      issueId: 'PAN-399',
      update: { releaseStatus: 'passed' },
    });
  });

  it('polls health with fake timers until the endpoint succeeds', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          health_url: 'https://api.example.com/health',
          smoke_test: 'npm run smoke:api',
        },
      },
    });

    let healthCalls = 0;
    const resultPromise = runRelease('PAN-399', '/repo/overdeck', {
      healthTimeoutMs: 3000,
      healthPollIntervalMs: 500,
      fetchHealth: vi.fn(async () => {
        healthCalls++;
        if (healthCalls < 3) return { ok: false, status: 503 };
        return { ok: true, status: 200 };
      }),
      runCommand: vi.fn(async () => {}),
    });

    // Let the first two failed health checks and their poll intervals elapse.
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result?.status).toBe('passed');
    expect(healthCalls).toBeGreaterThanOrEqual(3);
  });

  it('halts remaining components and marks partial when a smoke test fails', async () => {
    seedMergeAndProject({
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
        frontend: {
          trigger: 'auto',
          depends_on: ['api'],
          smoke_test: 'npm run smoke:frontend',
        },
        worker: {
          trigger: 'auto',
          depends_on: ['frontend'],
          smoke_test: 'npm run smoke:worker',
        },
      },
    });

    const commands: string[] = [];
    const resultPromise = runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async (command) => {
        commands.push(command);
        if (command === 'npm run smoke:frontend') throw new Error('smoke failed');
      }),
    });

    const result = await resultPromise;

    expect(result?.status).toBe('partial');
    expect(result?.components.map((c) => [c.componentKey, c.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'failed'],
      ['worker', 'skipped'],
    ]);
    expect(commands).toEqual(['npm run smoke:api', 'npm run smoke:frontend']);
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('partial');
  });

  it('runs rollback and marks rolled_back when configured rollback succeeds', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          smoke_test: 'npm run smoke:api',
          rollback: 'npm run rollback:api',
        },
      },
    });

    const commands: string[] = [];
    const resultPromise = runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async (command) => {
        commands.push(command);
        if (command === 'npm run smoke:api') throw new Error('smoke failed');
      }),
    });

    const result = await resultPromise;

    expect(commands).toEqual(['npm run smoke:api', 'npm run rollback:api']);
    expect(result?.status).toBe('rolled_back');
    expect(result?.components[0]).toMatchObject({
      componentKey: 'api',
      status: 'rolled_back',
      rollbackStatus: 'rolled_back',
    });
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('rolled_back');
  });

  it('marks manual components blocked and the release partial instead of passed', async () => {
    seedMergeAndProject({
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
        worker: { trigger: 'manual' },
      },
    });

    const resultPromise = runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async () => {}),
    });

    const result = await resultPromise;

    expect(result?.status).toBe('partial');
    expect(result?.components.map((c) => [c.componentKey, c.status])).toEqual([
      ['api', 'passed'],
      ['worker', 'blocked'],
    ]);
    expect(mocks.reviewUpdates.at(-1)).toMatchObject({
      issueId: 'PAN-399',
      update: {
        releaseStatus: 'partial',
        releaseNotes: 'Release awaiting manual step(s): worker.',
      },
    });
  });

  it('skips cleanly and returns null when the project has no release config', async () => {
    seedMergeAndProject(undefined);

    const runCommand = vi.fn(async () => {});
    const result = await runRelease('PAN-399', '/repo/overdeck', { runCommand });

    expect(result).toBeNull();
    expect(runCommand).not.toHaveBeenCalled();
    expect(mocks.reviewUpdates.at(-1)).toMatchObject({
      issueId: 'PAN-399',
      update: { releaseStatus: 'skipped', releaseNotes: 'No release config found for project.' },
    });
  });

  it('runs verification commands in the project root by default', async () => {
    seedMergeAndProject({
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
      },
    });

    const runCommand = vi.fn(async () => {});
    await runRelease('PAN-399', '/repo/overdeck', { runCommand });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('npm run smoke:api', expect.any(Number), '/repo/overdeck');
  });

  it('allows callers to override the command working directory', async () => {
    seedMergeAndProject({
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
      },
    });

    const runCommand = vi.fn(async () => {});
    await runRelease('PAN-399', '/repo/overdeck', { runCommand, commandCwd: '/custom/path' });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('npm run smoke:api', expect.any(Number), '/custom/path');
  });
});
