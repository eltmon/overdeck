import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeSnapshot, DomainEvent } from '@overdeck/contracts';
import {
  activityForPaneState,
  mergeRuntimeBySequence,
  observeSessionIndexEvent,
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

describe('observeSessionIndexEvent', () => {
  it('contains strict persistence failures so the runtime projection can continue', () => {
    const failure = new Error('disk full');
    const log = vi.fn();
    expect(() => observeSessionIndexEvent({
      type: 'agent.model_set',
      timestamp: '2026-09-20T00:00:00.000Z',
      payload: { agentId: 'agent-pan-3950', model: 'claude-sonnet-4-6', claudeSessionId: 'session-1' },
    } as DomainEvent, () => { throw failure; }, log)).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      '[AgentStateService] Failed to observe session index for agent-pan-3950:',
      failure,
    );
  });

  it('passes a transcriptPath-carrying model_set event through as the recorded path', () => {
    const append = vi.fn();
    observeSessionIndexEvent({
      type: 'agent.model_set',
      timestamp: '2026-09-20T00:00:00.000Z',
      payload: {
        agentId: 'agent-pan-3950',
        model: 'claude-sonnet-4-6',
        claudeSessionId: 'session-1',
        transcriptPath: '/abs/path/to/session-1.jsonl',
      },
    } as DomainEvent, append);

    expect(append).toHaveBeenCalledWith('agent-pan-3950', 'session-1', 'session-start', {
      model: 'claude-sonnet-4-6',
      path: '/abs/path/to/session-1.jsonl',
    });
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
