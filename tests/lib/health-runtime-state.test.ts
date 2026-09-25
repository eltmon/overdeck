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
  getAgentEffectiveLastActivityMsMock,
  isAliveMock,
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
  getAgentEffectiveLastActivityMsMock: vi.fn(),
  isAliveMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('../../src/lib/tmux.js', () => ({
  capturePane: vi.fn(async () => ''),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  sessionExists: (name: string) => Effect.promise(() => sessionExistsAsyncMock(name)),
  sessionExistsSync: (name: string) => Effect.promise(() => sessionExistsAsyncMock(name)),
}));

vi.mock('../../src/lib/agents.js', () => ({
  recoverAgent: recoverAgentMock,
  stopAgent: stopAgentMock,
  getAgentState: getAgentStateMock,
  getAgentRuntimeState: getAgentRuntimeStateMock,
  getAgentRuntimeStateSync: getAgentRuntimeStateMock,
}));

// Fake backend: the liveness oracle answers, never a tmux has-session (#4109).
vi.mock('../../src/lib/agents/liveness.js', () => ({
  getAgentEffectiveLastActivityMs: getAgentEffectiveLastActivityMsMock,
  isAlive: isAliveMock,
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

describe('health runtime-state classification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    sessionExistsAsyncMock.mockResolvedValue(true);
    isAliveMock.mockResolvedValue({ alive: true, paneAlive: true });
    getAgentStateMock.mockReturnValue(null);
    getAgentRuntimeStateMock.mockReturnValue(null);
    getAgentEffectiveLastActivityMsMock.mockReturnValue(null);
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

  it('PAN-3546: does not classify a live agent stuck when only effective activity is fresh', async () => {
    // GPT-harness sessions emit no hook-visible activity (textless transcripts),
    // so runtime/state lastActivity freeze at spawn; the effective resolver sees
    // the tmux window_activity and must win over the frozen fields.
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    getAgentStateMock.mockReturnValue({ status: 'running', lastActivity: stale });
    getAgentRuntimeStateMock.mockReturnValue({ state: 'active', lastActivity: stale });
    getAgentEffectiveLastActivityMsMock.mockReturnValue(Date.now() - 60 * 1000);

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-3511'));

    expect(health.status).toBe('healthy');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('PAN-3546: still classifies stuck when the effective resolver has no fresher signal', async () => {
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    getAgentStateMock.mockReturnValue({ status: 'running', lastActivity: stale });
    getAgentRuntimeStateMock.mockReturnValue({ state: 'active', lastActivity: stale });
    getAgentEffectiveLastActivityMsMock.mockReturnValue(new Date(stale).getTime());

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-3511'));

    expect(health.status).toBe('stuck');
    expect(health.reason).toMatch(/No activity for \d+ minutes/);
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

  it('#4109: a live Herdr agent (no tmux session) is not classified dead', async () => {
    sessionExistsAsyncMock.mockResolvedValue(false);
    isAliveMock.mockResolvedValue({ alive: true, paneAlive: true });
    getAgentStateMock.mockReturnValue({ status: 'running' });
    getAgentEffectiveLastActivityMsMock.mockReturnValue(Date.now());

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-4109'));

    expect(health.status).toBe('healthy');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('#4109: an unknown liveness answer is a warning and never counts toward the force-kill threshold', async () => {
    isAliveMock.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    getAgentStateMock.mockReturnValue({ status: 'running' });

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-4109'));

    expect(health.status).toBe('warning');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('#4109: a confirmed-dead verdict is still dead', async () => {
    isAliveMock.mockResolvedValue({ alive: false, reason: 'no-session' });
    getAgentStateMock.mockReturnValue({ status: 'running' });

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent('agent-pan-4109'));

    expect(health.status).toBe('dead');
    expect(health.consecutiveFailures).toBe(1);
  });

  it('#4109: an unknown ping neither increments nor resets the dead-ping counter carried across pings', async () => {
    // Persist health.json across pings in memory.
    const files = new Map<string, string>();
    existsSyncMock.mockImplementation((path: string) => files.has(path));
    readFileSyncMock.mockImplementation((path: string) => files.get(path));
    writeFileSyncMock.mockImplementation((path: string, data: string) => { files.set(path, data); });
    getAgentStateMock.mockReturnValue({ status: 'running' });

    const { pingAgent } = await import('../../src/lib/health.js');
    const ping = async (verdict: { alive: boolean; reason?: string; paneAlive?: boolean }) => {
      isAliveMock.mockResolvedValue(verdict);
      return Effect.runPromise(pingAgent('agent-pan-4109'));
    };

    expect((await ping({ alive: false, reason: 'no-session' })).consecutiveFailures).toBe(1);
    const unknown = await ping({ alive: false, reason: 'runtime-indeterminate' });
    expect(unknown.status).toBe('warning');
    expect(unknown.consecutiveFailures).toBe(1);
    expect((await ping({ alive: false, reason: 'no-session' })).consecutiveFailures).toBe(2);
    expect((await ping({ alive: true, paneAlive: true })).consecutiveFailures).toBe(0);
  });
});
