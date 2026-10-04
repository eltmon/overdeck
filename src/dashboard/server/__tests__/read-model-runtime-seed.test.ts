/**
 * PAN-4522 — the read model booted with `agentRuntimeById: {}`, so a client
 * that connected right after a restart saw each agent's spawn-time stamp
 * until its next tool beat. The bootstrap now replays each agent's retained
 * runtime history through `foldRuntimeSeed` before the first snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEvent } from '../event-store.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../services/backend-inventory.js');
  vi.doUnmock('../services/issue-service-singleton.js');
  vi.doUnmock('../event-store.js');
});

function storedAgent(id: string, issueId: string, startedAt: Date): Record<string, unknown> {
  return {
    id,
    issueId,
    role: 'work',
    status: 'running',
    workspace: null,
    sessionId: null,
    harness: 'claude-code',
    model: 'claude',
    startedAt,
    stoppedByUser: null,
    paused: null,
    pausedReason: null,
    troubled: null,
    consecutiveFailures: 0,
    firstFailureInRunAt: null,
    lastFailureNextRetryAt: null,
  };
}

interface FakeStoreOptions {
  queryRuntimeHistory: (types: readonly string[], agentIds: readonly string[]) => StoredEvent[];
}

async function bootSnapshot(options: FakeStoreOptions) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'pan-4522-read-model-'));
  const originalHome = process.env['OVERDECK_HOME'];
  process.env['OVERDECK_HOME'] = tmpHome;
  try {
    vi.resetModules();
    vi.doMock('../services/backend-inventory.js', () => ({
      getBackendPanes: async () => [],
      isBackendInventoryDegraded: () => true,
      onBackendPanesChanged: () => {},
      startBackendInventory: async () => {},
    }));
    vi.doMock('../services/issue-service-singleton.js', () => ({
      getSharedIssueService: () => ({
        getIssues: () => [],
        listDerivedStates: () => [],
        onIssuesChanged: () => {},
        onDerivedStatesChanged: () => {},
      }),
    }));
    const fakeStore = {
      getLatestSequence: () => 100,
      queryByType: () => [],
      queryRuntimeHistory: options.queryRuntimeHistory,
      subscribe: () => () => {},
      emitOnly: () => {},
    };
    vi.doMock('../event-store.js', () => ({ getEventStore: () => fakeStore }));

    const { ReadModelService, ReadModelServiceLive } = await import('../read-model.js');
    const { AgentsResolver: AR } = await import('../../../lib/overdeck/agents.js');
    const startedAt = new Date(Date.now() - 71 * 60 * 1000);
    const mockLayer = Layer.succeed(AR, AR.of({
      list: (_f: never) => Effect.succeed([storedAgent('agent-pan-4256', 'PAN-4256', startedAt)] as never),
      get: (_id: never) => Effect.fail(new Error('not found') as never),
      isAlive: (_id: never) => Effect.succeed(false),
      getRuntime: (_id: never) => Effect.succeed(null),
      getHealthHistory: (_id: never) => Effect.succeed([]),
    }));
    const program = Effect.gen(function* () {
      const svc = yield* ReadModelService;
      return yield* svc.getSnapshot;
    });
    return await Effect.runPromise(Effect.provide(program, ReadModelServiceLive.pipe(Layer.provide(mockLayer))));
  } finally {
    process.env['OVERDECK_HOME'] = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

describe('ReadModel boot — runtime seed (PAN-4522)', () => {
  it('seeds the newest replayed activity_changed stamp into the first snapshot (AC1)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const snapshot = await bootSnapshot({
      queryRuntimeHistory: () => [
        {
          type: 'agent.activity_changed',
          sequence: 90,
          timestamp: '2026-10-04T03:00:00.000Z',
          payload: { agentId: 'agent-pan-4256', activity: 'working' },
        },
        {
          type: 'agent.activity_changed',
          sequence: 95,
          timestamp: '2026-10-04T03:33:00.000Z',
          payload: { agentId: 'agent-pan-4256', activity: 'idle' },
        },
      ],
    });

    expect(snapshot.agentRuntimeById?.['agent-pan-4256']?.lastActivity).toBe('2026-10-04T03:33:00.000Z');
  });

  it('keeps sequence and recentActivity and boots with an empty runtime map when the seed query throws', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const snapshot = await bootSnapshot({
      queryRuntimeHistory: () => {
        throw new Error('boom');
      },
    });

    expect(snapshot.agentRuntimeById).toEqual({});
    expect(snapshot.sequence).toBe(100);
    expect(consoleError).toHaveBeenCalledWith('[ReadModel] Failed to seed the runtime map:', expect.any(Error));
  });
});
