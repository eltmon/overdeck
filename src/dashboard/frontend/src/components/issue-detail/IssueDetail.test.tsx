/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * Proves the density contract: drawer density owns the tab strip + shell +
 * status rail and switches tabs under host control; rail density is the
 * compact anatomy (shell + active conversation + one action strip, no tab
 * strip). End-to-end rail/strip conversation switching is covered through
 * the drawer in IssueDrawer.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../types';
import { IssueDetail } from './IssueDetail';

// Heavy children mocked: the transcript chain (xterm/ConversationPanel),
// the activity rail, and the action menu (store-coupled actions).
vi.mock('../drawer/DrawerAgentSession', () => ({
  DrawerAgentSession: (props: { agentId: string | null; view: string }) => (
    <div data-testid={`mock-agent-session-${props.view}`} data-agent-id={props.agentId ?? ''} />
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
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('IssueDetail (C-DETAIL one component)', () => {
  it('drawer density renders the tab strip, shell, and status rail', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} tasksBadge="3/13" />,
    );
    expect(screen.getByTestId('drawer-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-conversation').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('drawer-tab-tasks-count')).toHaveTextContent('3/13');
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity-rail')).toBeInTheDocument();
    // The conversation pane shows the default (running work) agent.
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
  });

  it('tab clicks are host-controlled via onSelectTab', () => {
    const onSelectTab = vi.fn();
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="overview" onSelectTab={onSelectTab} />,
    );
    fireEvent.click(screen.getByTestId('drawer-tab-terminal'));
    expect(onSelectTab).toHaveBeenCalledWith('terminal');
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
