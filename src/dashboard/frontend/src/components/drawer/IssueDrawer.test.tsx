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

describe('IssueDrawer', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue],
      agentsById: {},
      recentActivity: [],
      detailedActivity: [],
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('opens from issue URL params on mount', async () => {
    window.history.replaceState(null, '', '/?issue=PAN-1&tab=activity');

    render(<IssueDrawer />);

    expect(await screen.findByTestId('issue-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Issue PAN-1' })).toBeInTheDocument();
    expect(screen.getByText('Drawer issue')).toBeInTheDocument();
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'activity' });
  });

  it('closes from the X button and removes drawer URL params', async () => {
    useDashboardStore.getState().openIssue('PAN-1', 'plan');

    render(<IssueDrawer />);
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

    const { rerender } = render(<IssueDrawer />);
    fireEvent.click(screen.getByTestId('issue-drawer-scrim'));

    await waitFor(() => {
      expect(screen.queryByTestId('issue-drawer')).toBeNull();
    });
    expect(scroller.scrollTop).toBe(120);

    useDashboardStore.getState().openIssue('PAN-1');
    rerender(<IssueDrawer />);
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

    const { rerender } = render(<IssueDrawer />);
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
    rerender(<IssueDrawer />);

    await waitFor(() => expect(scrollArea.scrollTop).toBe(0));
    expect(screen.getByTestId('drawer-activity-dot-review')).toHaveClass('bg-signal-review');
  });
});
