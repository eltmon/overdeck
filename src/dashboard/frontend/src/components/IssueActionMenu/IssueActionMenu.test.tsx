import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../DialogProvider';
import { ISSUE_ACTIONS } from '../../lib/issueActions';
import { useDashboardStore } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { IssueActionMenu } from './IssueActionMenu';

vi.mock('../PanOpenInPicker', () => ({
  PanOpenInPicker: ({ openInCwd }: { openInCwd: string | null }) => <div data-testid="pan-open-picker">Open {openInCwd ?? ''}</div>,
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
    project: { id: 'pan', name: 'Overdeck', color: '#fff' },
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
    if (url.includes('/api/dashboard/session')) {
      return Response.json({ csrfToken: 'test-csrf-token' });
    }
    if (url.includes('/planning-state')) {
      return Response.json({ hasPlan: false, hasTasks: false, tasksCount: 0, planningComplete: false });
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

  it('enables Close out as the primary action for post-merge limbo membership', async () => {
    mockStore({
      currentIssue: issue({
        status: 'In Progress',
        state: 'in_progress',
        pipelineMembership: {
          available: true,
          inPipeline: true,
          bucket: 'post_merge_limbo',
          labelDrift: null,
        },
      }),
    });

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="primary-strip" />);

    const closeOut = await screen.findByTestId('issue-action-closeOut');
    expect(closeOut).toBeEnabled();
    expect(closeOut).toHaveTextContent('Close out');
    expect(screen.queryByTestId('issue-action-plan')).not.toBeInTheDocument();
  });

  it('renders overflow-only as a single trigger with the action dropdown', () => {
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    expect(screen.getByTestId('issue-action-overflow-button')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-plan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));

    expect(screen.getByTestId('issue-action-overflow-menu')).toBeInTheDocument();
    // Phase-primary actions render both in the "For this phase" section and
    // their group section — at least one Plan row must be present.
    expect(screen.getAllByTestId('issue-action-plan').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('issue-action-plan')[0]).toHaveTextContent('Plan');
  });

  it('renders only agent-control actions when agentScopeOnly is enabled', () => {
    mockStore({ currentIssue: issue({ hasPlan: true, workspacePath: '/tmp/pan-1' }), currentAgent: agent({ status: 'running', paused: true, troubled: true }) });

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" agentScopeOnly />);
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));

    const menu = screen.getByTestId('issue-action-overflow-menu');
    for (const label of [
      'Tell agent',
      'Clear troubled gate',
      'Recover agent',
      'Resume session',
    ]) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
    // Stop/Pause/Unpause live behind the collapsed Danger disclosure (C-ACTIONS).
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Danger \(\d+ available\)$/ }));
    for (const label of ['Stop agent', 'Pause agent', 'Unpause agent']) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('issue-action-switchModel')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-plan')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-closeOut')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-wipe')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-destroyWorkspace')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-reopen')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-syncMain')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-inspectTask')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-open')).not.toBeInTheDocument();
    expect(within(menu).queryByTestId('issue-action-viewPr')).not.toBeInTheDocument();
  });

  it('renders primary-strip primaries with a labelled grouped overflow', () => {
    mockStore({ currentIssue: issue({ hasPlan: true, hasTasks: true, workspacePath: '/tmp/pan-1' }), currentAgent: agent() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/planning-state')) return Response.json({ hasPlan: true, hasTasks: true, tasksCount: 2, planningComplete: true });
      if (url.includes('/api/workspaces/')) return Response.json({ exists: true, issueId: 'PAN-1', path: '/tmp/pan-1' });
      if (url.includes('/has-session')) return Response.json({ lifecycle: { canResumeSession: false } });
      return Response.json({ success: true });
    }));

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="primary-strip" />);

    expect(screen.getByTestId('issue-action-startAgent')).toHaveTextContent('Start agent');
    const overflowButton = screen.getByTestId('issue-action-overflow-button');
    expect(overflowButton).toHaveTextContent(/^\d+ more$/);
    fireEvent.click(overflowButton);
    expect(screen.getByTestId('issue-action-overflow-menu')).toBeInTheDocument();
    expect(document.querySelector('[data-issue-action-section="inspect"]')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-tasks')).toHaveTextContent('Tasks');
    // The overflow is the full menu: the phase section also shows the primary.
    expect(within(screen.getByTestId('issue-action-overflow-menu')).getAllByTestId('issue-action-startAgent').length).toBeGreaterThan(0);
  });

  it('pins registry actions and declared components after a flex spacer', () => {
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

    renderMenu(
      <IssueActionMenu
        issueId="PAN-1"
        mode="primary-strip"
        pinRight={['viewPr']}
        pinned={[{ key: 'tasks', render: <button type="button">Pinned tasks</button> }]}
      />,
    );

    expect(screen.getByTestId('issue-action-pin-spacer')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-viewPr')).toHaveTextContent('View PR');
    expect(screen.getByText('Pinned tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    const overflow = screen.getByTestId('issue-action-overflow-menu');
    expect(within(overflow).queryByTestId('issue-action-viewPr')).not.toBeInTheDocument();
    expect(within(overflow).queryByTestId('issue-action-tasks')).not.toBeInTheDocument();
    expect(within(overflow).queryByText('Pinned tasks')).not.toBeInTheDocument();
  });

  it('keeps a disabled requested registry pin in grouped overflow', () => {
    renderMenu(
      <IssueActionMenu
        issueId="PAN-1"
        mode="primary-strip"
        pinRight={['viewPr']}
      />,
    );

    expect(screen.queryByTestId('issue-action-viewPr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-action-pin-spacer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    const overflow = screen.getByTestId('issue-action-overflow-menu');
    expect(within(overflow).getByTestId('issue-action-disabled-viewPr')).toBeInTheDocument();
    expect(within(overflow).getByTestId('issue-action-viewPr')).toBeDisabled();
  });

  it('renders only registry-backed action rows in grouped overflow', () => {
    renderMenu(
      <IssueActionMenu
        issueId="PAN-1"
        mode="overflow-only"
        pinned={[{ key: 'merge', render: <button type="button">Merge component</button> }]}
      />,
    );

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Danger \(\d+ available\)/ }));

    const registryKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));
    const renderedActionKeys = Array.from(
      screen.getByTestId('issue-action-overflow-menu').querySelectorAll<HTMLElement>('[data-testid^="issue-action-"]'),
    )
      .map((element) => element.dataset.testid ?? '')
      .filter((testId) => testId !== 'issue-action-overflow-menu' && testId !== 'issue-action-explain-toggle')
      .map((testId) => testId.replace('issue-action-disabled-', '').replace('issue-action-', ''));

    expect(renderedActionKeys.length).toBeGreaterThan(0);
    expect(renderedActionKeys.every((key) => registryKeys.has(key as never))).toBe(true);
    expect(within(screen.getByTestId('issue-action-overflow-menu')).queryByText('Merge component')).not.toBeInTheDocument();
  });

  it('opens a confirmation dialog before destructive actions can run', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Danger \(\d+ available\)/ }));
    fireEvent.click(screen.getByTestId('issue-action-resetIssue'));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/issues/PAN-1/reset', expect.anything());

    const confirmButton = screen.getByRole('button', { name: 'Reset issue' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'Reset issue' } });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/reset', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deleteWorkspace: true }),
      }));
    });
  });

  it('sends deleteWorkspace true when the confirmed wipe action runs', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Danger \(\d+ available\)/ }));
    fireEvent.click(screen.getByTestId('issue-action-wipe'));

    const confirmButton = screen.getByRole('button', { name: 'Wipe' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'Wipe' } });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/deep-wipe', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deleteWorkspace: true }),
      }));
    });
  });

  it('runs the safe post-planning reset through its distinct endpoint', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    mockStore({ currentIssue: issue({ hasPlan: true, workspacePath: '/tmp/pan-1' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Danger \(\d+ available\)$/ }));
    fireEvent.click(screen.getByTestId('issue-action-resetToPlanned'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('clears task progress and claims');

    const confirmButton = screen.getByRole('button', { name: 'Reset to planned' });
    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'Reset to planned' } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/issues/PAN-1/reset-to-planned',
      expect.objectContaining({ method: 'POST' }),
    ));
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
      if (url.includes('/planning-state')) return Response.json({ hasPlan: false, hasTasks: false, tasksCount: 0, planningComplete: false });
      if (url.includes('/api/workspaces/')) return Response.json({ exists: false, issueId: 'PAN-1' });
      return Response.json({ success: true });
    }));

    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    const disabledOpen = screen.getByTestId('issue-action-disabled-open');
    expect(within(disabledOpen).getByRole('menuitem')).toBeDisabled();
    expect(disabledOpen).toHaveAttribute('title', 'Workspace does not exist');
  });

  it('opens the shared tell dialog and sends the entered message', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    mockStore({ currentIssue: issue({ hasPlan: true, workspacePath: '/tmp/pan-1' }), currentAgent: agent({ status: 'running' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-tell'));

    expect(screen.getByRole('dialog', { name: 'Tell agent' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message to send to the agent'), { target: { value: 'Please continue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-1/tell', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Please continue' }),
      }));
    });
  });

  it('opens the inspect task dialog and posts the selected task id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf-token' });
      if (url === '/api/issues/PAN-1/tasks' && !init?.method) {
        return Response.json({ tasks: [{ id: 'task-1', title: 'First task', status: 'open' }], count: 1, workspacePath: '/tmp/pan-1' });
      }
      return Response.json({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockStore({ currentIssue: issue({ hasPlan: true, hasTasks: true, workspacePath: '/tmp/pan-1' }), currentAgent: agent({ status: 'stopped' }) });
    renderMenu(<IssueActionMenu issueId="PAN-1" mode="overflow-only" />);

    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByTestId('issue-action-inspectTask'));

    expect(await screen.findByRole('dialog', { name: 'Inspect task' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Task to inspect')).toHaveValue('task-1');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect task' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/tasks/task-1/inspect', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deep: false }),
      }));
    });
  });
});
