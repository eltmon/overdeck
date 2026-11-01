import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@overdeck/contracts';

const wsTransportMock = vi.hoisted(() => ({
  subscribe: vi.fn(() => vi.fn()),
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
  dashboardMutationJsonHeaders: wsTransportMock.dashboardMutationJsonHeaders,
}));

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { DialogProvider } from '../DialogProvider';
import { IssueDrawer } from './IssueDrawer';
import { resetDrawerIssueSubscriptionForTest } from './useDrawerData';

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

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/artifacts')) return Response.json({ artifacts: [] });
    if (url.endsWith('/plan')) return Response.json(null);
    if (url.includes('/api/backlog/issue-state')) return Response.json({
      issueId: 'MIN-658',
      state: {
        ready: false,
        planned: false,
        parked: false,
        vetoed: false,
        blocksMain: false,
        inPipeline: false,
        released: false,
        objection: false,
        gate: 'auto',
      },
      gate: 'auto',
      planning: 'auto',
      inSequence: false,
    });
    if (url.includes('/planning-state')) return Response.json({
      hasPlan: false,
      hasTasks: false,
      tasksCount: 0,
      planningComplete: false,
    });
    if (url.includes('/api/workspaces/')) return Response.json({ exists: false });
    if (url.includes('/api/issues/') && url.endsWith('/tasks')) {
      return Response.json({ issueId: 'MIN-658', workspacePath: '', tasks: [] });
    }
    if (url.includes('/has-session')) return Response.json({ lifecycle: { canResumeSession: false } });
    return Response.json({ success: true });
  });
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

function renderDrawer() {
  const queryClient = createQueryClient();
  return { queryClient, ...render(drawerUi(queryClient)) };
}

describe('IssueDrawer tracker URL fallback (PAN-4717)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetDrawerIssueSubscriptionForTest();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch());
    wsTransportMock.subscribe.mockReset();
    wsTransportMock.subscribe.mockReturnValue(vi.fn());
    wsTransportMock.getAvailableEditors.mockReset();
    wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: [] });
    wsTransportMock.shellOpenInEditor.mockReset();
    wsTransportMock.shellOpenInEditor.mockResolvedValue({ success: true });
    wsTransportMock.request.mockReset();
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
    }));
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue],
      agentsById: {},
      derivedIssueStateByIssueId: {},
      backendPanesById: {},
      recentActivity: [],
      detailedActivity: [],
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Issue details" and an Issue link to the tracker URL for an issue absent from the snapshot', async () => {
    // issuesRaw holds only PAN-1 — MIN-658 is not in the snapshot.
    renderDrawer();

    await act(async () => {
      useDashboardStore.getState().openIssue('MIN-658', 'overview', 'https://linear.app/mindyournow/issue/MIN-658/x');
    });

    expect(screen.getByText('Issue details')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issue' })).toHaveAttribute(
      'href',
      'https://linear.app/mindyournow/issue/MIN-658/x',
    );
  });

  it('keeps trackerUrl across setDrawerTab, and clears it when reopening without one', async () => {
    renderDrawer();

    await act(async () => {
      useDashboardStore.getState().openIssue('MIN-658', 'overview', 'https://linear.app/mindyournow/issue/MIN-658/x');
    });

    act(() => {
      useDashboardStore.getState().setDrawerTab('activity');
    });

    expect(useDashboardStore.getState().drawer.trackerUrl).toBe('https://linear.app/mindyournow/issue/MIN-658/x');
    expect(screen.getByRole('link', { name: 'Issue' })).toHaveAttribute(
      'href',
      'https://linear.app/mindyournow/issue/MIN-658/x',
    );

    act(() => {
      useDashboardStore.getState().closeIssue();
      useDashboardStore.getState().openIssue('MIN-658', 'overview');
    });

    expect(useDashboardStore.getState().drawer.trackerUrl).toBeUndefined();
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('prefers the issue row url over trackerUrl', async () => {
    renderDrawer();

    await act(async () => {
      useDashboardStore.getState().openIssue('PAN-1', 'overview', 'https://github.com/eltmon/overdeck/issues/1');
    });

    expect(screen.getByRole('link', { name: 'Issue' })).toHaveAttribute('href', 'https://example.com/PAN-1');
  });

  it('clears trackerUrl when syncDrawerFromUrl rebuilds the drawer from the URL', async () => {
    renderDrawer();

    await act(async () => {
      useDashboardStore.getState().openIssue('MIN-658', 'overview', 'https://linear.app/mindyournow/issue/MIN-658/x');
    });

    expect(useDashboardStore.getState().drawer.trackerUrl).toBe('https://linear.app/mindyournow/issue/MIN-658/x');
    expect(window.location.search).toContain('issue=');
    expect(window.location.search).toContain('tab=');
    expect(window.location.search).not.toContain('trackerUrl');

    act(() => {
      useDashboardStore.getState().syncDrawerFromUrl();
    });

    expect(useDashboardStore.getState().drawer.trackerUrl).toBeUndefined();
  });
});
