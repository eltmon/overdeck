import { describe, expect, it } from 'vitest';
import { findConflictingWorkAgents } from '../../../src/lib/work-agent-conflicts.js';

describe('findConflictingWorkAgents', () => {
  it('blocks a live swarm slot but ignores stopped history and other issues', () => {
    const agents = [
      { id: 'agent-pan-2499-slot-2', issueId: 'PAN-2499', role: 'work', tmuxActive: true },
      { id: 'agent-pan-2499-slot-1', issueId: 'PAN-2499', role: 'work', tmuxActive: false },
      { id: 'agent-pan-1232-test', issueId: 'PAN-1232', role: 'test', tmuxActive: true },
    ] as Parameters<typeof findConflictingWorkAgents>[2];

    expect(findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents).map((agent) => agent.id))
      .toEqual(['agent-pan-2499-slot-2']);
  });

  it('ignores registered slot agents when a swarm foreman is being recovered', () => {
    const agents = [
      { id: 'agent-pan-2499-slot-2', issueId: 'PAN-2499', role: 'work', tmuxActive: true, slotIndex: 2 },
      { id: 'agent-pan-2499-helper', issueId: 'PAN-2499', role: 'work', tmuxActive: true },
    ] as Parameters<typeof findConflictingWorkAgents>[2];

    expect(findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents, { ignoreRegisteredSlots: true })
      .map(agent => agent.id)).toEqual(['agent-pan-2499-helper']);
  });
});
