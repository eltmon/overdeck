import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../store';
import { isBlockingDecision, useDecisions } from '../useDecisions';

function renderDecisions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['conv-ask-user-question'], []);

  return renderHook(() => useDecisions(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

function setDashboardState(
  agentsById: Record<string, Record<string, unknown>>,
  issuesRaw: Array<Record<string, unknown>>,
) {
  useDashboardStore.setState({
    agentsById,
    channelPermissionRequestsById: {},
    issuesRaw,
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

beforeEach(() => {
  setDashboardState({}, []);
});

describe('useDecisions', () => {
  it('formats an agent issue identifier with its resolved issue title', () => {
    setDashboardState(
      {
        'agent-pan-1': {
          id: 'agent-pan-1',
          issueId: 'PAN-1',
          pendingInputKinds: ['askUserQuestion'],
        },
      },
      [{ id: 'PAN-1', title: 'Fix widget' }],
    );

    const { result } = renderDecisions();

    expect(result.current[0]).toMatchObject({
      id: 'agent-pan-1',
      label: 'PAN-1 — Fix widget',
      issueId: 'PAN-1',
      issueTitle: 'Fix widget',
    });
  });

  it('falls back to the issue identifier or agent id when no title resolves', () => {
    setDashboardState(
      {
        'agent-pan-2': {
          id: 'agent-pan-2',
          issueId: 'PAN-2',
          pendingInputKinds: ['askUserQuestion'],
        },
        'agent-unbound': {
          id: 'agent-unbound',
          pendingInputKinds: ['askUserQuestion'],
        },
      },
      [],
    );

    const { result } = renderDecisions();

    expect(result.current.find((decision) => decision.id === 'agent-pan-2')).toMatchObject({
      label: 'PAN-2',
      issueId: 'PAN-2',
    });
    expect(result.current.find((decision) => decision.id === 'agent-unbound')).toMatchObject({
      label: 'agent-unbound',
    });
  });
});

describe('isBlockingDecision', () => {
  it('treats a waiting question as blocking — the agent has stopped', () => {
    expect(isBlockingDecision(['askUserQuestion'])).toBe(true);
  });

  it('treats a rate-limit modal as blocking', () => {
    expect(isBlockingDecision(['rateLimit'])).toBe(true);
  });

  /**
   * The case that started this: an interactive agent that ended its turn is
   * stopped dead until the operator replies, even though nothing "failed".
   */
  it('treats a yielded turn as blocking', () => {
    expect(isBlockingDecision(['agentTurnEnded'])).toBe(true);
  });

  it('does not treat a plan review as blocking — work continues around it', () => {
    expect(isBlockingDecision(['exitPlanMode'])).toBe(false);
  });

  /**
   * PAN-3051 — reversed. Under the PTY supervisor the agent is parked on the
   * permission modal in its own pane and cannot run another tool until someone
   * answers it, so it belongs at the top of the list with the other hard stops.
   */
  it('treats a permission request as blocking — the supervisor pane is parked on the modal', () => {
    expect(isBlockingDecision(['permissionRequest'])).toBe(true);
  });

  /**
   * PAN-3233 review fix — a paneQuestion is a terminal prompt with no
   * structured payload; without this the agent sorted into the non-blocking
   * "Waiting" group despite being frozen exactly like an askUserQuestion.
   */
  it('treats a paneQuestion as blocking — the agent is frozen on a terminal prompt', () => {
    expect(isBlockingDecision(['paneQuestion'])).toBe(true);
  });

  it('is blocking when any kind blocks', () => {
    expect(isBlockingDecision(['exitPlanMode', 'askUserQuestion'])).toBe(true);
  });

  it('is not blocking with no kinds', () => {
    expect(isBlockingDecision([])).toBe(false);
  });
});
