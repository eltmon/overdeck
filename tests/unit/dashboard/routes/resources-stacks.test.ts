import type { SystemHealthSnapshot as AcceptedSystemHealthSnapshot } from '@overdeck/contracts';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/dashboard/server/services/dashboard-poll-snapshots.js', () => ({
  getAgentCostStatsSnapshot: async () => [],
}));

// PAN-3917: derived state is read from its owners. Stub the door so the
// grouping assertions stay offline.
const derivedStates = vi.hoisted(() => new Map<string, { issueId: string; state: string }>());
vi.mock('../../../../src/dashboard/server/services/derived-issue-state.js', () => ({
  loadIssueStatesForProject: async (_projectPath: string, issueIds: readonly string[]) =>
    new Map(issueIds.map((id) => [id, derivedStates.get(id) ?? { issueId: id, state: 'working' }])),
  getDerivedIssueState: async (issueId: string) =>
    derivedStates.get(issueId) ?? { issueId, state: 'working' },
  listReadyIssuesForProject: async () => [],
}));

// PAN-3917 W6: the backend inventory replaces the persisted agent mirror.
vi.mock('../../../../src/dashboard/server/services/backend-inventory.js', () => ({
  getBackendPanes: async () => [],
  getBackendPanesForIssue: async () => [],
  hasLiveBackendPane: async () => false,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mockSpawn,
}));

import {
  buildResourceStacks,
  getResourcesEffect,
  resetCurrentDockerStatsReaderForTests,
  resetSpawnGateHealthEvidenceReaderForTests,
  setCurrentDockerStatsReaderForTests,
  setSpawnGateHealthEvidenceReaderForTests,
  type ResourceStack,
  type StackContainerResource,
} from '../../../../src/dashboard/server/routes/resources.js';
import type { SystemHealthSnapshot } from '../../../../src/dashboard/server/services/system-health-service.js';

afterEach(() => {
  resetCurrentDockerStatsReaderForTests();
  resetSpawnGateHealthEvidenceReaderForTests();
  vi.restoreAllMocks();
});

beforeEach(() => {
  derivedStates.clear();
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

  it('attaches the derived issue state to the stack', async () => {
    setCurrentDockerStatsReaderForTests(() => [container('api')]);
    derivedStates.set('MIN-857', { issueId: 'MIN-857', state: 'merged' });

    const body = await getResourcesJson();

    expect(findStack(body.stacks, 'MIN-857')).toMatchObject({ state: 'merged' });
  });

  it('reports a stack with no issue as stateless rather than guessing', () => {
    const stacks = buildResourceStacks([
      { id: 'loose', name: 'redis', cpuPercent: 1, memoryUsage: 50, status: 'running' },
    ]);
    expect(findStack(stacks, 'unassigned')).toMatchObject({ state: null });
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
  setSpawnGateHealthEvidenceReaderForTests(async () => ({
    accepted: acceptedHealthFixture(),
    compatibility: healthFixture(),
  }));
  const response = await Effect.runPromise(getResourcesEffect());
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, any>;
}

function acceptedHealthFixture(): AcceptedSystemHealthSnapshot {
  const gib = 1024 ** 3;
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-07T12:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 0,
        loadAverage1m: 0,
        loadPerCore1m: 0,
        totalMemoryBytes: 16 * gib,
        usedMemoryBytes: 8 * gib,
        availableMemoryBytes: 8 * gib,
        memoryUsedPercent: 50,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 8 * gib,
        commitLimitBytes: 24 * gib,
        virtualCommitmentPercent: 33.3,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 8 * gib,
      admittedWorkAgentCount: 0,
      reasons: [],
    },
    agents: [],
    services: [],
    topConsumers: [],
    summary: healthFixture().summary,
  };
}

function healthFixture(): SystemHealthSnapshot {
  return {
    severity: 'normal',
    state: 'healthy',
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
    structuredReasons: [],
    admission: { admittedWorkAgentCount: 0 },
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: {
      configured: false,
      running: false,
      status: 'not_configured',
      message: 'not configured',
    },
    deployStaleness: null,
    freshness: {
      status: 'fresh',
      observedAt: '2026-07-07T12:00:00.000Z',
    },
    transitionVersion: 1,
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
