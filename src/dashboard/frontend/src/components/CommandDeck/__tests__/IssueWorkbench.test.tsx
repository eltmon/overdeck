/**
 * IssueWorkbench tests — verify selection arbitration (PAN-830, pan-11sr).
 *
 * Selection state lives in the sibling `useCommandDeckSelection` Zustand
 * slice. These tests drive the slice directly and assert that:
 *   - no selection (or null) → issue-selected mode (ZoneCOverview, no ZoneB)
 *   - selected sessionId not in `sessions` → issue-selected mode (defensive)
 *   - selected sessionId in `sessions` → agent-selected mode (ZoneB + ZoneC)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import { IssueWorkbench } from '../IssueWorkbench';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';

// Mock SessionPanel so we can detect the agent-selected branch without
// pulling its dependency tree into this test.
vi.mock('../SessionView/SessionPanel', () => ({
  SessionPanel: (props: any) => (
    <div data-testid="session-panel" data-session={props.session.sessionId} />
  ),
}));

vi.mock('../SessionView/IssueHeader', () => ({
  IssueHeader: (props: any) => (
    <div data-testid="issue-header" data-issue={props.issueId} />
  ),
}));

vi.mock('../ZoneActionStrip', () => ({
  ZoneActionStrip: () => <div data-testid="zone-action-strip" />,
}));

vi.mock('../ZoneBActionStrip', () => ({
  ZoneBActionStrip: () => <div data-testid="zone-b-action-strip" />,
}));

vi.mock('../IssueComposer', () => ({
  IssueComposer: ({ issueId, sessions }: any) => (
    <div data-testid="issue-composer" data-issue={issueId} data-sessions={sessions.length} />
  ),
}));

// ZoneCOverview's tabs depend on react-query hooks; stub them so the
// IssueWorkbench test stays focused on selection arbitration.
vi.mock('../ZoneCOverviewTabs/queries', () => ({
  usePlanningQuery: () => ({ data: undefined, isLoading: false }),
  useActivityQuery: () => ({ data: { issueId: '', sections: [] }, isLoading: false }),
  useIssueCostsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useReviewStatusQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  usePrQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useDiscussionsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

function makeSession(sessionId: string): SessionNodeType {
  return {
    type: 'work',
    role: undefined,
    sessionId,
    tmuxSession: sessionId,
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 60,
    status: 'running',
    presence: 'active',
  } as SessionNodeType;
}

const ISSUE = 'PAN-821';
const SESSION_ID = 'agent-pan-821';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = makeQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('IssueWorkbench', () => {
  beforeEach(() => {
    act(() => {
      useCommandDeckSelection.getState().clearAll();
    });
  });

  it('renders issue-selected mode by default (no session selected)', () => {
    render(
      <Wrapper>
        <IssueWorkbench
          issueId={ISSUE}
          title="Test issue"
          sessions={[makeSession(SESSION_ID)]}
        />
      </Wrapper>,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'issue-selected');
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('zone-b')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
  });

  it('renders agent-selected mode when slice has a matching session', () => {
    act(() => {
      useCommandDeckSelection.getState().selectSession(ISSUE, SESSION_ID);
    });

    render(
      <Wrapper>
        <IssueWorkbench
          issueId={ISSUE}
          title="Test issue"
          sessions={[makeSession(SESSION_ID)]}
        />
      </Wrapper>,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'agent-selected');
    expect(screen.getByTestId('zone-b')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toHaveAttribute(
      'data-session',
      SESSION_ID,
    );
    expect(screen.queryByTestId('zone-c-overview')).not.toBeInTheDocument();
  });

  it('falls back to issue-selected when slice points at a missing session', () => {
    act(() => {
      useCommandDeckSelection.getState().selectSession(ISSUE, 'does-not-exist');
    });

    render(
      <Wrapper>
        <IssueWorkbench
          issueId={ISSUE}
          title="Test issue"
          sessions={[makeSession(SESSION_ID)]}
        />
      </Wrapper>,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'issue-selected');
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('zone-b')).not.toBeInTheDocument();
  });
});
