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
const dbPrepareSpy = vi.fn(() => ({ run: vi.fn() }));

vi.mock('../../../../src/lib/reconstruct/reconstruct-cache.js', () => ({
  reconstructCache: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(),
  getSharedDb: vi.fn(),
}));

vi.mock('../../../../src/lib/agent-runtime-mirror.js', () => ({
  setAgentRuntimeMirror: vi.fn(() => Effect.void),
  getRuntimeSnapshot: vi.fn(() => ({})),
  markAgentStateServiceInProcess: vi.fn(() => Effect.void),
}));

vi.mock('../../../../src/dashboard/server/services/projection-cache.js', () => ({
  getProjectionCache: vi.fn(() => ({ load: vi.fn(() => null), save: vi.fn() })),
  initProjectionCache: vi.fn(),
}));

import { reconstructCache } from '../../../../src/lib/reconstruct/reconstruct-cache.js';
import { initEventStore, getSharedDb } from '../../../../src/dashboard/server/event-store.js';
import { AgentStateServiceLive } from '../../../../src/dashboard/server/services/agent-state-service.js';
import { ReadModelServiceLive } from '../../../../src/dashboard/server/read-model.js';

const reconstructCacheMock = vi.mocked(reconstructCache);
const initEventStoreMock = vi.mocked(initEventStore);
const getSharedDbMock = vi.mocked(getSharedDb);

beforeEach(() => {
  vi.resetAllMocks();
  reconstructCacheMock.mockResolvedValue(fakeReconstructResult as any);
  initEventStoreMock.mockResolvedValue({
    readFrom: readFromSpy,
    subscribe: subscribeSpy,
    appendAsync: appendAsyncSpy,
    emitOnly: vi.fn(),
  } as any);
  getSharedDbMock.mockReturnValue({ prepare: dbPrepareSpy } as any);
});

describe('AgentStateService bootstrap (PAN-1920)', () => {
  it('seeds from reconstructCache and does not replay the event log', async () => {
    await Effect.runPromise(Effect.provide(Effect.void, AgentStateServiceLive));
    await vi.waitFor(() => expect(reconstructCacheMock).toHaveBeenCalled());

    expect(readFromSpy).not.toHaveBeenCalled();
    expect(subscribeSpy).toHaveBeenCalled();
  });
});

describe('ReadModelService bootstrap (PAN-1920)', () => {
  it('seeds agents and review statuses from reconstructCache', async () => {
    await Effect.runPromise(Effect.provide(Effect.void, ReadModelServiceLive));
    await vi.waitFor(() => expect(reconstructCacheMock).toHaveBeenCalled());
  });
});
