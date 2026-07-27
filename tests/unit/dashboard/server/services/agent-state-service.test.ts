import { describe, expect, it } from 'vitest';
import type { AgentRuntimeSnapshot, AgentSnapshot } from '@overdeck/contracts';
import { mergeRuntimeBySequence } from '../../../../../src/dashboard/server/services/agent-state-service.js';

function runtime(activity: AgentRuntimeSnapshot['activity'], sequence: number): AgentRuntimeSnapshot {
  return {
    id: 'agent-pan-3183',
    activity,
    lastActivity: '2026-07-27T02:52:14.000Z',
    updatedAtSequence: sequence,
  } as AgentRuntimeSnapshot;
}

function sourceAgent(hasLiveTmuxSession: boolean, status: AgentSnapshot['status'] = 'stopped'): AgentSnapshot {
  return {
    id: 'agent-pan-3183',
    issueId: 'PAN-3183',
    status,
    hasLiveTmuxSession,
  } as AgentSnapshot;
}

describe('mergeRuntimeBySequence', () => {
  it('keeps a source-reconstructed stop when no live tmux session exists', () => {
    const merged = mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 726958) },
      { 'agent-pan-3183': runtime('stopped', 0) },
      { 'agent-pan-3183': sourceAgent(false) },
    );

    expect(merged['agent-pan-3183']?.activity).toBe('stopped');
  });

  it('keeps the event-folded running state when a live tmux session exists', () => {
    const merged = mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 726958) },
      { 'agent-pan-3183': runtime('stopped', 0) },
      { 'agent-pan-3183': sourceAgent(true) },
    );

    expect(merged['agent-pan-3183']?.activity).toBe('working');
  });

  it('preserves sequence precedence when both snapshots are running', () => {
    const source = { 'agent-pan-3183': sourceAgent(true, 'running') };

    expect(mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 1) },
      { 'agent-pan-3183': runtime('working', 2) },
      source,
    )['agent-pan-3183']?.updatedAtSequence).toBe(2);

    expect(mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 3) },
      { 'agent-pan-3183': runtime('working', 2) },
      source,
    )['agent-pan-3183']?.updatedAtSequence).toBe(3);
  });
});
