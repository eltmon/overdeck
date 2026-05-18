import { describe, it, expect } from 'vitest';
import { __testInternals, type AgentState } from '../agents.js';

const { markAgentRunning, markAgentStopped } = __testInternals;

function baseState(): AgentState {
  return {
    id: 'test-agent-1',
    issueId: 'PAN-999',
    workspace: '/tmp/test-workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
}

describe('markAgentRunning', () => {
  it('clears stoppedByUser so a later crash can be auto-resumed', () => {
    const state = baseState();
    markAgentStopped(state);
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBe(true);

    markAgentRunning(state);
    expect(state.status).toBe('running');
    expect(state.stoppedByUser).toBeUndefined();
    expect(state.stoppedAt).toBeUndefined();
  });

  it('is a no-op on stoppedByUser when the flag was never set', () => {
    const state = baseState();
    markAgentRunning(state);
    expect(state.stoppedByUser).toBeUndefined();
  });

  it('refuses to run paused agents', () => {
    const state = { ...baseState(), status: 'stopped' as const, paused: true, pausedReason: 'manual inspection' };

    expect(() => markAgentRunning(state)).toThrow(/agent is paused/);
    expect(state.status).toBe('stopped');
    expect(state.paused).toBe(true);
  });

  it('refuses to run troubled agents', () => {
    const state = { ...baseState(), status: 'stopped' as const, troubled: true, consecutiveFailures: 3 };

    expect(() => markAgentRunning(state)).toThrow(/agent is troubled/);
    expect(state.status).toBe('stopped');
    expect(state.troubled).toBe(true);
  });
});

describe('markAgentStopped', () => {
  it('sets stoppedByUser=true to signal user-initiated stop', () => {
    const state = baseState();
    markAgentStopped(state);
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBe(true);
    expect(state.stoppedAt).toBeDefined();
  });
});
