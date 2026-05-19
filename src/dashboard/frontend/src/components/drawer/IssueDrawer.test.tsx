import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { DialogProvider } from '../DialogProvider';
import { IssueDrawer } from './IssueDrawer';

const issue: Issue = {
  id: 'PAN-1',
  identifier: 'PAN-1',
  title: 'Drawer issue',
  status: 'Todo',
  priority: 3,
  labels: [],
  url: 'https://example.com/PAN-1',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
};

type TestBead = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string;
};

function createQueryClient(beads: TestBead[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['drawer-beads', 'PAN-1'], { tasks: beads });
  return queryClient;
}

function drawerUi(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <IssueDrawer />
      </DialogProvider>
    </QueryClientProvider>
  );
}

function renderDrawer(beads: TestBead[] = []) {
  const queryClient = createQueryClient(beads);
  return { queryClient, ...render(drawerUi(queryClient)) };
}

describe('IssueDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue],
      agentsById: {},
      reviewStatusByIssueId: {},
      recentActivity: [],
      detailedActivity: [],
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('opens from issue URL params on mount', async () => {
    window.history.replaceState(null, '', '/?issue=PAN-1&tab=activity');

    renderDrawer();

    expect(await screen.findByTestId('issue-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Issue PAN-1' })).toBeInTheDocument();
    expect(screen.getByText('Drawer issue')).toBeInTheDocument();
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'activity' });
  });

  it('scrolls to active agent section when URL hash targets it', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, '', '/?issue=PAN-1&tab=overview#active-agent');

    try {
      renderDrawer();

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
      });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('closes from the X button and removes drawer URL params', async () => {
    useDashboardStore.getState().openIssue('PAN-1', 'plan');

    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Close issue drawer' }));

    await waitFor(() => {
      expect(screen.queryByTestId('issue-drawer')).toBeNull();
    });
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: null, tab: 'overview' });
    expect(window.location.search).toBe('');
  });

  it('closes from scrim click and Escape without changing scroll state', async () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 120;
    document.body.appendChild(scroller);
    useDashboardStore.getState().openIssue('PAN-1');

    const { queryClient, rerender } = renderDrawer();
    fireEvent.click(screen.getByTestId('issue-drawer-scrim'));

    await waitFor(() => {
      expect(screen.queryByTestId('issue-drawer')).toBeNull();
    });
    expect(scroller.scrollTop).toBe(120);

    useDashboardStore.getState().openIssue('PAN-1');
    rerender(drawerUi(queryClient));
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('issue-drawer')).toBeNull();
    });
    expect(scroller.scrollTop).toBe(120);
    scroller.remove();
  });

  it('renders most-recent-first activity rail items with phase dots and scroll reset', async () => {
    useDashboardStore.setState({
      recentActivity: [
        { id: 'old', timestamp: '2026-05-18T00:00:00.000Z', source: 'work', level: 'info', message: 'Work started', issueId: 'PAN-1' },
        { id: 'new', timestamp: '2026-05-18T00:05:00.000Z', source: 'ship', level: 'success', message: 'Merged branch', issueId: 'PAN-1' },
        { id: 'other', timestamp: '2026-05-18T00:10:00.000Z', source: 'review', level: 'info', message: 'Other issue', issueId: 'PAN-2' },
      ],
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1', 'activity');

    const { queryClient, rerender } = renderDrawer();
    const rail = screen.getByTestId('drawer-activity-rail');
    const scrollArea = screen.getByTestId('drawer-activity-rail-scroll');

    expect(rail).toHaveClass('w-[320px]', 'border-l', 'bg-card/70');
    expect(screen.getByText('Merged branch')).toBeInTheDocument();
    expect(screen.getByText('Work started')).toBeInTheDocument();
    expect(screen.queryByText('Other issue')).not.toBeInTheDocument();
    expect(screen.getByText('Merged branch').compareDocumentPosition(screen.getByText('Work started'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('drawer-activity-dot-done')).toHaveClass('bg-success');
    expect(screen.getByTestId('drawer-activity-dot-work')).toHaveClass('bg-primary');

    scrollArea.scrollTop = 120;
    useDashboardStore.setState({
      recentActivity: [
        { id: 'latest', timestamp: '2026-05-18T00:06:00.000Z', source: 'review', level: 'info', message: 'Review updated', issueId: 'PAN-1' },
        ...useDashboardStore.getState().recentActivity,
      ],
    } as Parameters<typeof useDashboardStore.setState>[0]);
    rerender(drawerUi(queryClient));

    await waitFor(() => expect(scrollArea.scrollTop).toBe(0));
    expect(screen.getByTestId('drawer-activity-dot-review')).toHaveClass('bg-signal-review');
  });

  it('renders phase timeline from drawer data with done current and upcoming states', () => {
    useDashboardStore.setState({
      issuesRaw: [{ ...issue, hasPlan: true, status: 'In Progress' }],
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          reviewStatus: 'passed',
          testStatus: 'passed',
          verificationStatus: 'passed',
          mergeStatus: 'merging',
          readyForMerge: true,
          reviewSpawnedAt: '2026-05-18T00:10:00.000Z',
          updatedAt: '2026-05-18T00:15:00.000Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-phase-timeline')).toHaveClass('grid-cols-6');
    expect(screen.getByText('Triaged')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('Implemented')).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('Merged')).toBeInTheDocument();
    expect(within(screen.getByTestId('drawer-phase-triaged')).getByTestId('drawer-phase-accent-done')).toHaveClass('bg-success');
    expect(within(screen.getByTestId('drawer-phase-reviewed')).getByTestId('drawer-phase-accent-done')).toHaveClass('bg-success');
    expect(within(screen.getByTestId('drawer-phase-shipping')).getByTestId('drawer-phase-accent-current')).toHaveClass('bg-signal-review');
    expect(within(screen.getByTestId('drawer-phase-merged')).getByTestId('drawer-phase-accent-upcoming')).toHaveClass('bg-transparent');
    expect(within(screen.getByTestId('drawer-phase-shipping')).getByText('05/18')).toHaveClass('font-medium', 'text-foreground');
    expect(within(screen.getByTestId('drawer-phase-merged')).getByText('—')).toHaveClass('text-muted-foreground');
  });

  it('renders verification gates from drawer data with PRD border tones', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          reviewStatus: 'reviewing',
          testStatus: 'pending',
          verificationStatus: 'failed',
          verificationNotes: 'Verification FAILED at lint (1200ms): lint output',
          uatStatus: 'testing',
          readyForMerge: false,
          updatedAt: '2026-05-18T00:00:00.000Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-verification-gates')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-verification-gates').lastElementChild).toHaveClass('grid-cols-4', 'gap-[8px]');
    expect(screen.getByTestId('drawer-verification-gate-typecheck')).toHaveClass('drawer-gate-border-pass', 'text-success-foreground');
    expect(within(screen.getByTestId('drawer-verification-gate-typecheck')).getByText('pass')).toHaveClass('text-[14px]', 'font-medium');
    expect(screen.getByTestId('drawer-verification-gate-lint')).toHaveClass('drawer-gate-border-fail', 'text-destructive-foreground');
    expect(within(screen.getByTestId('drawer-verification-gate-lint')).getByText('lint')).toHaveClass('font-mono', 'text-[10px]', 'text-muted-foreground');
    expect(screen.getByTestId('drawer-verification-gate-test')).toHaveClass('badge-border-muted', 'text-muted-foreground');
    expect(screen.getByTestId('drawer-verification-gate-uat')).toHaveClass('badge-border-info', 'text-info-foreground');
  });

  it('renders active agent card with stream excerpt and sends tell input', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    useDashboardStore.setState({
      agentsById: {
        'agent-PAN-1': {
          id: 'agent-PAN-1',
          issueId: 'PAN-1',
          runtime: 'claude-code',
          harness: 'claude-code',
          model: 'gpt-5.5',
          status: 'running',
          role: 'work',
          startedAt: '2026-05-18T00:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
      recentActivity: [
        { id: 'stream-1', timestamp: '2026-05-18T00:00:00.000Z', source: 'agent', level: 'info', message: 'Implementing drawer card', issueId: 'PAN-1' },
      ],
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-active-agent')).toHaveClass('border-l-[3px]', 'border-l-signal-review');
    expect(screen.getByText('agent-PAN-1')).toHaveClass('font-mono', 'text-[13px]');
    expect(screen.getByText('WORK RUNNING').closest('[data-component="verb-badge"]')).toHaveClass('text-[9px]');
    expect(screen.getByText('GPT-5.5 · claude-code · spend —')).toHaveClass('text-right', 'font-mono');
    expect(screen.getByTestId('drawer-active-agent-stream')).toHaveClass('bg-[rgb(0_0_0_/_32%)]', 'text-[11px]', 'max-h-[180px]', 'overflow-auto');
    expect(within(screen.getByTestId('drawer-active-agent-stream')).getByText('Implementing drawer card')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tell active agent'), { target: { value: 'Please continue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-PAN-1/tell', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Please continue' }),
      }));
    });
    expect(screen.getByLabelText('Tell active agent')).toHaveValue('');
  });

  it('renders action bar with reset stop PR and merge controls', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-PAN-1': {
          id: 'agent-PAN-1',
          issueId: 'PAN-1',
          runtime: 'claude-code',
          harness: 'claude-code',
          model: 'gpt-5.5',
          status: 'running',
          role: 'work',
          startedAt: '2026-05-18T00:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          readyForMerge: true,
          mergeStatus: 'pending',
          prUrl: 'https://example.com/pr/1',
          updatedAt: '2026-05-18T00:00:00.000Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-action-bar')).toHaveClass('px-[22px]', 'py-[12px]', 'border-t', 'bg-card/70');
    expect(screen.getByTestId('drawer-action-reset')).toHaveClass('border', 'text-muted-foreground');
    expect(screen.getByTestId('drawer-action-stop')).toBeEnabled();
    expect(screen.getByTestId('drawer-action-view-pr')).toHaveAttribute('href', 'https://example.com/pr/1');
    expect(screen.getByTestId('drawer-action-merge')).toBeEnabled();
    expect(screen.getByTestId('drawer-action-merge')).toHaveClass('bg-success', 'text-[#000]');
  });

  it('confirms action bar reset stop and merge requests', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    useDashboardStore.setState({
      agentsById: {
        'agent-PAN-1': {
          id: 'agent-PAN-1',
          issueId: 'PAN-1',
          runtime: 'claude-code',
          harness: 'claude-code',
          model: 'gpt-5.5',
          status: 'running',
          role: 'work',
          startedAt: '2026-05-18T00:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          readyForMerge: true,
          mergeStatus: 'pending',
          updatedAt: '2026-05-18T00:00:00.000Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    fireEvent.click(screen.getByTestId('drawer-action-reset'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset Issue' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/reset', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deleteWorkspace: true }),
      }));
    });

    fireEvent.click(screen.getByTestId('drawer-action-stop'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Agent' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-PAN-1/stop', { method: 'POST' });
    });

    fireEvent.click(screen.getByTestId('drawer-action-merge'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Merge to main' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/merge', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('disables merge and hides View PR when action bar targets are unavailable', () => {
    useDashboardStore.setState({
      issuesRaw: [{ ...issue, url: '' }],
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          readyForMerge: false,
          mergeStatus: 'merged',
          updatedAt: '2026-05-18T00:00:00.000Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.queryByTestId('drawer-action-view-pr')).toBeNull();
    expect(screen.getByTestId('drawer-action-stop')).toBeDisabled();
    expect(screen.getByTestId('drawer-action-merge')).toBeDisabled();
  });

  it('renders active agent placeholder when no agent is active', () => {
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-active-agent')).toBeInTheDocument();
    expect(screen.getByText('No active agent.')).toHaveClass('text-muted-foreground');
  });

  it('renders drawer beads list from drawer data with done and current states', () => {
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer([
      {
        id: 'workspace-done',
        title: 'PAN-1: Completed bead',
        status: 'closed',
        createdAt: '2026-05-18T00:00:00.000Z',
        closedAt: '2026-05-18T00:05:00.000Z',
      },
      {
        id: 'workspace-current',
        title: 'PAN-1: Current bead',
        status: 'in_progress',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:03:00.000Z',
      },
    ]);

    expect(screen.getByTestId('drawer-beads-list')).toBeInTheDocument();
    expect(screen.getByText('Completed bead')).toHaveClass('line-through', 'decoration-[rgba(255,255,255,0.18)]');
    expect(screen.getByText('workspace-done')).toHaveClass('font-mono', 'text-[10px]', 'text-muted-foreground');
    expect(screen.getByText('5m')).toHaveClass('font-mono', 'text-[10px]', 'tabular-nums');
    expect(screen.getByTestId('drawer-bead-status-done')).toHaveClass('bg-success', 'text-white', 'text-[9px]');
    expect(screen.getByTestId('drawer-bead-status-current')).toHaveClass('relative');
    expect(screen.getByTestId('drawer-bead-status-current').firstElementChild).toHaveClass('drawer-bead-current-ping', 'border-[1.5px]', 'border-info');
  });

  it('renders four review specialist rows from drawer data with status dots', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          reviewStatus: 'reviewing',
          testStatus: 'pending',
          readyForMerge: false,
          updatedAt: '2026-05-18T00:00:00.000Z',
          reviewSessionNames: ['agent-pan-1-review-security'],
          reviewSubStatuses: {
            'review.security': 'running',
            'review.correctness': 'done',
            'review.performance': 'failed',
          } as never,
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useDashboardStore.getState().openIssue('PAN-1');

    renderDrawer();

    expect(screen.getByTestId('drawer-review-specialists')).toBeInTheDocument();
    expect(screen.getByText('review.security')).toBeInTheDocument();
    expect(screen.getByText('review.correctness')).toBeInTheDocument();
    expect(screen.getByText('review.performance')).toBeInTheDocument();
    expect(screen.getByText('review.requirements')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-review-specialist-dot-run')).toHaveClass('bg-info');
    expect(screen.getByTestId('drawer-review-specialist-dot-done')).toHaveClass('bg-success');
    expect(screen.getByTestId('drawer-review-specialist-dot-fail')).toHaveClass('bg-destructive');
    expect(screen.getByTestId('drawer-review-specialist-dot-idle')).toHaveClass('bg-muted-foreground');
  });
});
