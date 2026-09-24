import type { DirectoryEntry } from '@overdeck/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAgentDirectory = vi.fn();
vi.mock('./useAgentDirectory', () => ({
  useAgentDirectory: (windowHours: number) => useAgentDirectory(windowHours),
}));
vi.mock('./DirectoryDetail', () => ({
  DirectoryDetail: ({ entry }: { entry: DirectoryEntry | null }) => <div data-testid="detail">{entry?.id ?? 'none'}</div>,
}));

import { useDashboardStore } from '../../../lib/store';
import { AgentsDirectory } from './AgentsDirectory';

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: overrides.id,
    location: 'local',
    projectKey: 'overdeck',
    issueId: null,
    issueTitle: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'working',
    startedAt: '2026-09-23T10:00:00.000Z',
    lastActivityAt: '2026-09-23T11:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

const ENTRIES: DirectoryEntry[] = [
  entry({ id: 'agent-pan-2', issueId: 'PAN-2', issueTitle: 'Agents page as a directory', label: 'work · PAN-2', lastActivityAt: '2026-09-23T11:30:00.000Z' }),
  entry({ id: 'agent-pan-1', issueId: 'PAN-1', label: 'work · PAN-1', state: 'stopped' }),
  entry({ id: 'conv:notes', kind: 'conversation', label: 'Notes', role: null, state: 'idle' }),
];

function rowIds(): string[] {
  return screen.getAllByRole('row').map((row) => row.getAttribute('data-entry-id') ?? '');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/agents');
  useDashboardStore.setState({ derivedIssueStateByIssueId: {} } as Parameters<typeof useDashboardStore.setState>[0]);
  useAgentDirectory.mockReset();
  useAgentDirectory.mockReturnValue({ data: { generatedAt: '', windowHours: 24, entries: ENTRIES }, isLoading: false, isError: false });
});

describe('AgentsDirectory', () => {
  it('renders the three panes with their aria labels', () => {
    render(<AgentsDirectory />);
    expect(screen.getByRole('tree', { name: 'Agent locations and projects' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent detail' })).toBeInTheDocument();
    expect(document.querySelector('[data-component="agents-directory"]')).not.toBeNull();
  });

  it("selecting an issue node lists only that issue's entries", () => {
    render(<AgentsDirectory />);
    expect(rowIds()).toEqual(['agent-pan-2', 'conv:notes', 'agent-pan-1']);
    fireEvent.click(screen.getByText('PAN-1', { selector: 'span' }));
    expect(rowIds()).toEqual(['agent-pan-1']);
    expect(new URLSearchParams(window.location.search).get('node')).toBe('issue:local:PAN-1');
    expect(screen.getByTestId('detail')).toHaveTextContent('agent-pan-1');
  });

  it('ArrowDown moves the list selection and updates ?entry=', () => {
    render(<AgentsDirectory />);
    const grid = screen.getByRole('grid', { name: 'Agents' });
    expect(screen.getByTestId('detail')).toHaveTextContent('agent-pan-2');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(new URLSearchParams(window.location.search).get('entry')).toBe('conv:notes');
    expect(screen.getByTestId('detail')).toHaveTextContent('conv:notes');
    expect(grid).toHaveAttribute('aria-activedescendant', 'directory-row-conv_notes');
  });

  it('Tab moves focus tree → list → detail', () => {
    render(<AgentsDirectory />);
    const tree = screen.getByRole('tree');
    const grid = screen.getByRole('grid');
    const detail = screen.getByRole('region', { name: 'Agent detail' });
    tree.focus();
    fireEvent.keyDown(tree, { key: 'Tab' });
    expect(document.activeElement).toBe(grid);
    fireEvent.keyDown(grid, { key: 'Tab' });
    expect(document.activeElement).toBe(detail);
    fireEvent.keyDown(detail, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(grid);
  });

  it('the 7d toggle refetches with windowHours 168 and sets ?window=168', () => {
    render(<AgentsDirectory />);
    expect(useAgentDirectory).toHaveBeenLastCalledWith(24);
    fireEvent.click(screen.getByRole('tab', { name: '7d' }));
    expect(useAgentDirectory).toHaveBeenLastCalledWith(168);
    expect(new URLSearchParams(window.location.search).get('window')).toBe('168');
  });

  it('renders a working agent with the info badge and a stopped one with the muted badge', () => {
    render(<AgentsDirectory />);
    const badge = (id: string) => within(document.querySelector(`[data-entry-id="${id}"]`) as HTMLElement)
      .getByText((_, node) => node?.getAttribute('data-component') === 'directory-state-badge');
    expect(badge('agent-pan-2')).toHaveTextContent('working');
    expect(badge('agent-pan-2').className).toContain('badge-bg-info');
    expect(badge('agent-pan-1')).toHaveTextContent('stopped');
    expect(badge('agent-pan-1').className).toContain('text-muted-foreground');
  });

  it('marks the idle work agent of a stuck issue as stuck in red', () => {
    useAgentDirectory.mockReturnValue({
      data: { generatedAt: '', windowHours: 24, entries: [entry({ id: 'agent-pan-9', issueId: 'PAN-9', state: 'idle', lastActivityAt: '2026-09-20T11:00:00.000Z' })] },
      isLoading: false,
      isError: false,
    });
    useDashboardStore.setState({
      derivedIssueStateByIssueId: { 'PAN-9': { issueId: 'PAN-9', state: 'working', attention: 'stuck' } },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    render(<AgentsDirectory />);
    const row = document.querySelector('[data-entry-id="agent-pan-9"]') as HTMLElement;
    expect(row).toHaveAttribute('data-state', 'stuck');
    const badge = row.querySelector('[data-component="directory-state-badge"]') as HTMLElement;
    expect(badge).toHaveTextContent(/^stuck · \d+h$/);
    expect(badge.className).toContain('badge-bg-destructive');
  });

  it("shows an agent's issue title after its label and never the word unknown", () => {
    useAgentDirectory.mockReturnValue({
      data: {
        generatedAt: '', windowHours: 24,
        entries: [entry({ id: 'agent-pan-2', issueId: 'PAN-2', issueTitle: 'Agents page as a directory', label: 'work · PAN-2', harness: 'unknown', model: 'unknown' })],
      },
      isLoading: false,
      isError: false,
    });
    render(<AgentsDirectory />);
    const row = document.querySelector('[data-entry-id="agent-pan-2"]') as HTMLElement;
    expect(row).toHaveTextContent('work · PAN-2 · Agents page as a directory');
    expect(row.querySelector('[title="work · PAN-2 · Agents page as a directory"]')).not.toBeNull();
    expect(row.textContent).not.toMatch(/unknown/);
    const node = screen.getByRole('treeitem', { name: /PAN-2/ });
    expect(node).toHaveTextContent('PAN-2 · Agents page as a directory');
  });

  it('collapsing an ancestor of the selected node moves the selection to that ancestor', () => {
    render(<AgentsDirectory />);
    fireEvent.click(screen.getByText('PAN-1', { selector: 'span' }));
    expect(screen.getByTestId('detail')).toHaveTextContent('agent-pan-1');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse overdeck' }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('node')).toBe('proj:local:overdeck');
    expect(params.get('entry')).toBe('agent-pan-1');
    expect(screen.queryByText('PAN-1', { selector: 'span' })).not.toBeInTheDocument();
    const tree = screen.getByRole('tree');
    expect(within(tree).getByRole('treeitem', { selected: true })).toHaveAttribute('data-node-id', 'proj:local:overdeck');
    expect(rowIds()).toEqual(['agent-pan-2', 'conv:notes', 'agent-pan-1']);
    expect(screen.getByTestId('detail')).toHaveTextContent('agent-pan-1');
  });

  it('collapsing a node that does not contain the selection leaves the selection alone', () => {
    useAgentDirectory.mockReturnValue({
      data: {
        generatedAt: '',
        windowHours: 24,
        entries: [...ENTRIES, entry({ id: 'agent-min-1', projectKey: 'myn', issueId: 'MIN-1', label: 'work · MIN-1' })],
      },
      isLoading: false,
      isError: false,
    });
    render(<AgentsDirectory />);
    fireEvent.click(screen.getByText('PAN-1', { selector: 'span' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse myn' }));
    expect(new URLSearchParams(window.location.search).get('node')).toBe('issue:local:PAN-1');
    expect(rowIds()).toEqual(['agent-pan-1']);
  });

  it('/ focuses the filter, not the app-wide search, and the filter narrows the list', () => {
    const documentSlash = vi.fn();
    document.addEventListener('keydown', documentSlash);
    render(<AgentsDirectory />);
    screen.getByRole('tree').focus();
    fireEvent.keyDown(screen.getByRole('tree'), { key: '/' });
    const filter = screen.getByRole('searchbox', { name: 'Filter agents' });
    expect(document.activeElement).toBe(filter);
    expect(documentSlash).not.toHaveBeenCalled();
    fireEvent.change(filter, { target: { value: 'notes' } });
    expect(rowIds()).toEqual(['conv:notes']);
    document.removeEventListener('keydown', documentSlash);
  });
});
