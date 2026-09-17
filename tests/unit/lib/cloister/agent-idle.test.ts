import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentRuntimeStateSync: vi.fn(),
  getRuntimeForAgent: vi.fn(),
  listPaneValuesSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
}));

vi.mock('../../../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: mocks.getRuntimeForAgent,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listPaneValuesSync: mocks.listPaneValuesSync,
}));

import { getAgentIdleAgeMs, isAgentIdleForNudge } from '../../../../src/lib/cloister/agent-idle.js';

const NOW = new Date('2026-09-17T12:00:00Z').getTime();

function runtimeWithHeartbeat(heartbeatAgeMs: number) {
  mocks.getRuntimeForAgent.mockReturnValue({
    getHeartbeat: () => ({ timestamp: new Date(NOW - heartbeatAgeMs) }),
  });
}

describe('isAgentIdleForNudge (PAN-3846): idle is work activity, never the mirror label alone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPaneValuesSync.mockReturnValue([]);
    mocks.getRuntimeForAgent.mockReturnValue(undefined);
  });

  it('mirror idle with a transcript heartbeat 10 seconds old is NOT idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 10_000).toISOString(),
    });
    runtimeWithHeartbeat(10_000);

    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });

  it('mirror idle with a heartbeat 6 minutes old IS idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 6 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(6 * 60_000);

    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(true);
  });

  it('mirror active with a heartbeat 6 minutes old IS idle (stale active mirror)', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 6 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(6 * 60_000);

    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(true);
  });

  it('mirror active with a fresh heartbeat is NOT idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 30_000).toISOString(),
    });
    runtimeWithHeartbeat(30_000);

    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });

  it('suspended, stopped, and waiting-on-human are never idle', () => {
    for (const state of ['suspended', 'stopped', 'waiting-on-human']) {
      mocks.getAgentRuntimeStateSync.mockReturnValue({
        state,
        lastActivity: new Date(NOW - 60 * 60_000).toISOString(),
      });
      runtimeWithHeartbeat(60 * 60_000);
      expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
    }
  });

  it('no runtime mirror falls back to work activity age', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    runtimeWithHeartbeat(6 * 60_000);
    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(true);

    runtimeWithHeartbeat(10_000);
    expect(isAgentIdleForNudge('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });
});

describe('getAgentIdleAgeMs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPaneValuesSync.mockReturnValue([]);
  });

  it('reports the age of the newest work-activity signal', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 10 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(2 * 60_000);

    expect(getAgentIdleAgeMs('agent-pan-1', NOW)).toBe(2 * 60_000);
  });

  it('returns null when no work-activity signal exists', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.getRuntimeForAgent.mockReturnValue(undefined);

    expect(getAgentIdleAgeMs('agent-pan-1', NOW)).toBeNull();
  });
});
