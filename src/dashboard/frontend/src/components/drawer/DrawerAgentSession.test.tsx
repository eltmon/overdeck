import { describe, expect, it } from 'vitest';

import type { Agent } from '../../types';
import { pickDefaultDrawerAgent } from './DrawerAgentSession';

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('pickDefaultDrawerAgent', () => {
  it('returns null when there are no agents', () => {
    expect(pickDefaultDrawerAgent([])).toBeNull();
  });

  it('prefers a live work agent over other live agents', () => {
    const agents = [
      agent({ id: 'agent-review', role: 'review', status: 'running' }),
      agent({ id: 'agent-work', role: 'work', status: 'running' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-work');
  });

  it('falls back to an ended work agent when no work agent is live', () => {
    const agents = [
      agent({ id: 'agent-review', role: 'review', status: 'running' }),
      agent({ id: 'agent-work', role: 'work', status: 'stopped' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-work');
  });

  it('falls back to any live agent when there is no work agent', () => {
    const agents = [
      agent({ id: 'agent-plan-dead', role: 'plan', status: 'dead' }),
      agent({ id: 'agent-review-live', role: 'review', status: 'running' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-review-live');
  });

  it('falls back to the first agent when every agent has ended', () => {
    const agents = [
      agent({ id: 'agent-a', role: 'review', status: 'failed' }),
      agent({ id: 'agent-b', role: 'plan', status: 'stopped' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-a');
  });
});
