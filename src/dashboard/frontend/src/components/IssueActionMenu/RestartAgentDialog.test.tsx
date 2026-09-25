/**
 * PAN-4198 (AC-4) — the Restart agent… dialog routes to the right endpoint.
 *
 * Three outcomes, one dialog: keep-memory on a live agent, keep-memory on a
 * stopped one, and a fresh session. The routing is the whole point of the
 * consolidation, so each branch is pinned against the real POST.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../DialogProvider';
import { useDashboardStore } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { IssueActionMenu } from './IssueActionMenu';

vi.mock('../PanOpenInPicker', () => ({
  PanOpenInPicker: () => <div data-testid="pan-open-picker" />,
}));

function issue(): Issue {
  return {
    id: 'issue-pan-1',
    identifier: 'PAN-1',
    title: 'Restart routing',
    status: 'In Progress',
    state: 'in_progress',
    priority: 2,
    labels: [],
    url: 'https://example.test/PAN-1',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    project: { id: 'pan', name: 'Overdeck', color: '#fff' },
    hasPlan: true,
    hasTasks: true,
    workspacePath: '/tmp/feature-pan-1',
  };
}

function agent(status: Agent['status']): Agent {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    runtime: 'claude-code',
    model: 'claude-opus-5',
    status,
    startedAt: '2026-09-25T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
  };
}

function mockStore(status: Agent['status']) {
  useDashboardStore.setState({
    issuesRaw: [issue()],
    agentsById: { 'agent-pan-1': agent(status) },
    // `working` keeps restartAgent enabled: review-or-later states hide it.
    derivedIssueStateByIssueId: { 'PAN-1': { issueId: 'PAN-1', state: 'working' } },
    backendPanesById: {},
    drawer: { issueId: null, tab: 'overview' },
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

function openRestartDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <IssueActionMenu issueId="PAN-1" mode="overflow-only" />
      </DialogProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
  fireEvent.click(screen.getByTestId('issue-action-restartAgent'));
  return screen.getByRole('dialog', { name: 'Restart agent…' });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf-token' });
    if (url === '/api/orders') return Response.json({ books: [] });
    if (url.includes('/has-session')) return Response.json({ lifecycle: { canResumeSession: true } });
    return Response.json({ success: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('RestartAgentDialog', () => {
  it('offers both choices with keep-memory selected by default', () => {
    mockStore('running');
    const dialog = openRestartDialog();

    expect(screen.getByLabelText(/Keep its memory/)).toBeChecked();
    expect(screen.getByLabelText(/Fresh session/)).not.toBeChecked();
    // The copy has to say what a fresh session costs.
    expect(dialog).toHaveTextContent("The agent's saved conversation is discarded.");
    expect(dialog).toHaveTextContent('The workspace, branch, plan and tasks stay.');
  });

  it('keeps memory on a live agent through /restart with graceful:true', async () => {
    mockStore('running');
    openRestartDialog();

    fireEvent.click(screen.getByTestId('restart-agent-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/agent-pan-1/restart',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ graceful: true }) }),
    ));
  });

  it('keeps memory on a stopped agent through /recover, which is the path for a dead harness', async () => {
    mockStore('stopped');
    openRestartDialog();

    fireEvent.click(screen.getByTestId('restart-agent-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/agent-pan-1/recover',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    ));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/agents/agent-pan-1/restart', expect.anything());
  });

  it('starts a fresh session through /restart-fresh with spawn:true', async () => {
    mockStore('running');
    openRestartDialog();

    fireEvent.click(screen.getByLabelText(/Fresh session/));
    fireEvent.click(screen.getByTestId('restart-agent-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/agent-pan-1/restart-fresh',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ spawn: true }) }),
    ));
  });

  it('posts nothing when the operator cancels', () => {
    mockStore('running');
    openRestartDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Restart agent…' })).not.toBeInTheDocument();
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/restart|recover/);
    }
  });
});
