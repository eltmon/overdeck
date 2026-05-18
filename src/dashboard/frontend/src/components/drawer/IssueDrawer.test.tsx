import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
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
      <IssueDrawer />
    </QueryClientProvider>
  );
}

function renderDrawer(beads: TestBead[] = []) {
  const queryClient = createQueryClient(beads);
  return { queryClient, ...render(drawerUi(queryClient)) };
}

describe('IssueDrawer', () => {
  beforeEach(() => {
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
