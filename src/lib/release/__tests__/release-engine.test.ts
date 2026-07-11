import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, vi } from 'vitest';
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
    components: releaseSet.components.map((component: any) => (
      component.componentKey === componentKey
        ? { ...component, ...patch, componentKey }
        : component
    )),
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

describe('runRelease', () => {
  beforeEach(() => {
    mocks.mergeSet = null;
    mocks.project = null;
    mocks.reviewUpdates = [];
    mocks.persistedSets = [];
    vi.clearAllMocks();
  });

  it('marks all auto components passed when health and smoke checks pass', async () => {
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
          smoke_test: 'npm run smoke:frontend',
        },
      },
    });

    const commands: Array<{ command: string; timeoutMs: number }> = [];
    const result = await runRelease('PAN-399', '/repo/overdeck', {
      commandTimeoutMs: 1234,
      fetchHealth: vi.fn(async () => ({ ok: true, status: 200 })),
      runCommand: vi.fn(async (command, timeoutMs) => {
        commands.push({ command, timeoutMs });
      }),
    });

    expect(result?.status).toBe('passed');
    expect(result?.components.map(component => [component.componentKey, component.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'passed'],
    ]);
    expect(commands).toEqual([
      { command: 'npm run smoke:api', timeoutMs: 1234 },
      { command: 'npm run smoke:frontend', timeoutMs: 1234 },
    ]);
    expect(mocks.reviewUpdates.at(-1)).toMatchObject({
      issueId: 'PAN-399',
      update: { releaseStatus: 'passed' },
    });
  });

  it('halts remaining components and marks a later smoke failure partial', async () => {
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

    expect(result?.status).toBe('partial');
    expect(result?.components.map(component => [component.componentKey, component.status])).toEqual([
      ['api', 'passed'],
      ['frontend', 'failed'],
      ['worker', 'skipped'],
    ]);
    expect(commands).toEqual(['npm run smoke:api', 'npm run smoke:frontend']);
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('partial');
  });

  it('executes rollback and marks the release rolled_back when rollback succeeds', async () => {
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
    const result = await runRelease('PAN-399', '/repo/overdeck', {
      runCommand: vi.fn(async (command) => {
        commands.push(command);
        if (command === 'npm run smoke:api') throw new Error('smoke failed');
      }),
    });

    expect(commands).toEqual(['npm run smoke:api', 'npm run rollback:api']);
    expect(result?.status).toBe('rolled_back');
    expect(result?.components[0]).toMatchObject({
      componentKey: 'api',
      status: 'rolled_back',
      rollbackStatus: 'rolled_back',
    });
    expect(mocks.reviewUpdates.at(-1)?.update.releaseStatus).toBe('rolled_back');
  });

  it('uses async command execution with explicit timeouts and no execSync path', async () => {
    seedMergeAndProject({
      components: {
        api: {
          trigger: 'auto',
          version_check: 'npm run version:api',
        },
      },
    });

    const runCommand = vi.fn(async () => undefined);
    await runRelease('PAN-399', '/repo/overdeck', {
      commandTimeoutMs: 4321,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledWith('npm run version:api', 4321);
    const sourcePath = fileURLToPath(new URL('../release-engine.ts', import.meta.url));
    expect(readFileSync(sourcePath, 'utf-8')).not.toContain('execSync');
  });
});
