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
    });
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
});
