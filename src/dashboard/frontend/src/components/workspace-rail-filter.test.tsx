/**
 * PAN-3286 WI-11 (FR-13, D-13): the WORKSPACES rail lists workspaces the
 * operator created and collapses pipeline worktrees (non-favorited
 * `kind='issue'` rows) behind an expandable count row, with the expanded state
 * persisted in localStorage. The Cmd-K workspaces scope applies the same filter.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isUserFacingWorkspace, Sidebar, type WorkspaceRegistryRow } from './Sidebar';
import { CommandPalette } from './CommandPalette';

vi.mock('./FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('./DeaconPauseToggle', () => ({
  DeaconPauseToggle: () => <button type="button">Pause Deacon</button>,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

const PIPELINE_EXPANDED_KEY = 'overdeck.ui.sidebarWorkspacesPipelineExpanded';

function workspaceRow(overrides: Partial<WorkspaceRegistryRow> = {}): WorkspaceRegistryRow {
  return {
    id: overrides.id ?? 'ws-1',
    projectId: overrides.projectId ?? 'overdeck',
    kind: overrides.kind ?? 'issue',
    name: overrides.name ?? 'feature-pan-1',
    issueId: overrides.issueId ?? 'PAN-1',
    isFavorite: overrides.isFavorite ?? false,
    isArchived: overrides.isArchived ?? false,
    title: overrides.title ?? null,
    lastAccessedAt: overrides.lastAccessedAt ?? 1,
    ...('memoryPhase' in overrides ? { memoryPhase: overrides.memoryPhase } : {}),
  };
}

const REGISTRY: WorkspaceRegistryRow[] = [
  workspaceRow({ id: 'ws-main', kind: 'main', name: 'main', issueId: null, lastAccessedAt: 50 }),
  workspaceRow({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null, lastAccessedAt: 40 }),
  workspaceRow({ id: 'ws-fav', kind: 'issue', name: 'feature-pan-fav', issueId: 'PAN-FAV', isFavorite: true, lastAccessedAt: 30 }),
  workspaceRow({ id: 'ws-p1', kind: 'issue', name: 'feature-pan-1001', issueId: 'PAN-1001', lastAccessedAt: 20 }),
  workspaceRow({ id: 'ws-p2', kind: 'issue', name: 'feature-pan-1002', issueId: 'PAN-1002', lastAccessedAt: 10 }),
  workspaceRow({ id: 'ws-p3', kind: 'issue', name: 'feature-pan-1003', issueId: 'PAN-1003', lastAccessedAt: 5 }),
];

function stubFetch(rows: WorkspaceRegistryRow[] = REGISTRY) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/version') return Response.json({ version: '0.5.0', isDev: false });
    if (url === '/api/workspace-registry') return Response.json({ workspaces: rows });
    if (url === '/api/settings') return Response.json({ experimental: { experimentalFeatures: false } });
    if (url.startsWith('/api/palette/search')) {
      return Response.json({ issues: [], conversations: [], memory: [] });
    }
    if (url === '/api/conversations' || url === '/api/registered-projects' || url === '/api/flywheel/runs?limit=10') {
      return Response.json([]);
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderSidebar() {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <Sidebar activeTab="pipeline" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function workspacesRail(): Promise<HTMLElement> {
  return waitFor(() => screen.getByTestId('sidebar-workspaces'));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isUserFacingWorkspace (PAN-3286 FR-13)', () => {
  it('keeps main, scratch, and favorited issue rows and drops non-favorited issue rows', () => {
    expect(REGISTRY.filter(isUserFacingWorkspace).map((w) => w.id)).toEqual(['ws-main', 'ws-scratch', 'ws-fav']);
  });
});

describe('Sidebar workspaces rail filter (PAN-3286 FR-13)', () => {
  it('renders only main/scratch/favorited rows plus a count row for the hidden ones', async () => {
    stubFetch();
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByText('scratch-lens')).toBeTruthy());
    expect(within(rail).getByText('main')).toBeTruthy();
    expect(within(rail).getByText('feature-pan-fav')).toBeTruthy();
    expect(within(rail).queryByText('feature-pan-1001')).toBeNull();
    expect(within(rail).queryByText('feature-pan-1002')).toBeNull();
    expect(within(rail).queryByText('feature-pan-1003')).toBeNull();

    const toggle = within(rail).getByTestId('sidebar-workspaces-pipeline-toggle');
    expect(toggle.textContent).toContain('Pipeline worktrees');
    // Count equals exactly the rows the filter hid.
    expect(toggle.textContent).toContain('3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals every pipeline worktree when expanded and persists that to localStorage', async () => {
    stubFetch();
    renderSidebar();
    const rail = await workspacesRail();

    const toggle = await waitFor(() => within(rail).getByTestId('sidebar-workspaces-pipeline-toggle'));
    fireEvent.click(toggle);

    await waitFor(() => expect(within(rail).getByText('feature-pan-1001')).toBeTruthy());
    expect(within(rail).getByText('feature-pan-1002')).toBeTruthy();
    expect(within(rail).getByText('feature-pan-1003')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem(PIPELINE_EXPANDED_KEY)).toBe('true');
  });

  it('starts expanded when localStorage says so, surviving a reload', async () => {
    localStorage.setItem(PIPELINE_EXPANDED_KEY, 'true');
    stubFetch();
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByText('feature-pan-1001')).toBeTruthy());
    expect(within(rail).getByTestId('sidebar-workspaces-pipeline-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows no count row when every workspace is user-facing', async () => {
    stubFetch(REGISTRY.filter(isUserFacingWorkspace));
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByText('scratch-lens')).toBeTruthy());
    expect(within(rail).queryByTestId('sidebar-workspaces-pipeline-toggle')).toBeNull();
  });

  it('uses the singular label for exactly one hidden worktree', async () => {
    stubFetch([
      workspaceRow({ id: 'ws-main', kind: 'main', name: 'main', issueId: null, lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-p1', kind: 'issue', name: 'feature-pan-1001', issueId: 'PAN-1001' }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    const toggle = await waitFor(() => within(rail).getByTestId('sidebar-workspaces-pipeline-toggle'));
    expect(toggle.textContent).toContain('Pipeline worktree');
    expect(toggle.textContent).not.toContain('Pipeline worktrees');
  });
});

describe('Cmd-K workspaces scope filter (PAN-3286 FR-13)', () => {
  it('lists only user-facing workspaces, keeping the favorited issue workspace', async () => {
    stubFetch();
    const { container } = render(
      <QueryClientProvider client={newQueryClient()}>
        <CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} onSelectWorkspace={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(
      screen.getByPlaceholderText('Search commands, issues, conversations, memory…'),
      { target: { value: 'feature-pan' } },
    );

    // The palette wraps matched substrings in <mark>, so the label text is split
    // across elements — assert against the rendered text content instead.
    await waitFor(() => expect(container.textContent).toContain('feature-pan-fav'));
    expect(container.textContent).not.toContain('feature-pan-1001');
    expect(container.textContent).not.toContain('feature-pan-1002');
    expect(container.textContent).not.toContain('feature-pan-1003');
  });
});

describe('Sidebar memory-phase badge (PAN-3286 FR-12)', () => {
  it('renders the memory phase for a main/scratch row that has one', async () => {
    stubFetch([
      workspaceRow({ id: 'ws-main', kind: 'main', name: 'main', issueId: null, memoryPhase: 'shipping', lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null, memoryPhase: 'exploring', lastAccessedAt: 40 }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-main')).toBeTruthy());
    expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-main').textContent).toBe('shipping');
    expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-scratch').textContent).toBe('exploring');
  });

  it('renders no badge for a non-issue row whose memoryPhase is null or absent', async () => {
    stubFetch([
      workspaceRow({ id: 'ws-null', kind: 'scratch', name: 'null-phase', issueId: null, memoryPhase: null, lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-absent', kind: 'scratch', name: 'absent-phase', issueId: null, lastAccessedAt: 40 }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByTestId('sidebar-workspace-ws-null')).toBeTruthy());
    expect(within(rail).queryByTestId('sidebar-workspace-memory-phase-ws-null')).toBeNull();
    expect(within(rail).queryByTestId('sidebar-workspace-memory-phase-ws-absent')).toBeNull();
    expect(within(rail).getByTestId('sidebar-workspace-ws-null').textContent).toBe('null-phase');
  });

  it('never shows a memory-phase badge on an issue row, even if the DTO carried one', async () => {
    // The API returns null for issue rows; this asserts the row also refuses to
    // render one defensively, so an issue row keeps only its pipeline badge (D-1).
    stubFetch([
      workspaceRow({ id: 'ws-fav', kind: 'issue', name: 'feature-pan-fav', issueId: 'PAN-FAV', isFavorite: true, memoryPhase: 'building' }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByTestId('sidebar-workspace-ws-fav')).toBeTruthy());
    expect(within(rail).queryByTestId('sidebar-workspace-memory-phase-ws-fav')).toBeNull();
  });
});
