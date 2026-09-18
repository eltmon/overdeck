import { describe, expect, it } from 'vitest';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import {
  activityForPaneState,
  mergeRuntimeBySequence,
} from '../../../../../src/dashboard/server/services/agent-state-service.js';

function runtime(activity: AgentRuntimeSnapshot['activity'], sequence: number): AgentRuntimeSnapshot {
  return {
    id: 'agent-pan-3183',
    activity,
    lastActivity: '2026-07-27T02:52:14.000Z',
    updatedAtSequence: sequence,
  } as AgentRuntimeSnapshot;
}

describe('activityForPaneState', () => {
  it('maps the backend pane vocabulary onto the read model activity', () => {
    expect(activityForPaneState('working')).toBe('working');
    expect(activityForPaneState('blocked')).toBe('waiting');
    expect(activityForPaneState('idle')).toBe('idle');
    expect(activityForPaneState('done')).toBe('stopped');
    expect(activityForPaneState('exited')).toBe('stopped');
    expect(activityForPaneState('unknown')).toBe('idle');
  });
});

describe('mergeRuntimeBySequence', () => {
  it('keeps the backend-seeded stop when the pane is not live', () => {
    const merged = mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 726958) },
      { 'agent-pan-3183': runtime('stopped', 0) },
      { 'agent-pan-3183': false },
    );

    expect(merged['agent-pan-3183']?.activity).toBe('stopped');
  });

  it('keeps the event-folded running state when the pane is live', () => {
    const merged = mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 726958) },
      { 'agent-pan-3183': runtime('stopped', 0) },
      { 'agent-pan-3183': true },
    );

    expect(merged['agent-pan-3183']?.activity).toBe('working');
  });

  it('preserves sequence precedence when both snapshots are running', () => {
    const live = { 'agent-pan-3183': true };

    expect(mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 1) },
      { 'agent-pan-3183': runtime('working', 2) },
      live,
    )['agent-pan-3183']?.updatedAtSequence).toBe(2);

    expect(mergeRuntimeBySequence(
      { 'agent-pan-3183': runtime('working', 3) },
      { 'agent-pan-3183': runtime('working', 2) },
      live,
    )['agent-pan-3183']?.updatedAtSequence).toBe(3);
  });

  it('keeps an in-memory snapshot the backend seed does not know about', () => {
    const merged = mergeRuntimeBySequence(
      { 'agent-pan-9999': runtime('working', 5) },
      {},
      {},
    );

    expect(merged['agent-pan-9999']?.activity).toBe('working');
  });
});
