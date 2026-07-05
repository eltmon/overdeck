import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../release-set.js', async () => {
  const actual = await vi.importActual<typeof import('../../release-set.js')>('../../release-set.js');
  return {
    ...actual,
    upsertReleaseSetSync: vi.fn((releaseSet: any) => {
      mocks.persistedSets.push(structuredClone(releaseSet));
    }),
  };
});

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

describe('runRelease integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T00:00:00.000Z'));
    mocks.mergeSet = null;
    mocks.project = null;
    mocks.reviewUpdates = [];
    mocks.persistedSets = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs an ordered release after health polling advances on fake timers', async () => {
    seedMergeAndProject({
      components: {
        worker: {
          trigger: 'auto',
          depends_on: ['frontend'],
          smoke_test: 'npm run smoke:worker',
        },
        api: {
          trigger: 'auto',
          health_url: 'https://api.example.com/health',
          version_check: 'npm run version:api',
          smoke_test: 'npm run smoke:api',
        },
        frontend: {
          trigger: 'auto',
          depends_on: ['api'],
          smoke_test: 'npm run smoke:frontend',
        },
      },
    });

    let healthCalls = 0;
    const commands: string[] = [];
    const releasePromise = runRelease('PAN-399', '/repo/overdeck', {
      healthPollIntervalMs: 50,
      fetchHealth: vi.fn(async () => {
        healthCalls += 1;
        return { ok: healthCalls > 1, status: healthCalls > 1 ? 200 : 503 };
      }),
      runCommand: vi.fn(async (command) => {
        commands.push(command);
      }),
    });

    await vi.advanceTimersByTimeAsync(50);
    const result = await releasePromise;

    expect(commands).toEqual([
      'npm run version:api',
      'npm run smoke:api',
      'npm run smoke:frontend',
      'npm run smoke:worker',
    ]);
    expect(result?.status).toBe('passed');
    expect(result?.components.map(component => [component.componentKey, component.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'passed'],
      ['worker', 'passed'],
    ]);
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('passed');
  });

  it('halts remaining components after a mid-plan failure and records a partial release', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          smoke_test: 'npm run smoke:api',
        },
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
    const result = await runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async (command) => {
        commands.push(command);
        if (command === 'npm run smoke:frontend') throw new Error('smoke failed');
      }),
    });

    expect(commands).toEqual(['npm run smoke:api', 'npm run smoke:frontend']);
    expect(result?.status).toBe('partial');
    expect(result?.components.map(component => [component.componentKey, component.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'failed'],
      ['worker', 'skipped'],
    ]);
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('partial');
  });

  it('runs rollback for a failed component and records the release rolled back', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          smoke_test: 'npm run smoke:api',
          rollback: 'npm run rollback:api',
        },
        frontend: {
          trigger: 'auto',
          depends_on: ['api'],
          smoke_test: 'npm run smoke:frontend',
        },
      },
    });

    const commands: string[] = [];
    const result = await runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async (command) => {
        commands.push(command);
        if (command === 'npm run smoke:api') throw new Error('smoke failed');
      }),
    });

    expect(commands).toEqual(['npm run smoke:api', 'npm run rollback:api']);
    expect(result?.status).toBe('rolled_back');
    expect(result?.components.map(component => [component.componentKey, component.status])).toEqual([
      ['api', 'rolled_back'],
      ['frontend', 'skipped'],
    ]);
    expect(result?.components[0]?.rollbackStatus).toBe('rolled_back');
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('rolled_back');
  });

  it('skips cleanly and never invokes release execution when no release config exists', async () => {
    seedMergeAndProject(undefined);
    const runCommand = vi.fn(async () => undefined);

    const result = await runRelease('PAN-399', '/repo/overdeck', { runCommand });

    expect(result).toBeNull();
    expect(runCommand).not.toHaveBeenCalled();
    expect(mocks.persistedSets).toEqual([]);
    expect(mocks.reviewUpdates.at(-1)?.update).toEqual({
      releaseStatus: 'skipped',
      releaseNotes: 'No release config found for project.',
    });
  });
});
