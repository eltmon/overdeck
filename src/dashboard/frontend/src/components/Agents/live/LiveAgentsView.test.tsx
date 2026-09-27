/** PAN-4197 WI-5 — the Agents page Live view. */
import type { AgentDirectoryResponse, DirectoryEntry } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../directory/DirectoryDetail', () => ({
  DirectoryDetail: ({ entry }: { entry: DirectoryEntry | null }) => (
    <div data-testid="directory-detail" data-last={entry?.lastActivityAt ?? ''}>{entry?.id ?? 'none'}</div>
  ),
}));

import { usePanesStore } from '../../../lib/panesStore';
import { useDashboardStore } from '../../../lib/store';
import { LiveAgentsView } from './LiveAgentsView';

const NOW = new Date('2026-09-25T12:00:00.000Z');

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
    startedAt: '2026-09-25T10:00:00.000Z',
    lastActivityAt: '2026-09-25T11:50:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

const ENTRIES: DirectoryEntry[] = [
  entry({ id: 'agent-pan-1', issueId: 'PAN-1', label: 'work · PAN-1', issueTitle: 'First issue', state: 'blocked' }),
  entry({ id: 'agent-pan-2', issueId: 'PAN-2', label: 'work · PAN-2', state: 'working', startedAt: '2026-09-25T09:00:00.000Z' }),
  entry({ id: 'agent-pan-3', issueId: 'PAN-3', label: 'work · PAN-3', state: 'idle' }),
  entry({ id: 'conv:foo', kind: 'conversation', label: 'Foo', role: null, state: 'working', startedAt: '2026-09-25T10:30:00.000Z', runtimeId: 'conv-foo-session' }),
  entry({ id: 'agent-pan-9', issueId: 'PAN-9', label: 'work · PAN-9', state: 'idle' }),
];

let response: AgentDirectoryResponse;

function renderView(props: Parameters<typeof LiveAgentsView>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (next: Parameters<typeof LiveAgentsView>[0]) => (
    <QueryClientProvider client={client}>
      <LiveAgentsView {...next} />
    </QueryClientProvider>
  );
  const result = render(view(props));
  return { ...result, rerenderWith: (next: Parameters<typeof LiveAgentsView>[0]) => result.rerender(view(next)) };
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/agents');
  window.localStorage.clear();
  response = { generatedAt: '', windowHours: 0, scope: 'live', entries: ENTRIES };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== '/api/agent-directory?scope=live') throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(response));
  }));
  useDashboardStore.setState({
    derivedIssueStateByIssueId: { 'PAN-3': { issueId: 'PAN-3', state: 'in-review' } },
    agentsById: {},
    agentRuntimeById: {
      'agent-pan-2': {
        id: 'agent-pan-2',
        activity: 'working',
        currentTool: 'Bash',
        currentToolDescription: 'Commit WI-7',
        lastActivity: '2026-09-25T11:59:50.000Z',
      },
      'conv-foo-session': { id: 'conv-foo-session', activity: 'working', currentTool: 'Read', lastActivity: '2026-09-25T11:59:50.000Z' },
    },
  } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sectionIds = () => [...document.querySelectorAll('[data-component="agents-live-section"]')].map((node) => node.getAttribute('data-section'));
const row = (id: string) => document.querySelector(`[data-component="agents-live-row"][data-entry-id="${id}"]`) as HTMLElement;
const part = (id: string, component: string) => row(id).querySelector(`[data-component="${component}"]`) as HTMLElement | null;

describe('LiveAgentsView', () => {
  it('renders Needs you, Live and Waiting with counts, and folds idle rows into a collapsed footer', async () => {
    const counts = vi.fn();
    renderView({ onCountsChange: counts });
    await flush();
    expect(sectionIds()).toEqual(['needs-you', 'live', 'waiting', 'idle']);
    const sectionCounts = [...document.querySelectorAll('[data-component="agents-live-count"]')].map((node) => node.textContent);
    expect(sectionCounts).toEqual(['1', '2', '1']);
    expect(counts).toHaveBeenLastCalledWith({ live: 2, needsYou: 1, waiting: 1, idle: 1 });
    expect(part('agent-pan-1', 'agents-live-reason')).toHaveTextContent('question waiting');
    expect(row('agent-pan-1')).toHaveAttribute('data-tone', 'needs-you');
    expect(part('agent-pan-3', 'agents-live-reason')).toHaveTextContent('in review');
    expect(row('agent-pan-9')).toBeNull();
    expect(screen.getByTestId('agents-live-idle-toggle')).toHaveTextContent('▸ 1 idle session');
  });

  it('expands the idle footer in place and remembers the choice', async () => {
    const { unmount } = renderView();
    await flush();
    fireEvent.click(screen.getByTestId('agents-live-idle-toggle'));
    expect(part('agent-pan-9', 'agents-live-reason')).toHaveTextContent('idle — no known blocker');
    unmount();
    renderView();
    await flush();
    expect(row('agent-pan-9')).not.toBeNull();
    expect(screen.getByTestId('agents-live-idle-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('names an issue agent by its issue id and title, without the work role', async () => {
    renderView();
    await flush();
    const name = row('agent-pan-1').querySelector('[role="gridcell"] > div')!;
    expect(name).toHaveTextContent('PAN-1 First issue');
    expect(name).not.toHaveTextContent('work');
  });

  it('shows a live agent\'s tool, description, age, then quiet past five minutes', async () => {
    renderView();
    await flush();
    expect(row('agent-pan-2')).toHaveAttribute('data-tone', 'live');
    expect(part('agent-pan-2', 'agents-live-reason')).toHaveTextContent('Bash');
    expect(part('agent-pan-2', 'agents-live-activity')).toHaveTextContent('· Commit WI-7');
    expect(part('agent-pan-2', 'agents-live-age')).toHaveTextContent('10s');
    expect(part('agent-pan-2', 'agents-live-quiet')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); });
    expect(part('agent-pan-2', 'agents-live-quiet')).toHaveTextContent('quiet 6m');
    expect(part('agent-pan-2', 'agents-live-quiet')).toHaveClass('text-state-stuck');
    expect(part('agent-pan-2', 'agents-live-age')).toBeNull();
  });

  it("shows no quiet age when a subagent has been active in the last five minutes (PAN-4222 ac1)", async () => {
    response = { ...response, entries: [
      ...ENTRIES,
      entry({
        id: 'sub:agent-pan-2:a', kind: 'subagent', parentId: 'agent-pan-2', state: 'working',
        lastActivityAt: '2026-09-25T11:59:30.000Z',
      }),
    ] };
    useDashboardStore.setState({
      agentRuntimeById: {
        'agent-pan-2': {
          id: 'agent-pan-2', activity: 'working', currentTool: 'Bash', currentToolDescription: 'Commit WI-7',
          lastActivity: '2026-09-25T11:52:00.000Z',
        },
      },
    } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    renderView();
    await flush();
    expect(part('agent-pan-2', 'agents-live-quiet')).toBeNull();
    expect(part('agent-pan-2', 'agents-live-age')).toHaveTextContent('30s');
  });

  it("reads a conversation row's runtime facts by its runtimeId, not its directory id (PAN-4222 ac2)", async () => {
    renderView();
    await flush();
    expect(part('conv:foo', 'agents-live-reason')).toHaveTextContent('Read');
  });

  it('orders Live by start time, so output does not reshuffle it', async () => {
    renderView();
    await flush();
    const live = document.querySelector('[data-section="live"]') as HTMLElement;
    const ids = () => [...live.querySelectorAll('[data-component="agents-live-row"]')].map((node) => node.getAttribute('data-entry-id'));
    expect(ids()).toEqual(['agent-pan-2', 'conv:foo']);
    act(() => {
      useDashboardStore.setState({
        agentRuntimeById: { 'agent-pan-2': { id: 'agent-pan-2', activity: 'working', lastActivity: '2026-09-25T10:00:00.000Z' } },
      } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    });
    expect(ids()).toEqual(['agent-pan-2', 'conv:foo']);
  });

  it('never marks a live row green, and Open is neutral', async () => {
    renderView();
    await flush();
    for (const node of document.querySelectorAll('[data-component="agents-live-row"]')) {
      expect(node.innerHTML).not.toMatch(/success|emerald|green/);
    }
    const open = within(row('agent-pan-2')).getByTestId('agents-live-open');
    expect(open).toHaveClass('text-muted-foreground');
    expect(open.className).not.toMatch(/text-primary|text-state/);
  });

  it('selects the first row by default; a click sets ?entry= and previews without navigating', async () => {
    renderView();
    await flush();
    expect(screen.getByTestId('directory-detail')).toHaveTextContent('agent-pan-1');
    fireEvent.click(row('agent-pan-2'));
    expect(new URLSearchParams(window.location.search).get('entry')).toBe('agent-pan-2');
    expect(window.location.pathname).toBe('/agents');
    expect(screen.getByTestId('directory-detail')).toHaveTextContent('agent-pan-2');
    expect(row('agent-pan-2')).toHaveAttribute('aria-selected', 'true');
  });

  it('dates a live preview from the runtime snapshot, as the row does', async () => {
    renderView();
    await flush();
    fireEvent.click(row('agent-pan-2'));
    expect(screen.getByTestId('directory-detail')).toHaveAttribute('data-last', '2026-09-25T11:59:50.000Z');
  });

  it('ArrowDown moves the selection across sections', async () => {
    renderView();
    await flush();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Live agents' }), { key: 'ArrowDown' });
    expect(new URLSearchParams(window.location.search).get('entry')).toBe('agent-pan-2');
  });

  it("Open goes to the agent's session pane in its project deck, and to a conversation's page", async () => {
    renderView();
    await flush();
    fireEvent.click(within(row('agent-pan-1')).getByTestId('agents-live-open'));
    expect(window.location.pathname).toBe('/command-deck/overdeck');
    const pane = (usePanesStore.getState().panesByWorkspace.overdeck ?? []).find((candidate) => candidate.agentId === 'agent-pan-1');
    expect(pane).toMatchObject({ paneType: 'agent', issueId: 'PAN-1' });
    fireEvent.click(within(row('conv:foo')).getByTestId('agents-live-open'));
    expect(window.location.pathname).toBe('/conv/foo');
  });

  it('Open falls back to the issue for an agent with no registered project, and hides with no issue', async () => {
    response = { ...response, entries: [
      entry({ id: 'agent-free', state: 'working' }),
      entry({ id: 'agent-pan-7', issueId: 'PAN-7', projectKey: 'unassigned', state: 'working' }),
    ] };
    renderView();
    await flush();
    expect(within(row('agent-free')).queryByTestId('agents-live-open')).toBeNull();
    fireEvent.click(within(row('agent-pan-7')).getByTestId('agents-live-open'));
    expect(window.location.pathname).toBe('/issues/PAN-7');
  });

  it('Enter opens the selected row', async () => {
    renderView();
    await flush();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Live agents' }), { key: 'Enter' });
    expect(window.location.pathname).toBe('/command-deck/overdeck');
  });

  it('nests at most three subagents under the parent row, each with its state glyph', async () => {
    const subs = [1, 2, 3, 4, 5].map((n) => entry({
      id: `sub:agent-pan-2:a${n}`, kind: 'subagent', parentId: 'agent-pan-2', label: `lane-${n}`, state: n === 1 ? 'working' : 'done',
    }));
    response = { ...response, entries: [...ENTRIES, ...subs] };
    renderView();
    await flush();
    expect(row('sub:agent-pan-2:a1')).toBeNull();
    const lines = row('agent-pan-2').querySelectorAll('[data-component="agents-live-subagent"]');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('↳●lane-1');
    expect(lines[1]).toHaveTextContent('↳○lane-2');
    expect(part('agent-pan-2', 'agents-live-subagent-more')).toHaveTextContent('↳ +2 more');
  });

  it('shows one empty state with a History link when nothing is live, with no preview region (PAN-4222 ac1)', async () => {
    response = { ...response, entries: [] };
    renderView();
    await flush();
    const empty = document.querySelector('[data-component="agents-live-empty"]') as HTMLElement;
    expect(empty).toHaveTextContent('Nothing is running or waiting. Finished work is in History.');
    const historyLink = within(empty).getByRole('link', { name: 'History' });
    expect(historyLink).toHaveAttribute('href', '/agents?view=history');
    expect(historyLink).toHaveClass('underline');
    expect(screen.queryByRole('region', { name: 'Agent preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Select an agent to see its transcript.')).not.toBeInTheDocument();
  });

  it('shows the single empty message and the idle toggle, with no preview, when only idle entries are collapsed (PAN-4222 ac2)', async () => {
    response = { ...response, entries: [entry({ id: 'agent-pan-9', issueId: 'PAN-9', label: 'work · PAN-9', state: 'idle' })] };
    renderView();
    await flush();
    expect(document.querySelector('[data-component="agents-live-empty"]')).not.toBeNull();
    expect(screen.getByTestId('agents-live-idle-toggle')).toHaveTextContent('▸ 1 idle session');
    expect(row('agent-pan-9')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Agent preview' })).not.toBeInTheDocument();
  });

  it('collapses and expands the preview panel when the header toggles previewHidden', async () => {
    const { rerenderWith } = renderView({ previewHidden: false });
    await flush();
    const preview = document.querySelector('[data-panel]#preview') as HTMLElement;
    expect(preview.style.flexGrow).not.toBe('0');
    rerenderWith({ previewHidden: true });
    await flush();
    expect(preview.style.flexGrow).toBe('0');
    rerenderWith({ previewHidden: false });
    await flush();
    expect(preview.style.flexGrow).not.toBe('0');
  });

  it('lays out the list and preview as panels in one group', async () => {
    renderView();
    await flush();
    const group = document.querySelector('[data-component="agents-live"] [data-group]') as HTMLElement;
    expect([...group.querySelectorAll('[data-panel]')].map((panel) => panel.id)).toEqual(['list', 'preview']);
  });
});
