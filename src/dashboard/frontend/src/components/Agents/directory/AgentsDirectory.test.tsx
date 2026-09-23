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

import { AgentsDirectory } from './AgentsDirectory';

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: overrides.id,
    location: 'local',
    projectKey: 'overdeck',
    issueId: null,
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
  entry({ id: 'agent-pan-2', issueId: 'PAN-2', label: 'work · PAN-2', lastActivityAt: '2026-09-23T11:30:00.000Z' }),
  entry({ id: 'agent-pan-1', issueId: 'PAN-1', label: 'work · PAN-1', state: 'stopped' }),
  entry({ id: 'conv:notes', kind: 'conversation', label: 'Notes', role: null, state: 'idle' }),
];

function rowIds(): string[] {
  return screen.getAllByRole('row').map((row) => row.getAttribute('data-entry-id') ?? '');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/agents');
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

  it('renders a working agent with the info dot and a stopped one with the muted dot', () => {
    render(<AgentsDirectory />);
    const working = document.querySelector('[data-entry-id="agent-pan-2"]') as HTMLElement;
    const stopped = document.querySelector('[data-entry-id="agent-pan-1"]') as HTMLElement;
    expect(within(working).getByRole('img', { name: 'working' }).className).toContain('bg-info');
    expect(within(stopped).getByRole('img', { name: 'stopped' }).className).toContain('bg-muted-foreground');
  });

  it('/ focuses the filter and the filter narrows the list', () => {
    render(<AgentsDirectory />);
    screen.getByRole('tree').focus();
    fireEvent.keyDown(screen.getByRole('tree'), { key: '/' });
    const filter = screen.getByRole('searchbox', { name: 'Filter agents' });
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: 'notes' } });
    expect(rowIds()).toEqual(['conv:notes']);
  });
});
