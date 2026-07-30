/**
 * PAN-1990 dashboard-sidebar: the Workspaces rail above Projects.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../Sidebar';
import { useDashboardStore } from '../../lib/store';
import type { Tab } from '../Header';
import type { Issue } from '../../types';

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

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-0',
    identifier: overrides.identifier ?? 'PAN-0',
    title: overrides.title ?? 'Issue title',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 4,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

function renderSidebar(options: { workspaces?: WorkspaceFixture[]; activeTab?: Tab; onNewWorkspace?: () => void } = {}) {
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

  const { container } = render(
    <QueryClientProvider client={client}>
      <Sidebar
        activeTab={options.activeTab ?? 'pipeline'}
        onTabChange={onTabChange}
        onSearchOpen={onSearchOpen}
        onNewWorkspace={options.onNewWorkspace}
      />
    </QueryClientProvider>,
  );
  return { container };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  useDashboardStore.setState({
    issuesRaw: [],
    agentsById: {},
    reviewStatusByIssueId: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('Sidebar Workspaces section (ac1)', () => {
  it('renders above Projects, favorites first then recency', async () => {
    const workspaces = [
      ws({ id: 'ws-old', name: 'old-scratch', lastAccessedAt: 100 }),
      ws({ id: 'ws-fav', name: 'fav-scratch', isFavorite: true, lastAccessedAt: 50 }),
      ws({ id: 'ws-new', name: 'new-scratch', lastAccessedAt: 200 }),
    ];
    const { container } = renderSidebar({ workspaces });

    const workspacesSection = await screen.findByTestId('sidebar-workspaces');
    const projectsSection = container.querySelector('[data-testid="sidebar-projects"]');
    expect(projectsSection).toBeInTheDocument();

    // Workspaces section precedes Projects in DOM order.
    const position = workspacesSection.compareDocumentPosition(projectsSection!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const rows = await within(workspacesSection).findAllByTestId(/^sidebar-workspace-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'sidebar-workspace-ws-fav',
      'sidebar-workspace-ws-new',
      'sidebar-workspace-ws-old',
    ]);
  });
});

describe('Sidebar Workspaces pipeline badge (ac2)', () => {
  it('shows a pipeline-phase badge on an issue-kind row derived from getPipelineIssuePhase', async () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-9001', status: 'In Progress', state: 'in_progress' })],
      agentsById: {},
      reviewStatusByIssueId: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    // Favorited so the row stays in the default rail: PAN-3286 FR-13 collapses
    // non-favorited pipeline worktrees behind a count row. The badge logic under
    // test here is identical either way.
    const workspaces = [ws({ id: 'ws-issue', kind: 'issue', name: 'feature-pan-9001', issueId: 'PAN-9001', isFavorite: true })];

    renderSidebar({ workspaces });

    const row = await screen.findByTestId('sidebar-workspace-ws-issue');
    expect(within(row).getByText(/work|plan|todo|review|ship/i)).toBeInTheDocument();
  });

  it('shows no badge for a scratch-kind row', async () => {
    const workspaces = [ws({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-notes' })];
    renderSidebar({ workspaces });

    const row = await screen.findByTestId('sidebar-workspace-ws-scratch');
    expect(row.textContent).toBe('scratch-notes');
  });
});

describe('Sidebar Workspaces archived collapse (ac3)', () => {
  it('collapses archived workspaces into a count row that expands on click', async () => {
    const workspaces = [
      ws({ id: 'ws-active', name: 'active-ws' }),
      ws({ id: 'ws-archived-1', name: 'archived-ws-1', isArchived: true }),
      ws({ id: 'ws-archived-2', name: 'archived-ws-2', isArchived: true }),
    ];
    renderSidebar({ workspaces });

    await screen.findByTestId('sidebar-workspace-ws-active');
    expect(screen.queryByTestId('sidebar-workspace-ws-archived-1')).not.toBeInTheDocument();

    const toggle = await screen.findByTestId('sidebar-workspaces-archived-toggle');
    expect(toggle.textContent).toContain('2');

    fireEvent.click(toggle);

    expect(await screen.findByTestId('sidebar-workspace-ws-archived-1')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-workspace-ws-archived-2')).toBeInTheDocument();
  });
});

describe('Sidebar Workspaces flat/grouped toggle (ac4)', () => {
  it('persists the grouped-view toggle in localStorage', async () => {
    const workspaces = [
      ws({ id: 'ws-a', projectId: 'overdeck', name: 'ws-a' }),
      ws({ id: 'ws-b', projectId: 'other-project', name: 'ws-b' }),
    ];
    renderSidebar({ workspaces });

    await screen.findByTestId('sidebar-workspace-ws-a');
    expect(localStorage.getItem('overdeck.ui.sidebarWorkspacesGrouped')).not.toBe('true');

    const toggle = await screen.findByTestId('sidebar-workspaces-toggle-grouped');
    fireEvent.click(toggle);

    expect(localStorage.getItem('overdeck.ui.sidebarWorkspacesGrouped')).toBe('true');
  });

  it('reads a persisted grouped=true state back on mount', async () => {
    localStorage.setItem('overdeck.ui.sidebarWorkspacesGrouped', 'true');
    const workspaces = [ws({ id: 'ws-a', projectId: 'overdeck', name: 'ws-a' })];
    renderSidebar({ workspaces });

    const toggle = await screen.findByTestId('sidebar-workspaces-toggle-grouped');
    expect(toggle.textContent).toBe('Flat');
  });
});


describe('Sidebar Workspaces "+" entry point (PAN-3330 FR-6a)', () => {
  it('renders the new-workspace button in the rail header and fires the callback on click', async () => {
    const onNewWorkspace = vi.fn();
    renderSidebar({ workspaces: [ws({ id: 'ws-1', name: 'lens' })], onNewWorkspace });

    const button = await screen.findByTestId('sidebar-new-workspace');
    fireEvent.click(button);

    expect(onNewWorkspace).toHaveBeenCalledTimes(1);
  });

  it('renders the button even when the project has no workspaces yet', async () => {
    const onNewWorkspace = vi.fn();
    renderSidebar({ workspaces: [], onNewWorkspace });

    expect(await screen.findByTestId('sidebar-new-workspace')).toBeDefined();
  });

  it('omits the button when no handler is supplied, leaving the group toggle intact', async () => {
    renderSidebar({ workspaces: [ws({ id: 'ws-1', name: 'lens' })] });

    expect(await screen.findByTestId('sidebar-workspaces-toggle-grouped')).toBeDefined();
    expect(screen.queryByTestId('sidebar-new-workspace')).toBeNull();
  });
});
