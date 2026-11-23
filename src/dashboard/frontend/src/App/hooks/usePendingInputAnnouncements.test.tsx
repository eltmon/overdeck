/**
 * PAN-5604 — usePendingInputAnnouncements: one toast + desktop notification
 * per pending-input key, dismissed when the key leaves the live set.
 */
import { act, render as renderComponent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'effect';
import type { AgentSnapshot } from '@overdeck/contracts';
import { DomainEvent, INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';

const toastInfo = vi.hoisted(() => vi.fn());
const toastDismiss = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, dismiss: toastDismiss } }));

import { usePendingInputAnnouncements, type ConvAskUserQuestionRow } from './usePendingInputAnnouncements';
import { useLivePendingAgentInputs } from './useLivePendingAgentInputs';
import {
  NOTHING_SETTLED,
  settleAgentPendingInput,
  useAgentPendingInputGate,
} from '../../lib/agentPendingInputGate';
import { useDashboardStore } from '../../lib/store';

const closeSpies = new Map<string, ReturnType<typeof vi.fn>>();

function agentWithQuestion(id: string, toolUseId: string): AgentSnapshot {
  return {
    id,
    issueId: 'PAN-5604',
    status: 'running',
    pendingAskUserQuestion: {
      toolUseId,
      askedAt: '2026-11-23T00:00:00.000Z',
      questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    },
  };
}

function convRowWithQuestion(name: string, toolUseId: string): ConvAskUserQuestionRow {
  return {
    name,
    pendingAskUserQuestion: {
      toolUseId,
      askedAt: '2026-11-23T00:00:00.000Z',
      questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    },
  };
}

function resetDashboardStore(): void {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    bootstrapComplete: false,
    snapshotTimestamp: null,
  });
}

beforeEach(() => {
  toastInfo.mockReset();
  toastDismiss.mockReset();
  closeSpies.clear();
  class FakeNotification {
    static permission = 'granted';
    onclick: (() => void) | null = null;
    onclose: (() => void) | null = null;
    close = vi.fn();
    constructor(_title: string, options?: NotificationOptions) {
      if (options?.tag) closeSpies.set(options.tag, this.close);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  resetDashboardStore();
  useAgentPendingInputGate.setState({ held: NOTHING_SETTLED });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePendingInputAnnouncements unit cases', () => {
  function render(props: {
    agentsWithAskUserQuestion: AgentSnapshot[];
    agentsWithProposedPlan: AgentSnapshot[];
    convRows: ConvAskUserQuestionRow[];
  }) {
    return renderHook(
      (p: typeof props) =>
        usePendingInputAnnouncements({ ...p, issueTitleById: {}, onOpen: vi.fn() }),
      { initialProps: props },
    );
  }

  it('toasts once for a new agent AskUserQuestion key', () => {
    render({
      agentsWithAskUserQuestion: [agentWithQuestion('agent-1', 'tool-1')],
      agentsWithProposedPlan: [],
      convRows: [],
    });

    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(
      'PAN-5604 is waiting on you',
      expect.objectContaining({ id: 'agent::agent-1::tool-1' }),
    );
  });

  it('dismisses the key and closes its notification on a rerender without it', () => {
    const { rerender } = render({
      agentsWithAskUserQuestion: [agentWithQuestion('agent-1', 'tool-1')],
      agentsWithProposedPlan: [],
      convRows: [],
    });

    rerender({ agentsWithAskUserQuestion: [], agentsWithProposedPlan: [], convRows: [] });

    expect(toastDismiss).toHaveBeenCalledWith('agent::agent-1::tool-1');
    expect(closeSpies.get('agent::agent-1::tool-1')).toHaveBeenCalledTimes(1);
  });

  it('toasts and dismisses a conversation AskUserQuestion with the conv:: key', () => {
    const { rerender } = render({
      agentsWithAskUserQuestion: [],
      agentsWithProposedPlan: [],
      convRows: [convRowWithQuestion('conv-1', 'tool-2')],
    });

    expect(toastInfo).toHaveBeenCalledWith(
      '"conv-1" is waiting on you',
      expect.objectContaining({ id: 'conv::conv-1::tool-2' }),
    );

    rerender({ agentsWithAskUserQuestion: [], agentsWithProposedPlan: [], convRows: [] });

    expect(toastDismiss).toHaveBeenCalledWith('conv::conv-1::tool-2');
  });

  it('toasts the same key only once across rerenders', () => {
    const { rerender } = render({
      agentsWithAskUserQuestion: [agentWithQuestion('agent-1', 'tool-1')],
      agentsWithProposedPlan: [],
      convRows: [],
    });

    rerender({
      agentsWithAskUserQuestion: [agentWithQuestion('agent-1', 'tool-1')],
      agentsWithProposedPlan: [],
      convRows: [],
    });

    expect(toastInfo).toHaveBeenCalledTimes(1);
  });
});

describe('usePendingInputAnnouncements end-to-end with the agent pending-input gate', () => {
  function Wrapper() {
    const inputs = useLivePendingAgentInputs();
    usePendingInputAnnouncements({ ...inputs, convRows: [], issueTitleById: {}, onOpen: vi.fn() });
    return null;
  }

  it('shows no toast for cached data, one toast once live, and dismisses it when the server clears the question', () => {
    const AGENT_ID = 'agent-pan-5058';
    act(() => {
      useDashboardStore.setState({
        agentsById: { [AGENT_ID]: agentWithQuestion(AGENT_ID, 'operator-decision:od-82901a56') },
      });
    });

    const { rerender } = renderComponent(<Wrapper />);
    expect(toastInfo).not.toHaveBeenCalled();

    act(() => {
      useDashboardStore.setState({
        agentsById: { [AGENT_ID]: { id: AGENT_ID, issueId: 'PAN-5604', status: 'running' } },
      });
    });
    act(() => {
      settleAgentPendingInput();
    });
    rerender(<Wrapper />);
    expect(toastInfo).not.toHaveBeenCalled();

    act(() => {
      useDashboardStore.setState({
        agentsById: { [AGENT_ID]: agentWithQuestion(AGENT_ID, 'operator-decision:od-82901a56') },
      });
    });
    rerender(<Wrapper />);

    const key = `agent::${AGENT_ID}::operator-decision:od-82901a56`;
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('PAN-5604 is waiting on you', expect.objectContaining({ id: key }));

    const clearingEvent = Schema.decodeUnknownSync(DomainEvent)({
      type: 'agent.enrichment_changed',
      sequence: 1,
      timestamp: '2026-11-23T00:00:01.000Z',
      payload: { agentId: AGENT_ID },
    });
    act(() => {
      useDashboardStore.getState().applyEvent(clearingEvent);
    });
    rerender(<Wrapper />);

    expect(toastDismiss).toHaveBeenCalledWith(key);
    expect(closeSpies.get(key)).toHaveBeenCalledTimes(1);
  });
});
