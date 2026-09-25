/** PAN-4197 WI-5 — the Agents page Live view. */
import type { AgentDirectoryResponse, DirectoryEntry } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../directory/DirectoryDetail', () => ({
  DirectoryDetail: ({ entry }: { entry: DirectoryEntry | null }) => <div data-testid="directory-detail">{entry?.id ?? 'none'}</div>,
}));

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
  entry({ id: 'agent-pan-1', issueId: 'PAN-1', label: 'work · PAN-1', state: 'blocked' }),
  entry({ id: 'agent-pan-2', issueId: 'PAN-2', label: 'work · PAN-2', state: 'working' }),
  entry({ id: 'agent-pan-3', issueId: 'PAN-3', label: 'work · PAN-3', state: 'idle' }),
  entry({ id: 'conv:foo', kind: 'conversation', label: 'Foo', role: null, state: 'idle' }),
];

let response: AgentDirectoryResponse;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiveAgentsView />
    </QueryClientProvider>,
  );
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/agents');
  response = { generatedAt: '', windowHours: 0, scope: 'live', entries: ENTRIES };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== '/api/agent-directory?scope=live') throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(response));
  }));
  useDashboardStore.setState({
    derivedIssueStateByIssueId: { 'PAN-3': { issueId: 'PAN-3', state: 'in-review' } },
    agentsById: {},
    agentRuntimeById: {
      'agent-pan-2': { id: 'agent-pan-2', activity: 'working', currentTool: 'Bash', lastActivity: '2026-09-25T11:59:50.000Z' },
    },
    agentOutputById: { 'agent-pan-2': ['$ npm run lint', '\x1b[32mnpm run build\x1b[0m', ''] },
  } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sectionIds = () => [...document.querySelectorAll('[data-component="agents-live-section"]')].map((node) => node.getAttribute('data-section'));
const row = (id: string) => document.querySelector(`[data-component="agents-live-row"][data-entry-id="${id}"]`) as HTMLElement;

describe('LiveAgentsView', () => {
  it('renders Needs you, Live and Waiting in order with counts and reasons', async () => {
    renderView();
    await flush();
    expect(sectionIds()).toEqual(['needs-you', 'live', 'waiting']);
    const counts = [...document.querySelectorAll('[data-component="agents-live-count"]')].map((node) => node.textContent);
    expect(counts).toEqual(['1', '1', '2']);
    const needsYou = document.querySelector('[data-section="needs-you"]') as HTMLElement;
    expect(within(needsYou).getByText('question waiting')).toBeInTheDocument();
    expect(row('agent-pan-1')).toHaveAttribute('data-tone', 'needs-you');
    expect(within(row('agent-pan-3')).getByText('in review')).toBeInTheDocument();
    expect(within(row('conv:foo')).getByText('idle — no known blocker')).toBeInTheDocument();
  });

  it("shows a working agent's tool, its last output line, and quiet past five minutes", async () => {
    renderView();
    await flush();
    const working = row('agent-pan-2');
    expect(working).toHaveAttribute('data-tone', 'live');
    expect(within(working).getByText('running Bash')).toBeInTheDocument();
    const line = () => within(row('agent-pan-2')).getByText((_, node) => node?.getAttribute('data-component') === 'agents-live-line');
    expect(line()).toHaveTextContent('npm run build · 10s ago');
    expect(line()).not.toHaveTextContent('quiet');

    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); });
    expect(line()).toHaveTextContent('· quiet 6m');
  });

  it('never marks a live row green', async () => {
    renderView();
    await flush();
    for (const node of document.querySelectorAll('[data-component="agents-live-row"]')) {
      expect(node.innerHTML).not.toMatch(/success|emerald|green/);
    }
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

  it('ArrowDown moves the selection across sections', async () => {
    renderView();
    await flush();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Live agents' }), { key: 'ArrowDown' });
    expect(new URLSearchParams(window.location.search).get('entry')).toBe('agent-pan-2');
  });

  it("Open goes to an agent's issue and to a conversation's page", async () => {
    renderView();
    await flush();
    fireEvent.click(within(row('agent-pan-1')).getByTestId('agents-live-open'));
    expect(window.location.pathname).toBe('/issues/PAN-1');
    fireEvent.click(within(row('conv:foo')).getByTestId('agents-live-open'));
    expect(window.location.pathname).toBe('/conv/foo');
  });

  it('hides Open for an agent with no issue', async () => {
    response = { ...response, entries: [entry({ id: 'agent-free', state: 'working' })] };
    renderView();
    await flush();
    expect(within(row('agent-free')).queryByTestId('agents-live-open')).toBeNull();
  });

  it('Enter opens the selected row', async () => {
    renderView();
    await flush();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Live agents' }), { key: 'Enter' });
    expect(window.location.pathname).toBe('/issues/PAN-1');
  });

  it('nests a subagent under its parent row', async () => {
    response = { ...response, entries: [...ENTRIES, entry({ id: 'sub:agent-pan-2:a1', kind: 'subagent', parentId: 'agent-pan-2', label: 'Explore · find the route' })] };
    renderView();
    await flush();
    expect(row('sub:agent-pan-2:a1')).toBeNull();
    expect(within(row('agent-pan-2')).getByText('↳ Explore · find the route')).toBeInTheDocument();
  });

  it('shows the empty state with a History link when nothing is live', async () => {
    response = { ...response, entries: [] };
    renderView();
    await flush();
    const empty = document.querySelector('[data-component="agents-live-empty"]') as HTMLElement;
    expect(empty).toHaveTextContent('Nothing is running or waiting. Finished work is in History.');
    expect(within(empty).getByRole('link', { name: 'History' })).toHaveAttribute('href', '/agents?view=history');
  });

  it('Hide preview collapses the preview panel and Show preview brings it back', async () => {
    renderView();
    await flush();
    const toggle = screen.getByTestId('agents-live-preview-toggle');
    const preview = document.querySelector('[data-panel]#preview') as HTMLElement;
    expect(toggle).toHaveTextContent('Hide preview');
    expect(preview.style.flexGrow).not.toBe('0');
    fireEvent.click(toggle);
    await flush();
    expect(toggle).toHaveTextContent('Show preview');
    expect(preview.style.flexGrow).toBe('0');
    fireEvent.click(toggle);
    await flush();
    expect(toggle).toHaveTextContent('Hide preview');
    expect(preview.style.flexGrow).not.toBe('0');
  });

  it('lays out the list and preview as panels in one group', async () => {
    renderView();
    await flush();
    const group = document.querySelector('[data-component="agents-live"] [data-group]') as HTMLElement;
    expect([...group.querySelectorAll('[data-panel]')].map((panel) => panel.id)).toEqual(['list', 'preview']);
  });
});
