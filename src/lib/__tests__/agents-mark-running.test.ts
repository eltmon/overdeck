import { describe, it, expect } from 'vitest';
import { __testInternals, markAgentStoppedState, type AgentState } from '../agents.js';
import { getAgentResumeGateBlockReason } from '../agents/agent-state.js';

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
    markAgentStopped(state, 'operator');
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
  it('sets stoppedByUser=true for an operator-initiated stop', () => {
    const state = baseState();
    markAgentStopped(state, 'operator');
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBe(true);
    expect(state.stoppedAt).toBeDefined();
  });

  // PAN-3324: an OOM kill, crash, or machinery stop recorded as stoppedByUser
  // engages the operator-stop gate, which permanently suppresses autonomous
  // re-drive. The stop still happens — only the attribution changes.
  it('leaves stoppedByUser unset for a system-caused stop', () => {
    const state = baseState();
    markAgentStopped(state, 'system');
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBeUndefined();
    expect(state.stoppedAt).toBeDefined();
  });

  it('clears a stale stoppedByUser when the new stop is system-caused', () => {
    const state = { ...baseState(), stoppedByUser: true };
    markAgentStopped(state, 'system');
    expect(state.stoppedByUser).toBeUndefined();
  });

  it('does not engage the operator-stop resume gate after a system stop', () => {
    const state = baseState();
    markAgentStopped(state, 'system');
    expect(getAgentResumeGateBlockReason(state)).toBeUndefined();

    markAgentStopped(state, 'operator');
    expect(getAgentResumeGateBlockReason(state)?.gate).toBe('stopped-by-user');
  });
});

describe('markAgentStoppedState', () => {
  it('defaults to the system cause so an omitted attribution cannot stall an agent', () => {
    const state = markAgentStoppedState(baseState());
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBeUndefined();
  });
});
