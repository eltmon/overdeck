/**
 * PAN-4457: the sidebar Workspaces rail shows the issue's PR badge on an
 * issue-kind row, from the same derived-state source as the Command Deck
 * issue row.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../Sidebar';
import { useDashboardStore } from '../../lib/store';
import type { Tab } from '../Header';

vi.mock('../FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('../DeaconPauseToggle', () => ({ DeaconPauseToggle: () => <button type="button">Pause Deacon</button> }));
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }) }));

interface WorkspaceFixture {
  id: string;
  projectId: string;
  kind: 'main' | 'issue' | 'scratch';
  name: string;
  issueId: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  title: string | null;
  lastAccessedAt: number;
}

function ws(overrides: Partial<WorkspaceFixture> & { id: string }): WorkspaceFixture {
  return {
    projectId: 'overdeck',
    kind: 'scratch',
    name: overrides.id,
    issueId: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    lastAccessedAt: 0,
    ...overrides,
  };
}

function renderSidebar(options: { workspaces?: WorkspaceFixture[]; activeTab?: Tab; onSelectWorkspace?: (id: string) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onTabChange = vi.fn();
  const onSearchOpen = vi.fn();
  const workspaces = options.workspaces ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/version') return Response.json({ version: '1.0.0', isDev: false });
    if (url === '/api/workspace-registry') return Response.json({ workspaces });
    if (url === '/api/registered-projects') return Response.json([{ key: 'overdeck', name: 'Overdeck', path: '/repo' }]);
    if (url === '/api/conversations') return Response.json([]);
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <QueryClientProvider client={client}>
      <Sidebar
        activeTab={options.activeTab ?? 'pipeline'}
        onTabChange={onTabChange}
        onSearchOpen={onSearchOpen}
        onSelectWorkspace={options.onSelectWorkspace}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  useDashboardStore.setState({
    issuesRaw: [],
    agentsById: {},
    derivedIssueStateByIssueId: {},
    backendPanesById: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('Sidebar workspace row pull request badge', () => {
  it('renders the PR badge on an issue-kind row with a derived PR', async () => {
    useDashboardStore.setState({
      issuesRaw: [],
      agentsById: {},
      derivedIssueStateByIssueId: {
        'PAN-9': {
          issueId: 'PAN-9',
          state: 'in-review',
          pr: {
            url: 'https://github.com/eltmon/overdeck/pull/9',
            number: 9,
            reviewState: 'approved',
            checks: 'green',
            mergeable: true,
          },
        },
      },
      backendPanesById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    const workspaces = [ws({ id: 'ws-pan-9', kind: 'issue', name: 'feature-pan-9', issueId: 'PAN-9', isFavorite: true })];

    renderSidebar({ workspaces });

    const row = await screen.findByTestId('sidebar-workspace-ws-pan-9');
    const badge = within(row).getByTestId('sidebar-workspace-pr-ws-pan-9');
    expect(within(badge).getByText('#9')).toBeInTheDocument();
  });

  it('renders no PR badge on a scratch workspace row', async () => {
    const workspaces = [ws({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-notes' })];
    renderSidebar({ workspaces });

    const row = await screen.findByTestId('sidebar-workspace-ws-scratch');
    expect(within(row).queryByTestId('sidebar-workspace-pr-ws-scratch')).toBeNull();
  });

  it('renders no PR badge on an issue-kind row without a derived PR', async () => {
    const workspaces = [ws({ id: 'ws-pan-1', kind: 'issue', name: 'feature-pan-1', issueId: 'PAN-1', isFavorite: true })];
    renderSidebar({ workspaces });

    const row = await screen.findByTestId('sidebar-workspace-ws-pan-1');
    expect(within(row).queryByTestId('sidebar-workspace-pr-ws-pan-1')).toBeNull();
  });

  it('clicking the badge opens the PR and does not select the workspace', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSelectWorkspace = vi.fn();
    useDashboardStore.setState({
      issuesRaw: [],
      agentsById: {},
      derivedIssueStateByIssueId: {
        'PAN-9': {
          issueId: 'PAN-9',
          state: 'in-review',
          pr: {
            url: 'https://github.com/eltmon/overdeck/pull/9',
            number: 9,
            reviewState: 'approved',
            checks: 'green',
            mergeable: true,
          },
        },
      },
      backendPanesById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    const workspaces = [ws({ id: 'ws-pan-9', kind: 'issue', name: 'feature-pan-9', issueId: 'PAN-9', isFavorite: true })];

    renderSidebar({ workspaces, onSelectWorkspace });

    const row = await screen.findByTestId('sidebar-workspace-ws-pan-9');
    const badge = within(row).getByTestId('sidebar-workspace-pr-ws-pan-9');
    fireEvent.click(within(badge).getByRole('link'));

    expect(openSpy).toHaveBeenCalledWith('https://github.com/eltmon/overdeck/pull/9', '_blank', 'noopener,noreferrer');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });
});
