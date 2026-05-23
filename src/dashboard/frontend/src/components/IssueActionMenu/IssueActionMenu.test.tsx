import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../DialogProvider';
import { useDashboardStore } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { IssueActionMenu } from './IssueActionMenu';

vi.mock('../PanOpenInPicker', () => ({
  PanOpenInPicker: ({ cwd }: { cwd: string }) => <div data-testid="pan-open-picker">Open {cwd}</div>,
}));

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-pan-1',
    identifier: 'PAN-1',
    title: 'Test issue',
    status: 'Todo',
    priority: 2,
    labels: [],
    url: 'https://example.test/PAN-1',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    project: { id: 'pan', name: 'Panopticon', color: '#fff' },
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    runtime: 'claude-code',
    model: 'claude-opus-4-7',
    status: 'stopped',
    startedAt: '2026-05-23T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
    ...overrides,
  };
}

function renderMenu(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

function mockStore({ currentIssue = issue(), currentAgent, reviewStatus = {} as Record<string, unknown> }: {
  currentIssue?: Issue;
  currentAgent?: Agent;
  reviewStatus?: Record<string, unknown>;
} = {}) {
  useDashboardStore.setState({
    issuesRaw: [currentIssue],
    agentsById: currentAgent ? { [currentAgent.id]: currentAgent } : {},
    reviewStatusByIssueId: reviewStatus,
    drawer: { issueId: null, tab: 'overview' },
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/planning-state')) {
      return Response.json({ hasPlan: false, hasBeads: false, beadsCount: 0, planningComplete: false });
    }
    if (url.includes('/api/workspaces/')) {
      return Response.json({ exists: true, issueId: 'PAN-1', path: '/tmp/pan-1' });
    }
    if (url.includes('/has-session')) {
      return Response.json({ lifecycle: { canResumeSession: false } });
    }
    return Response.json({ success: true });
  });
}

describe('IssueActionMenu', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    mockStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders inline ghost buttons for the primary set', () => {
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="inline" />);

    expect(screen.getByTestId('issue-action-plan')).toHaveTextContent('Plan');
    expect(screen.getByTestId('issue-action-startAgent')).toHaveTextContent('Start agent');
  });

  it('renders overflow-only as a single trigger with the action dropdown', () => {
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    expect(screen.getByTestId('issue-action-overflow-button')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-plan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));

    expect(screen.getByTestId('issue-action-overflow-menu')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-plan')).toHaveTextContent('Plan');
  });

  it('renders hybrid primary actions plus overflow actions', () => {
    mockStore({ currentIssue: issue({ hasPlan: true, hasBeads: true, workspacePath: '/tmp/pan-1' }), currentAgent: agent() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/planning-state')) return Response.json({ hasPlan: true, hasBeads: true, beadsCount: 2, planningComplete: true });
      if (url.includes('/api/workspaces/')) return Response.json({ exists: true, issueId: 'PAN-1', path: '/tmp/pan-1' });
      if (url.includes('/has-session')) return Response.json({ lifecycle: { canResumeSession: false } });
      return Response.json({ success: true });
    }));

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="hybrid" />);

    expect(screen.getByTestId('issue-action-startAgent')).toHaveTextContent('Start agent');
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    expect(screen.getByTestId('issue-action-beads')).toHaveTextContent('Beads');
  });

  it('pins requested actions after a flex spacer', () => {
    mockStore({
      currentIssue: issue({ hasPlan: true, workspacePath: '/tmp/pan-1' }),
      reviewStatus: {
        'PAN-1': {
          issueId: 'PAN-1',
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'pending',
          readyForMerge: true,
          prUrl: 'https://example.test/pr/1',
          updatedAt: '2026-05-23T00:00:00.000Z',
        },
      },
    });

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="hybrid" pinRight={['viewPr']} />);

    expect(screen.getByTestId('issue-action-pin-spacer')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-viewPr')).toHaveTextContent('View PR');
  });

  it('opens a confirmation dialog before destructive actions can run', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-resetIssue'));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/issues/PAN-1/reset', expect.anything());

    const confirmButton = screen.getByRole('button', { name: 'Reset issue' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'Reset issue' } });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/reset', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('renders disabled actions with a tooltip reason', () => {
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="inline" />);

    expect(screen.getByTestId('issue-action-startAgent')).toBeDisabled();
    expect(screen.getByTestId('issue-action-startAgent')).toHaveAttribute('title', expect.stringContaining('after planning'));
  });

  it('opens the existing PanOpenInPicker for the open action', async () => {
    mockStore({ currentIssue: issue({ workspacePath: '/tmp/pan-1' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-open'));

    expect(await screen.findByRole('dialog', { name: 'Open workspace' })).toBeInTheDocument();
    expect(screen.getByTestId('pan-open-picker')).toHaveTextContent('/tmp/pan-1');
  });

  it('closes the open dialog with Escape or backdrop click', async () => {
    mockStore({ currentIssue: issue({ workspacePath: '/tmp/pan-1' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-open'));
    expect(await screen.findByRole('dialog', { name: 'Open workspace' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Open workspace' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-open'));
    const dialog = await screen.findByRole('dialog', { name: 'Open workspace' });

    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Open workspace' })).not.toBeInTheDocument());
  });

  it('restores focus to the overflow trigger when the open dialog closes', async () => {
    mockStore({ currentIssue: issue({ workspacePath: '/tmp/pan-1' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    const trigger = screen.getByTestId('issue-action-overflow-button');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('issue-action-open'));
    expect(await screen.findByRole('dialog', { name: 'Open workspace' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('disables the open action with a no-workspace tooltip', () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/planning-state')) return Response.json({ hasPlan: false, hasBeads: false, beadsCount: 0, planningComplete: false });
      if (url.includes('/api/workspaces/')) return Response.json({ exists: false, issueId: 'PAN-1' });
      return Response.json({ success: true });
    }));

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    expect(screen.getByTestId('issue-action-open')).toBeDisabled();
    expect(screen.getByTestId('issue-action-open')).toHaveAttribute('title', 'Workspace does not exist');
  });
});
