/**
 * PAN-5293 WI-14: the project-scoped Workspaces section. Replaces
 * Sidebar.workspaces.test.tsx, Sidebar.workspacePullRequest.test.tsx and the
 * <Sidebar> cases of workspace-rail-filter.test.tsx.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesSection } from '../WorkspacesSection';
import type { WorkspaceRegistryRow } from '../workspaceRows';
import { useDashboardStore } from '../../../lib/store';
import type { Issue } from '../../../types';

function ws(overrides: Partial<WorkspaceRegistryRow> & { id: string }): WorkspaceRegistryRow {
  const kind = overrides.kind ?? 'scratch';
  return {
    projectId: 'overdeck',
    kind,
    origin: kind === 'issue' ? 'pipeline' : 'operator',
    name: overrides.id,
    issueId: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    lastAccessedAt: 0,
    ...overrides,
  };
}

const derivedPr = {
  'PAN-9': {
    issueId: 'PAN-9',
    state: 'in-review',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/9', number: 9, reviewState: 'approved', checks: 'green', mergeable: true },
  },
};

let onSelectWorkspace: ReturnType<typeof vi.fn>;
let onNewWorkspace: ReturnType<typeof vi.fn>;

function renderSection(workspaces: WorkspaceRegistryRow[], selectedProject: string | null = 'Overdeck') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['registered-projects'], [
    { key: 'overdeck', name: 'Overdeck', path: '/repo' },
    { key: 'krux', name: 'Krux', path: '/krux' },
  ]);
  client.setQueryData(['workspace-registry'], workspaces);
  return render(
    <QueryClientProvider client={client}>
      <WorkspacesSection selectedProject={selectedProject} onSelectWorkspace={onSelectWorkspace} onNewWorkspace={onNewWorkspace} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onSelectWorkspace = vi.fn();
  onNewWorkspace = vi.fn();
  useDashboardStore.setState({ issuesRaw: [], derivedIssueStateByIssueId: {} } as Parameters<typeof useDashboardStore.setState>[0]);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rowIds = () => screen.getAllByTestId(/^sidebar-workspace-(?!pr-|memory-phase-|s-archived)/).map((r) => r.getAttribute('data-testid'));

describe('WorkspacesSection (PAN-5293 F-D9)', () => {
  it('lists only the selected project rows, favorites first then by recency', () => {
    renderSection([
      ws({ id: 'ws-old', lastAccessedAt: 100 }),
      ws({ id: 'ws-fav', isFavorite: true, lastAccessedAt: 50 }),
      ws({ id: 'ws-new', lastAccessedAt: 200 }),
      ws({ id: 'ws-krux', projectId: 'krux', lastAccessedAt: 300 }),
    ]);
    expect(rowIds()).toEqual(['sidebar-workspace-ws-fav', 'sidebar-workspace-ws-new', 'sidebar-workspace-ws-old']);
  });

  it('keeps operator and favorited rows, drops unfavorited pipeline rows and main checkouts, and names a favorited main row after the project', () => {
    renderSection([
      ws({ id: 'ws-scratch' }),
      ws({ id: 'ws-pipeline', kind: 'issue', issueId: 'PAN-1' }),
      ws({ id: 'ws-main', kind: 'main', name: 'main' }),
      ws({ id: 'ws-main-fav', kind: 'main', name: 'main', isFavorite: true }),
    ]);
    expect(rowIds()).toEqual(['sidebar-workspace-ws-main-fav', 'sidebar-workspace-ws-scratch']);
    expect(screen.getByTestId('sidebar-workspace-ws-main-fav')).toHaveTextContent('Overdeck');
  });

  it('badges an issue row with its pipeline phase and a scratch row with nothing', () => {
    useDashboardStore.setState({
      issuesRaw: [{ id: 'PAN-9001', identifier: 'PAN-9001', title: 't', status: 'In Progress', priority: 4, labels: [], url: '', createdAt: '', updatedAt: '' } as Issue],
      derivedIssueStateByIssueId: { 'PAN-9001': { issueId: 'PAN-9001', state: 'working' } },
    } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    renderSection([
      ws({ id: 'ws-issue', kind: 'issue', name: 'feature-pan-9001', issueId: 'PAN-9001', isFavorite: true }),
      ws({ id: 'ws-scratch', name: 'scratch-notes' }),
    ]);
    expect(within(screen.getByTestId('sidebar-workspace-ws-issue')).getByText('Work')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-workspace-ws-scratch').textContent).toBe('scratch-notes');
  });

  it('shows the memory phase on a scratch row and never on an issue row', () => {
    renderSection([
      ws({ id: 'ws-scratch', memoryPhase: 'Drafting' }),
      ws({ id: 'ws-issue', kind: 'issue', issueId: 'PAN-2', isFavorite: true, memoryPhase: 'Ignored' }),
    ]);
    expect(screen.getByTestId('sidebar-workspace-memory-phase-ws-scratch')).toHaveTextContent('Drafting');
    expect(screen.queryByTestId('sidebar-workspace-memory-phase-ws-issue')).toBeNull();
  });

  it('renders the PR badge on an issue row with a derived PR; clicking it opens the PR without selecting the row', () => {
    useDashboardStore.setState({ derivedIssueStateByIssueId: derivedPr } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderSection([
      ws({ id: 'ws-pan-9', kind: 'issue', name: 'feature-pan-9', issueId: 'PAN-9', isFavorite: true }),
      ws({ id: 'ws-pan-1', kind: 'issue', name: 'feature-pan-1', issueId: 'PAN-1', isFavorite: true }),
    ]);
    const badge = screen.getByTestId('sidebar-workspace-pr-ws-pan-9');
    expect(within(badge).getByText('#9')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-pr-ws-pan-1')).toBeNull();

    fireEvent.click(within(badge).getByText('#9'));
    expect(openSpy).toHaveBeenCalledWith('https://github.com/eltmon/overdeck/pull/9', '_blank', 'noopener,noreferrer');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it('collapses archived rows behind an Archived count that expands on click', () => {
    renderSection([
      ws({ id: 'ws-active' }),
      ws({ id: 'ws-archived-1', isArchived: true }),
      ws({ id: 'ws-archived-2', isArchived: true }),
    ]);
    expect(screen.queryByTestId('sidebar-workspace-ws-archived-1')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('sidebar-workspaces-archived-toggle');
    expect(toggle).toHaveTextContent('2');
    fireEvent.click(toggle);
    expect(screen.getByTestId('sidebar-workspace-ws-archived-1')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-workspace-ws-archived-2')).toBeInTheDocument();
  });

  it('renders nothing when the project has no workspace rows', () => {
    const { container } = renderSection([ws({ id: 'ws-krux', projectId: 'krux' })]);
    expect(container).toBeEmptyDOMElement();
  });

  it('+ creates a workspace in the project; a row click selects that workspace', () => {
    renderSection([ws({ id: 'ws-scratch' })]);
    fireEvent.click(screen.getByTestId('sidebar-new-workspace'));
    expect(onNewWorkspace).toHaveBeenCalledWith('overdeck');
    fireEvent.click(screen.getByTestId('sidebar-workspace-ws-scratch'));
    expect(onSelectWorkspace).toHaveBeenCalledWith('ws-scratch');
  });
});
