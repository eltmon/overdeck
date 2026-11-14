/**
 * PAN-5233 (FR-8, FR-9): the WORKSPACES rail and the Cmd-K workspaces scope
 * list only workspaces the operator created or favorited — rows the
 * pipeline, Session Vault or an agent created stay out of both surfaces
 * entirely. The "Pipeline worktrees" count row is gone; issues are reached
 * through Projects, the Issues scope and the pipeline views instead.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isRailWorkspace, isUserFacingWorkspace, Sidebar, type WorkspaceRegistryRow } from './Sidebar';
import { CommandPalette } from './CommandPalette';

vi.mock('./FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('./DeaconPauseToggle', () => ({
  DeaconPauseToggle: () => <button type="button">Pause Deacon</button>,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

function workspaceRow(overrides: Partial<WorkspaceRegistryRow> = {}): WorkspaceRegistryRow {
  const kind = overrides.kind ?? 'issue';
  return {
    id: overrides.id ?? 'ws-1',
    projectId: overrides.projectId ?? 'overdeck',
    kind,
    origin: overrides.origin ?? (kind === 'issue' ? 'pipeline' : 'operator'),
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
  workspaceRow({ id: 'ws-main', kind: 'main', origin: 'operator', name: 'main', issueId: null, lastAccessedAt: 60 }),
  workspaceRow({ id: 'ws-operator-scratch', kind: 'scratch', origin: 'operator', name: 'scratch-lens', issueId: null, lastAccessedAt: 50 }),
  workspaceRow({ id: 'ws-vault-scratch', kind: 'scratch', origin: 'vault', name: 'vault-abcd1234', issueId: null, lastAccessedAt: 40 }),
  workspaceRow({ id: 'ws-agent-scratch', kind: 'scratch', origin: 'agent', name: 'scratch-agent', issueId: null, lastAccessedAt: 30 }),
  workspaceRow({ id: 'ws-fav-agent-scratch', kind: 'scratch', origin: 'agent', name: 'scratch-agent-fav', issueId: null, isFavorite: true, lastAccessedAt: 20 }),
  workspaceRow({ id: 'ws-pipeline-issue', kind: 'issue', origin: 'pipeline', name: 'feature-pan-1001', issueId: 'PAN-1001', lastAccessedAt: 10 }),
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
    if (url === '/api/conversations' || url === '/api/registered-projects') {
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

describe('isRailWorkspace', () => {
  it('drops a non-favorited main checkout from the rail and keeps a favorited one', () => {
    expect(REGISTRY.filter(isRailWorkspace).map((w) => w.id)).toEqual(['ws-operator-scratch', 'ws-fav-agent-scratch']);
    expect(isRailWorkspace(workspaceRow({ id: 'ws-main-fav', kind: 'main', origin: 'operator', name: 'main', issueId: null, isFavorite: true }))).toBe(true);
  });
});

describe('isUserFacingWorkspace (PAN-5233)', () => {
  it('keeps operator and favorited rows, and drops vault/agent/pipeline rows that are not favorited', () => {
    expect(isUserFacingWorkspace(workspaceRow({ origin: 'operator', kind: 'scratch' }))).toBe(true);
    expect(isUserFacingWorkspace(workspaceRow({ origin: 'vault', kind: 'scratch' }))).toBe(false);
    expect(isUserFacingWorkspace(workspaceRow({ origin: 'agent', kind: 'scratch' }))).toBe(false);
    expect(isUserFacingWorkspace(workspaceRow({ origin: 'pipeline', kind: 'issue' }))).toBe(false);
    expect(isUserFacingWorkspace(workspaceRow({ origin: 'agent', kind: 'scratch', isFavorite: true }))).toBe(true);
    expect(REGISTRY.filter(isUserFacingWorkspace).map((w) => w.id)).toEqual(['ws-main', 'ws-operator-scratch', 'ws-fav-agent-scratch']);
  });
});

describe('Sidebar workspaces rail filter (PAN-5233)', () => {
  it('lists exactly the operator scratch and favorited rows, with no pipeline count row', async () => {
    stubFetch();
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByText('scratch-lens')).toBeTruthy());
    expect(within(rail).getByText('scratch-agent-fav')).toBeTruthy();
    // A non-favorited main checkout is reached from its project, not the rail.
    expect(within(rail).queryByTestId('sidebar-workspace-ws-main')).toBeNull();
    // Non-operator, non-favorited rows stay off the rail entirely — no count row reveals them.
    expect(within(rail).queryByText('vault-abcd1234')).toBeNull();
    expect(within(rail).queryByText('scratch-agent')).toBeNull();
    expect(within(rail).queryByText('feature-pan-1001')).toBeNull();
    expect(screen.queryByText(/Pipeline worktree/)).toBeNull();
    expect(screen.queryByTestId('sidebar-workspaces-pipeline-toggle')).toBeNull();
  });
});

describe('Cmd-K workspaces scope filter (PAN-5233)', () => {
  function renderPalette() {
    return render(
      <QueryClientProvider client={newQueryClient()}>
        <CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} onSelectWorkspace={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('lists the operator scratch row, the favorited row and the main row under its project name', async () => {
    stubFetch([
      { ...workspaceRow({ id: 'ws-main', projectId: 'okf', kind: 'main', origin: 'operator', name: 'main', issueId: null, lastAccessedAt: 60 }), projectName: 'OKF' },
      workspaceRow({ id: 'ws-operator-scratch', kind: 'scratch', origin: 'operator', name: 'scratch-lens', issueId: null, lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-vault-scratch', kind: 'scratch', origin: 'vault', name: 'vault-abcd1234', issueId: null, lastAccessedAt: 40 }),
      workspaceRow({ id: 'ws-agent-scratch', kind: 'scratch', origin: 'agent', name: 'scratch-agent', issueId: null, lastAccessedAt: 30 }),
      workspaceRow({ id: 'ws-fav-agent-scratch', kind: 'scratch', origin: 'agent', name: 'scratch-agent-fav', issueId: null, isFavorite: true, lastAccessedAt: 20 }),
      workspaceRow({ id: 'ws-pipeline-issue', kind: 'issue', origin: 'pipeline', name: 'feature-pan-1001', issueId: 'PAN-1001', lastAccessedAt: 10 }),
    ]);
    const { container } = renderPalette();

    await waitFor(() => expect(container.textContent).toContain('scratch-lens'));
    expect(container.textContent).toContain('scratch-agent-fav');
    expect(container.textContent).toContain('OKF');
    expect(container.textContent).not.toContain('vault-abcd1234');
    expect(container.textContent).not.toContain('feature-pan-1001');
    expect(screen.queryByText(/pipeline worktree/i)).toBeNull();
  });

  it('never surfaces a workspace-pipeline-expand action, even when the operator types a hidden workspace name', async () => {
    stubFetch();
    const { container } = renderPalette();
    await waitFor(() => expect(container.textContent).toContain('scratch-lens'));

    fireEvent.change(
      screen.getByPlaceholderText('Search commands, issues, conversations, memory…'),
      { target: { value: 'feature-pan' } },
    );

    // The hidden pipeline row is not discoverable, and no row offers to reveal it.
    await waitFor(() => expect(screen.queryByText(/pipeline worktree/i)).toBeNull());
    expect(container.textContent).not.toContain('feature-pan-1001');
  });
});

describe('Sidebar memory-phase badge (PAN-3286 FR-12)', () => {
  it('renders the memory phase for a main/scratch row that has one', async () => {
    stubFetch([
      workspaceRow({ id: 'ws-main', kind: 'main', origin: 'operator', name: 'main', issueId: null, isFavorite: true, memoryPhase: 'shipping', lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-scratch', kind: 'scratch', origin: 'operator', name: 'scratch-lens', issueId: null, memoryPhase: 'exploring', lastAccessedAt: 40 }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-main')).toBeTruthy());
    expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-main').textContent).toBe('shipping');
    expect(within(rail).getByTestId('sidebar-workspace-memory-phase-ws-scratch').textContent).toBe('exploring');
  });

  it('renders no badge for a non-issue row whose memoryPhase is null or absent', async () => {
    stubFetch([
      workspaceRow({ id: 'ws-null', kind: 'scratch', origin: 'operator', name: 'null-phase', issueId: null, memoryPhase: null, lastAccessedAt: 50 }),
      workspaceRow({ id: 'ws-absent', kind: 'scratch', origin: 'operator', name: 'absent-phase', issueId: null, lastAccessedAt: 40 }),
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
      workspaceRow({ id: 'ws-fav', kind: 'issue', origin: 'pipeline', name: 'feature-pan-fav', issueId: 'PAN-FAV', isFavorite: true, memoryPhase: 'building' }),
    ]);
    renderSidebar();
    const rail = await workspacesRail();

    await waitFor(() => expect(within(rail).getByTestId('sidebar-workspace-ws-fav')).toBeTruthy());
    expect(within(rail).queryByTestId('sidebar-workspace-memory-phase-ws-fav')).toBeNull();
  });
});
