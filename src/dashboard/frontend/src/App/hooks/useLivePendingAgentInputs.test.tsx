import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import { useLivePendingAgentInputs } from './useLivePendingAgentInputs';
import {
  holdAgentPendingInput,
  NOTHING_SETTLED,
  settleAgentPendingInput,
  useAgentPendingInputGate,
} from '../../lib/agentPendingInputGate';
import { useDashboardStore } from '../../lib/store';

function agentWithQuestion(toolUseId: string): AgentSnapshot {
  return {
    id: 'agent-pan-5604',
    issueId: 'PAN-5604',
    status: 'running',
    pendingAskUserQuestion: {
      toolUseId,
      askedAt: '2026-11-23T00:00:00.000Z',
      questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    },
  };
}

function resetDashboardStore() {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    bootstrapComplete: false,
    snapshotTimestamp: null,
  });
}

beforeEach(() => {
  resetDashboardStore();
  useAgentPendingInputGate.setState({ held: NOTHING_SETTLED });
});

describe('useLivePendingAgentInputs', () => {
  it('returns empty arrays while held, even with an agent question in the store', () => {
    useDashboardStore.setState({
      agentsById: { 'agent-pan-5604': agentWithQuestion('operator-decision:od-1') },
    });

    const { result } = renderHook(() => useLivePendingAgentInputs());

    expect(result.current.agentsWithAskUserQuestion).toEqual([]);
    expect(result.current.agentsWithProposedPlan).toEqual([]);
  });

  it('returns the live agent once the gate settles', () => {
    useDashboardStore.setState({
      agentsById: { 'agent-pan-5604': agentWithQuestion('operator-decision:od-1') },
    });
    settleAgentPendingInput();

    const { result } = renderHook(() => useLivePendingAgentInputs());

    expect(result.current.agentsWithAskUserQuestion).toHaveLength(1);
    expect(result.current.agentsWithAskUserQuestion[0]!.id).toBe('agent-pan-5604');
  });

  it('keeps the earlier array while re-held, and switches to the new question on the next settle', () => {
    useDashboardStore.setState({
      agentsById: { 'agent-pan-5604': agentWithQuestion('operator-decision:od-1') },
    });
    settleAgentPendingInput();
    const { result, rerender } = renderHook(() => useLivePendingAgentInputs());
    const earlier = result.current.agentsWithAskUserQuestion;

    holdAgentPendingInput();
    useDashboardStore.setState({
      agentsById: { 'agent-pan-5604': agentWithQuestion('tool-2') },
    });
    rerender();

    expect(result.current.agentsWithAskUserQuestion).toBe(earlier);

    settleAgentPendingInput();
    rerender();

    expect(result.current.agentsWithAskUserQuestion[0]!.pendingAskUserQuestion?.toolUseId).toBe('tool-2');
  });

  it('returns the identical array across two renders while held', () => {
    const { result, rerender } = renderHook(() => useLivePendingAgentInputs());
    const first = result.current.agentsWithAskUserQuestion;

    rerender();

    expect(result.current.agentsWithAskUserQuestion).toBe(first);
  });
});
