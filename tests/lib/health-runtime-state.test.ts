import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  mkdirSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  sessionExistsAsyncMock,
  recoverAgentMock,
  stopAgentMock,
  getAgentStateMock,
  getAgentRuntimeStateMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  sessionExistsAsyncMock: vi.fn(),
  recoverAgentMock: vi.fn(),
  stopAgentMock: vi.fn(),
  getAgentStateMock: vi.fn(),
  getAgentRuntimeStateMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('../../src/lib/tmux.js', () => ({
  capturePane: vi.fn(() => Effect.succeed('')),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  sessionExists: (name: string) => Effect.promise(() => sessionExistsAsyncMock(name)),
  sessionExistsSync: (name: string) => Effect.promise(() => sessionExistsAsyncMock(name)),
}));

vi.mock('../../src/lib/agents.js', () => ({
  recoverAgent: recoverAgentMock,
  stopAgent: stopAgentMock,
  getAgentState: getAgentStateMock,
  getAgentStateSync: getAgentStateMock,
  getAgentRuntimeState: getAgentRuntimeStateMock,
  getAgentRuntimeStateSync: getAgentRuntimeStateMock,
}));

describe('health runtime-state classification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    sessionExistsAsyncMock.mockResolvedValue(true);
    getAgentStateMock.mockReturnValue(null);
    getAgentRuntimeStateMock.mockReturnValue(null);
  });

  it('classifies waiting-on-human as warning instead of stuck', async () => {
    getAgentStateMock.mockReturnValue({
      status: 'active',
      lastActivity: '2026-04-18T18:00:00.000Z',
    });
    getAgentRuntimeStateMock.mockReturnValue({
      state: 'waiting-on-human',
      lastActivity: '2026-04-18T19:32:09.000Z',
      waitingNotification: 'Claude is waiting for your input',
    });

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-446'));

    expect(health.status).toBe('warning');
    expect(health.reason).toBe('Claude is waiting for your input');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('classifies stopped agent as stopped even if tmux session is still alive', async () => {
    getAgentStateMock.mockReturnValue({
      status: 'stopped',
      lastActivity: '2026-04-18T18:00:00.000Z',
    });
    getAgentRuntimeStateMock.mockReturnValue({
      state: 'waiting-on-human',
      lastActivity: '2026-04-18T19:32:09.000Z',
      waitingNotification: 'Claude is waiting for your input',
    });

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-446'));

    expect(health.status).toBe('stopped');
    expect(health.reason).toBe('Agent was intentionally stopped');
    expect(health.consecutiveFailures).toBe(0);
  });
});
