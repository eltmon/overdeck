/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * Proves the density contract: drawer density owns the tab strip + shell +
 * status rail and switches tabs under host control; rail density is the
 * compact anatomy (shell + active conversation + one action strip, no tab
 * strip). End-to-end rail/strip conversation switching is covered through
 * the drawer in IssueDrawer.test.tsx.
 */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import type { Agent } from '../../types';
import { IssueDetail } from './IssueDetail';

// Heavy children mocked: the transcript chain (xterm/ConversationPanel),
// the activity rail, and the action menu (store-coupled actions).
vi.mock('../drawer/DrawerAgentSession', () => ({
  DrawerAgentSession: (props: {
    agentId: string | null;
    view: 'conversation' | 'terminal';
    onSelectAgent: (agentId: string) => void;
    onChangeView?: (view: 'conversation' | 'terminal') => void;
  }) => (
    <div data-testid={`mock-agent-session-${props.view}`} data-agent-id={props.agentId ?? ''}>
      <button type="button" onClick={() => props.onSelectAgent('agent-review-1')}>Select specialist</button>
      {props.onChangeView && (
        <>
          <button type="button" onClick={() => props.onChangeView?.('conversation')}>Conversation mode</button>
          <button type="button" onClick={() => props.onChangeView?.('terminal')}>Terminal mode</button>
        </>
      )}
    </div>
  ),
  pickDefaultDrawerAgent: (agents: readonly Agent[]) =>
    agents.find((a) => a.role === 'work' && a.status === 'running') ?? agents[0] ?? null,
}));
vi.mock('../drawer/DrawerActivityRail', () => ({ default: () => <div data-testid="mock-activity-rail" /> }));
vi.mock('../IssueActionMenu', () => ({
  IssueActionMenu: () => <div data-testid="mock-action-menu" />,
}));
vi.mock('./IssueDetailShell', () => ({
  IssueDetailShell: (props: { onOpenAgentConversation: (agentId: string) => void }) => (
    <div data-testid="mock-detail-shell">
      <button data-testid="open-review-conversation" onClick={() => props.onOpenAgentConversation('agent-review-1')} />
    </div>
  ),
}));

beforeEach(() => {
  // Overview-tab panels query their domains; answer everything benignly.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

const AGENTS: Agent[] = [
  agent({ id: 'agent-work-1', role: 'work', issueId: 'PAN-1' }),
  agent({ id: 'agent-review-1', role: 'review', issueId: 'PAN-1' }),
];

function renderDetail(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DialogProvider>{ui}</DialogProvider></QueryClientProvider>);
}

function ControlledSessionDetail() {
  const [tab, setTab] = useState<'conversation' | 'terminal'>('conversation');
  return (
    <IssueDetail
      issueId="PAN-1"
      density="drawer"
      agents={AGENTS}
      tab={tab}
      onSelectTab={(next) => {
        if (next === 'conversation' || next === 'terminal') setTab(next);
      }}
    />
  );
}

describe('IssueDetail (C-DETAIL one component)', () => {
  it('drawer density renders one active Session tab, shell, and status rail', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} tasksBadge="3/13" />,
    );
    expect(screen.getByTestId('drawer-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('drawer-tab-conversation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-tab-terminal')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-tasks-count')).toHaveTextContent('3/13');
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity-rail')).toBeInTheDocument();
    // The conversation pane shows the default (running work) agent.
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
  });

  it('the Session tab is host-controlled and preserves terminal mode', () => {
    const onSelectTab = vi.fn();
    const { rerender } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="overview" onSelectTab={onSelectTab} />,
    );
    fireEvent.click(screen.getByTestId('drawer-tab-session'));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="terminal" onSelectTab={onSelectTab} />
        </DialogProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('drawer-tab-session'));
    expect(onSelectTab).toHaveBeenLastCalledWith('terminal');
  });

  it('the shell conversation switcher selects the agent and asks for the conversation tab', () => {
    const onSelectTab = vi.fn();
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={onSelectTab} />,
    );
    fireEvent.click(screen.getByTestId('open-review-conversation'));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');
  });

  it('legacy terminal and conversation tab values open the matching session mode', () => {
    const onSelectTab = vi.fn();
    const { rerender } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="terminal" onSelectTab={onSelectTab} />,
    );

    expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mock-agent-session-terminal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation mode' }));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="session" onSelectTab={onSelectTab} />
        </DialogProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('mock-agent-session-conversation')).toBeInTheDocument();
  });

  it('preserves a selected specialist across both selector switch directions', () => {
    renderDetail(<ControlledSessionDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'Select specialist' }));
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');

    fireEvent.click(screen.getByRole('button', { name: 'Terminal mode' }));
    expect(screen.getByTestId('mock-agent-session-terminal')).toHaveAttribute('data-agent-id', 'agent-review-1');

    fireEvent.click(screen.getByRole('button', { name: 'Conversation mode' }));
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');
  });

  it('rail density is the compact anatomy: shell + conversation + action strip, no tab strip', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="rail" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.queryByTestId('drawer-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
    expect(screen.getByTestId('mock-action-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-activity-rail')).not.toBeInTheDocument();
  });

  it('page density renders the full composition at route width with the wider status rail', () => {
    const { container } = renderDetail(
      <IssueDetail issueId="PAN-1" density="page" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(container.querySelector('[data-component="issue-detail"]')).toHaveAttribute('data-density', 'page');
    expect(screen.getByTestId('drawer-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity-rail')).toBeInTheDocument();
    expect(container.querySelector('.grid-cols-\\[minmax\\(0\\,1fr\\)_360px\\]')).not.toBeNull();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
  });
});
