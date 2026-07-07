import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mockSpawn,
}));

import {
  buildResourceStacks,
  getResourcesEffect,
  resetCurrentDockerStatsReaderForTests,
  resetResourceStackReviewStatusReaderForTests,
  resetSpawnGateHealthSnapshotReaderForTests,
  setCurrentDockerStatsReaderForTests,
  setResourceStackReviewStatusReaderForTests,
  setSpawnGateHealthSnapshotReaderForTests,
  type ResourceStack,
  type StackContainerResource,
} from '../../../../src/dashboard/server/routes/resources.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { SystemHealthSnapshot } from '../../../../src/dashboard/server/services/system-health-service.js';

afterEach(() => {
  resetCurrentDockerStatsReaderForTests();
  resetResourceStackReviewStatusReaderForTests();
  resetSpawnGateHealthSnapshotReaderForTests();
  vi.restoreAllMocks();
});

describe('resources stack payload', () => {
  it('groups compose-project containers into an issue stack with summed CPU and RAM', async () => {
    setCurrentDockerStatsReaderForTests(() => [
      container('api', { cpuPercent: 10.2, memoryUsage: 100 }),
      container('worker', { cpuPercent: 2.3, memoryUsage: 200 }),
    ]);

    const body = await getResourcesJson();
    const stack = findStack(body.stacks, 'MIN-857');

    expect(stack).toMatchObject({
      issueId: 'MIN-857',
      composeProject: 'myn-feature-min-857',
      serviceCount: 2,
      aggregates: {
        cpuPercent: 12.5,
        memoryBytes: 300,
      },
    });
  });

  it('attaches merged phase from the review-status read door', async () => {
    setCurrentDockerStatsReaderForTests(() => [container('api')]);
    setResourceStackReviewStatusReaderForTests((issueId) => issueId === 'MIN-857'
      ? reviewStatus({ issueId, mergeStatus: 'merged' })
      : null);

    const body = await getResourcesJson();

    expect(findStack(body.stacks, 'MIN-857')).toMatchObject({
      phase: 'merged',
    });
  });

  it('keeps unmapped containers in an unassigned pseudo-stack without losing services', () => {
    const stacks = buildResourceStacks([
      container('api'),
      {
        id: 'loose',
        name: 'redis',
        cpuPercent: 1,
        memoryUsage: 50,
        status: 'running',
      },
    ]);

    const totalServices = stacks.reduce((sum, stack) => sum + stack.serviceCount, 0);

    expect(totalServices).toBe(2);
    expect(findStack(stacks, 'unassigned')).toMatchObject({
      id: 'unassigned',
      issueId: null,
      serviceCount: 1,
    });
  });

  it('does not spawn docker commands while serving GET /api/resources', async () => {
    mockSpawn.mockClear();
    setCurrentDockerStatsReaderForTests(() => [container('api')]);

    await getResourcesJson();

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

async function getResourcesJson(): Promise<Record<string, any>> {
  setSpawnGateHealthSnapshotReaderForTests(async () => healthFixture());
  const response = await Effect.runPromise(getResourcesEffect());
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, any>;
}

function healthFixture(): SystemHealthSnapshot {
  return {
    severity: 'normal',
    updatedAt: '2026-07-07T12:00:00.000Z',
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      totalMemoryBytes: 16 * 1024 ** 3,
      usedMemoryBytes: 8 * 1024 ** 3,
      availableMemoryBytes: 8 * 1024 ** 3,
      memoryUsedPercent: 50,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 0,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
    },
    thresholds: {
      memoryAvailableWarningBytes: 4 * 1024 ** 3,
      memoryAvailableCriticalBytes: 2 * 1024 ** 3,
      swapUsedWarningPercent: 40,
      swapUsedCriticalPercent: 70,
      cpuLoadWarningPerCore: 2,
      cpuLoadCriticalPerCore: 4,
      overcommitWarningPercent: 80,
      overcommitCriticalPercent: 95,
    },
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: {
      configured: false,
      running: false,
      status: 'not_configured',
      message: 'not configured',
    },
  };
}

function findStack(stacks: unknown, id: string): ResourceStack {
  const match = (stacks as ResourceStack[]).find((stack) => stack.id === id || stack.issueId === id);
  expect(match).toBeTruthy();
  return match as ResourceStack;
}

function container(service: string, overrides: Partial<StackContainerResource> = {}): StackContainerResource {
  return {
    id: `container-${service}`,
    name: `myn-feature-min-857-${service}-1`,
    cpuPercent: 1,
    memoryUsage: 100,
    memoryLimit: 1024,
    status: 'running',
    labels: {
      'com.docker.compose.project': 'myn-feature-min-857',
      'com.docker.compose.service': service,
    },
    ...overrides,
  };
}

function reviewStatus(overrides: Partial<ReviewStatus>): ReviewStatus {
  return {
    issueId: 'MIN-857',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    updatedAt: '2026-07-07T12:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}
