import { describe, expect, it } from 'vitest';

import { buildConfirmedDeadAgentEvents } from '../../../../src/lib/cloister/agent-status-events.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state-read.js';

function state(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    workspace: '/repo/workspaces/feature-pan-1',
    role: 'work',
    model: 'claude',
    status: 'running',
    startedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  } as AgentState;
}

describe('buildConfirmedDeadAgentEvents', () => {
  it('with a running state, returns heartbeat_dead then status_changed asserting stopped/no live pane', () => {
    const events = buildConfirmedDeadAgentEvents('agent-pan-1', state(), () => '2026-09-28T00:00:00.000Z');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'agent.heartbeat_dead',
      payload: { agentId: 'agent-pan-1', issueId: 'PAN-1', sessionId: undefined },
    });
    expect(events[1]).toMatchObject({
      type: 'agent.status_changed',
      payload: {
        agentId: 'agent-pan-1',
        issueId: 'PAN-1',
        status: 'stopped',
        previousStatus: 'running',
        hasLivePane: false,
        hasLiveTmuxSession: false,
      },
    });
  });

  it('with state null, returns exactly one heartbeat_dead event with payload { agentId }', () => {
    const events = buildConfirmedDeadAgentEvents('agent-pan-1', null, () => '2026-09-28T00:00:00.000Z');

    expect(events).toEqual([
      { type: 'agent.heartbeat_dead', timestamp: '2026-09-28T00:00:00.000Z', payload: { agentId: 'agent-pan-1' } },
    ]);
  });

  it('previousStatus is never undefined when a state is given', () => {
    const events = buildConfirmedDeadAgentEvents('agent-pan-1', state({ status: 'starting' }), () => '2026-09-28T00:00:00.000Z');

    expect(events[1]).toMatchObject({
      payload: { status: 'stopped', previousStatus: 'starting' },
    });
  });

  it('does not mutate the input state object', () => {
    const input = state();

    buildConfirmedDeadAgentEvents('agent-pan-1', input, () => '2026-09-28T00:00:00.000Z');

    expect(input.status).toBe('running');
  });
});
