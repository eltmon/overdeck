import { describe, expect, it } from 'vitest';
import type { HerdrLivenessProbe } from '../../../src/lib/terminal-backends/herdr.js';
import { findConflictingWorkAgents } from '../../../src/lib/work-agent-conflicts.js';

type Agents = Parameters<typeof findConflictingWorkAgents>[2];

/** A fake Herdr backend: each agent id maps to the probe answer Herdr gives. */
function herdr(answers: Record<string, HerdrLivenessProbe['kind']>) {
  return {
    backend: 'herdr' as const,
    probeHerdr: async (id: string): Promise<HerdrLivenessProbe> =>
      ({ kind: answers[id] ?? 'exited' }) as HerdrLivenessProbe,
    queryTmuxSession: async () => 'missing' as const,
  };
}

describe('findConflictingWorkAgents', () => {
  it('blocks a live swarm slot but ignores dead history and other issues', async () => {
    const agents = [
      { id: 'agent-pan-2499-slot-2', issueId: 'PAN-2499', role: 'work', status: 'running' },
      { id: 'agent-pan-2499-slot-1', issueId: 'PAN-2499', role: 'work', status: 'stopped' },
      { id: 'agent-pan-1232-test', issueId: 'PAN-1232', role: 'test', status: 'running' },
    ] as Agents;
    const liveness = herdr({ 'agent-pan-2499-slot-2': 'alive', 'agent-pan-1232-test': 'alive' });

    expect((await findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents, {}, liveness)).map((agent) => agent.id))
      .toEqual(['agent-pan-2499-slot-2']);
  });

  it('ignores registered slot agents when a swarm foreman is being recovered', async () => {
    const agents = [
      { id: 'agent-pan-2499-slot-2', issueId: 'PAN-2499', role: 'work', slotIndex: 2 },
      { id: 'agent-pan-2499-helper', issueId: 'PAN-2499', role: 'work' },
    ] as Agents;
    const liveness = herdr({ 'agent-pan-2499-slot-2': 'alive', 'agent-pan-2499-helper': 'alive' });

    expect((await findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents, { ignoreRegisteredSlots: true }, liveness))
      .map(agent => agent.id)).toEqual(['agent-pan-2499-helper']);
  });

  it('sees a live Herdr work session even though it has no tmux session (#4105)', async () => {
    const agents = [
      { id: 'agent-pan-2499-slot-1', issueId: 'PAN-2499', role: 'work', status: 'running', tmuxActive: false },
    ] as Agents;

    expect((await findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents, {}, herdr({ 'agent-pan-2499-slot-1': 'alive' })))
      .map((agent) => agent.id)).toEqual(['agent-pan-2499-slot-1']);
  });

  it('treats an unanswered probe as live, so an outage blocks the start', async () => {
    const agents = [{ id: 'agent-pan-2499-slot-1', issueId: 'PAN-2499', role: 'work', status: 'running' }] as Agents;

    expect((await findConflictingWorkAgents('PAN-2499', 'agent-pan-2499', agents, {}, herdr({ 'agent-pan-2499-slot-1': 'indeterminate' })))
      .map((agent) => agent.id)).toEqual(['agent-pan-2499-slot-1']);
  });
});
