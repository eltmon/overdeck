import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import {
  holdAgentPendingInput,
  NOTHING_SETTLED,
  settleAgentPendingInput,
  useAgentPendingInputGate,
} from '../agentPendingInputGate';
import {
  selectAgentsWithPendingAskUserQuestion,
  selectAgentsWithPendingProposedPlan,
  useDashboardStore,
} from '../store';

const AGENT_WITH_QUESTION: AgentSnapshot = {
  id: 'agent-pan-5604',
  issueId: 'PAN-5604',
  status: 'running',
  pendingAskUserQuestion: {
    toolUseId: 'operator-decision:od-1',
    askedAt: '2026-11-23T00:00:00.000Z',
    questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] }],
  },
};

function resetDashboardStore() {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    bootstrapComplete: false,
    snapshotTimestamp: null,
  });
}

function resetGate() {
  useAgentPendingInputGate.setState({ held: NOTHING_SETTLED });
}

beforeEach(() => {
  resetGate();
  resetDashboardStore();
});

describe('agentPendingInputGate', () => {
  it('starts held with the empty NOTHING_SETTLED copy', () => {
    expect(useAgentPendingInputGate.getState().held).toBe(NOTHING_SETTLED);
  });

  it('keeps the earlier held copy when holding an already-held gate, even with an agent question in the store', () => {
    useDashboardStore.setState({ agentsById: { [AGENT_WITH_QUESTION.id]: AGENT_WITH_QUESTION } });

    holdAgentPendingInput();

    expect(useAgentPendingInputGate.getState().held).toBe(NOTHING_SETTLED);
  });

  it('settles to null', () => {
    settleAgentPendingInput();

    expect(useAgentPendingInputGate.getState().held).toBeNull();
  });

  it('captures arrays identical to the selector output when holding after a settle', () => {
    useDashboardStore.setState({ agentsById: { [AGENT_WITH_QUESTION.id]: AGENT_WITH_QUESTION } });
    settleAgentPendingInput();

    holdAgentPendingInput();

    const state = useDashboardStore.getState();
    const held = useAgentPendingInputGate.getState().held;
    expect(held).not.toBeNull();
    expect(held!.agentsWithAskUserQuestion).toBe(selectAgentsWithPendingAskUserQuestion(state));
    expect(held!.agentsWithProposedPlan).toBe(selectAgentsWithPendingProposedPlan(state));
    expect(held!.agentsWithAskUserQuestion).toEqual([AGENT_WITH_QUESTION]);
  });

  it('leaves held unchanged when the store changes after the hold', () => {
    settleAgentPendingInput();
    holdAgentPendingInput();
    const heldBefore = useAgentPendingInputGate.getState().held;

    useDashboardStore.setState({ agentsById: { [AGENT_WITH_QUESTION.id]: AGENT_WITH_QUESTION } });

    expect(useAgentPendingInputGate.getState().held).toBe(heldBefore);
  });
});
