import { describe, expect, it } from 'vitest';

import type { Agent } from '../../types';
import {
  compareWorkAgents,
  getIssueWorkAgentMap,
  getIssueWorkAgents,
  getSwarmSlotNumber,
  getWorkSessionLabel,
  isAgentSessionAttachable,
} from '../swarmSlots';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-pan-971',
    issueId: 'PAN-971',
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('swarmSlots helpers', () => {
  it('extracts slot number from swarm work agent ids', () => {
    expect(getSwarmSlotNumber('agent-pan-971-2')).toBe(2);
    expect(getSwarmSlotNumber('agent-min-42-7')).toBe(7);
  });

  it('does not treat plain work agents as slot sessions', () => {
    expect(getSwarmSlotNumber('agent-pan-971')).toBeNull();
    expect(getSwarmSlotNumber('planning-pan-971')).toBeNull();
  });

  it('sorts root work agent before slot sessions, then by slot number', () => {
    const agents = [
      makeAgent({ id: 'agent-pan-971-3' }),
      makeAgent({ id: 'agent-pan-971' }),
      makeAgent({ id: 'agent-pan-971-1' }),
      makeAgent({ id: 'agent-pan-971-2' }),
    ];

    expect(agents.sort(compareWorkAgents).map((agent) => agent.id)).toEqual([
      'agent-pan-971',
      'agent-pan-971-1',
      'agent-pan-971-2',
      'agent-pan-971-3',
    ]);
  });

  it('filters work agents for a single issue and excludes planning agents', () => {
    const agents = [
      makeAgent({ id: 'planning-pan-971', issueId: 'PAN-971' }),
      makeAgent({ id: 'agent-pan-971-2', issueId: 'PAN-971' }),
      makeAgent({ id: 'agent-pan-971-1', issueId: 'PAN-971' }),
      makeAgent({ id: 'agent-pan-972', issueId: 'PAN-972' }),
    ];

    expect(getIssueWorkAgents(agents, 'PAN-971').map((agent) => agent.id)).toEqual([
      'agent-pan-971-1',
      'agent-pan-971-2',
    ]);
  });

  it('builds one sorted issue-to-work-agent map per agent list', () => {
    const agents = [
      makeAgent({ id: 'agent-pan-971-2', issueId: 'PAN-971' }),
      makeAgent({ id: 'agent-pan-972-1', issueId: 'PAN-972' }),
      makeAgent({ id: 'planning-pan-971', issueId: 'PAN-971' }),
      makeAgent({ id: 'agent-pan-971-1', issueId: 'PAN-971' }),
    ];

    const byIssue = getIssueWorkAgentMap(agents);

    expect(byIssue.get('pan-971')?.map((agent) => agent.id)).toEqual([
      'agent-pan-971-1',
      'agent-pan-971-2',
    ]);
    expect(byIssue.get('pan-972')?.map((agent) => agent.id)).toEqual([
      'agent-pan-972-1',
    ]);
    expect(byIssue.has('planning-pan-971')).toBe(false);
  });

  it('labels slot sessions for grouped swarm rendering', () => {
    expect(getWorkSessionLabel(makeAgent({ id: 'agent-pan-971-4' }))).toBe('Slot 4');
    expect(getWorkSessionLabel(makeAgent({ id: 'agent-pan-971' }))).toBe('Work');
  });

  it('treats review-response standby sessions as attachable', () => {
    expect(isAgentSessionAttachable(makeAgent({ status: 'stopped', agentPhase: 'review-response' }))).toBe(true);
    expect(isAgentSessionAttachable(makeAgent({ status: 'stopped', agentPhase: 'implementation' }))).toBe(false);
  });
});
