import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';

const fakeReconstructResult = {
  issuesEnumerated: 1,
  agentsRebuilt: 2,
  phaseCounts: { work: 1, review: 0, merge: 0, done: 0 },
  agentsById: {
    'agent-pan-1920': {
      id: 'agent-pan-1920',
      issueId: 'PAN-1920',
      status: 'running',
      role: 'work',
    },
  },
  agentRuntimeById: {
    'agent-pan-1920': {
      id: 'agent-pan-1920',
      activity: 'working',
      lastActivity: new Date().toISOString(),
      updatedAtSequence: 0,
    },
  },
  reviewStatusByIssueId: {},
  phaseByIssueId: { 'PAN-1920': 'work' },
};

const readFromSpy = vi.fn(() => []);
const subscribeSpy = vi.fn(() => () => {});
const appendAsyncSpy = vi.fn(async () => 1);

vi.mock('../../../../src/lib/reconstruct/reconstruct-cache.js', () => ({
  reconstructCache: vi.fn(),
  reconstructCacheAuto: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(),
}));

vi.mock('../../../../src/lib/agent-runtime-mirror.js', () => ({
  setAgentRuntimeMirror: vi.fn(() => Effect.void),
  getRuntimeSnapshot: vi.fn(() => ({})),
  markAgentStateServiceInProcess: vi.fn(() => Effect.void),
}));

import { reconstructCache, reconstructCacheAuto } from '../../../../src/lib/reconstruct/reconstruct-cache.js';
import { initEventStore } from '../../../../src/dashboard/server/event-store.js';
import { AgentStateServiceLive } from '../../../../src/dashboard/server/services/agent-state-service.js';
import { ReadModelServiceLive } from '../../../../src/dashboard/server/read-model.js';
import { AgentsResolver } from '../../../../src/lib/overdeck/agents.js';

const reconstructCacheMock = vi.mocked(reconstructCache);
const reconstructCacheAutoMock = vi.mocked(reconstructCacheAuto);
const initEventStoreMock = vi.mocked(initEventStore);

beforeEach(() => {
  vi.resetAllMocks();
  reconstructCacheMock.mockResolvedValue(fakeReconstructResult as any);
  reconstructCacheAutoMock.mockResolvedValue(fakeReconstructResult as any);
  initEventStoreMock.mockResolvedValue({
    readFrom: readFromSpy,
    subscribe: subscribeSpy,
    appendAsync: appendAsyncSpy,
    emitOnly: vi.fn(),
  } as any);
});

describe('AgentStateService bootstrap (PAN-1920)', () => {
  it('seeds from reconstructCache and does not replay the event log', async () => {
    await Effect.runPromise(Effect.provide(Effect.void, AgentStateServiceLive));
    await vi.waitFor(() => expect(reconstructCacheAutoMock).toHaveBeenCalled());

    expect(readFromSpy).not.toHaveBeenCalled();
    expect(subscribeSpy).toHaveBeenCalled();
  });
});

// Mock AgentsResolver: agents now come from overdeck.db (source-swap PAN-1938),
// reconstructCache still runs for reviewStatusByIssueId.
const MockAgentsResolverLive = Layer.succeed(
  AgentsResolver,
  AgentsResolver.of({
    list: (_f) => Effect.succeed([]),
    get: (_id) => Effect.fail(new Error('not found') as never),
    isAlive: (_id) => Effect.succeed(false),
    getRuntime: (_id) => Effect.succeed(null),
    getHealthHistory: (_id) => Effect.succeed([]),
  }),
);

describe('ReadModelService bootstrap (PAN-1938 source-swap)', () => {
  it('seeds reviewStatuses from reconstructCache and agents from AgentsResolver', async () => {
    const layer = ReadModelServiceLive.pipe(Layer.provide(MockAgentsResolverLive));
    await Effect.runPromise(Effect.provide(Effect.void, layer));
    await vi.waitFor(() => expect(reconstructCacheAutoMock).toHaveBeenCalled());
  });
});
