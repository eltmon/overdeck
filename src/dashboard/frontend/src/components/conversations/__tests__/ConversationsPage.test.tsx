/**
 * Tests for ConversationsPage search-vs-list endpoint switching and filter
 * preservation during search (PAN-457).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsPage } from '../ConversationsPage';

const rpcMocks = vi.hoisted(() => ({
  listFeed: vi.fn(),
  feedFacets: vi.fn(),
  search: vi.fn(),
  stats: vi.fn(),
  cost: vi.fn(),
  scan: vi.fn(),
  request: vi.fn((fn: (client: Record<string, unknown>) => unknown) => fn({
    'pan.listSessionsFeed': rpcMocks.listFeed,
    'pan.getSessionsFeedFacets': rpcMocks.feedFacets,
    'pan.searchConversations': rpcMocks.search,
    'pan.getConversationStats': rpcMocks.stats,
    'pan.getConversationCost': rpcMocks.cost,
    'pan.scanConversations': rpcMocks.scan,
  })),
}));

const componentMocks = vi.hoisted(() => ({
  sessionDetail: vi.fn(),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({ request: rpcMocks.request }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize?: (index: number) => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: index * 36,
      size: estimateSize?.(index) ?? 36,
    })),
    getTotalSize: () => count * 36,
  }),
}));

// ─── FacetPanel mock captures onChange so tests can drive filter state ─────

type FilterOnChange = (key: string, val: string | boolean | undefined) => void;
let capturedOnChange: FilterOnChange | null = null;

vi.mock('../FacetPanel', () => ({
  FacetPanel: ({ onChange, facets }: { onChange: FilterOnChange; facets: { models: Array<{ value: string; count: number }>; tags: Array<{ value: string; count: number }> } }) => {
    capturedOnChange = onChange;
    return (
      <div data-testid="facet-panel">
        <button onClick={() => onChange('source', undefined)}>All</button>
        <button onClick={() => onChange('source', 'discovered')}>Discovered</button>
        <button onClick={() => onChange('source', 'managed-archived')}>Managed-archived</button>
        <button onClick={() => onChange('harness', 'codex')}>Codex</button>
        {facets.models.map((model) => <div key={model.value}>{model.count} · {model.value}</div>)}
        {facets.tags.map((tag) => <div key={tag.value}>{tag.value}: {tag.count}</div>)}
      </div>
    );
  },
}));

vi.mock('../SessionTable', () => ({
  SessionTable: ({
    sessions,
    selectedId,
    onSelect,
    hasMore,
    isLoadingMore,
    onLoadMore,
  }: {
    sessions: Array<{
      id: number;
      source: 'discovered' | 'managed-archived';
      workspacePath: string | null;
      jsonlPath: string | null;
      primaryModel: string | null;
      messageCount: number;
      estimatedCost: number;
      lastTs: string | null;
      summary: string | null;
      conversationTitle?: string | null;
      conversationName?: string | null;
    }>;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
  }) => (
    <div data-testid="session-table" role="table">
      <div role="row">
        <span>Session</span>
        <span>Model</span>
        <span>Msgs</span>
        <span>Cost</span>
        <span>Last Active</span>
      </div>
      {sessions.map((session) => {
        const key = `${session.source}:${session.id}`;
        const workspace = session.workspacePath ?? session.jsonlPath ?? 'Unknown session path';
        return (
          <div
            key={key}
            role="row"
            aria-selected={selectedId === key}
            onClick={() => onSelect(selectedId === key ? null : key)}
          >
            <span>{session.conversationTitle ?? session.conversationName ?? workspace.split('/').slice(-2).join('/')}</span>
            <span>{session.summary ?? workspace}</span>
            <span>{session.primaryModel}</span>
            <span>{session.messageCount}</span>
            <span>{session.estimatedCost}</span>
            <span>{session.lastTs}</span>
          </div>
        );
      })}
      {hasMore && (
        <button type="button" disabled={isLoadingMore} onClick={onLoadMore}>
          {isLoadingMore ? 'Loading more…' : 'Load more'}
        </button>
      )}
    </div>
  ),
}));
vi.mock('../SessionDetail', () => ({
  SessionDetail: (props: unknown) => {
    componentMocks.sessionDetail(props);
    return <div data-testid="session-detail" />;
  },
}));
vi.mock('../ScanButton', () => ({
  ScanButton: ({ onScan }: { onScan: () => void }) => (
    <button data-testid="scan-btn" onClick={onScan}>Scan</button>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_STUB = {
  id: 1,
  harness: 'claude-code',
  jsonlPath: '/fake/1.jsonl',
  workspacePath: '/home/user/Projects/alpha',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 5,
  firstTs: '2025-01-01T00:00:00Z',
  lastTs: '2025-01-01T01:00:00Z',
  estimatedCost: 0.01,
  tokenInput: 100,
  tokenOutput: 200,
  toolsUsed: ['Read'],
  filesTouched: ['/home/user/Projects/alpha/src/auth.ts'],
  tags: ['feat'],
  summary: 'Fixed the auth bug',
  enrichmentLevel: 1 as const,
  enrichmentFailed: false,
  overdeckManaged: false,
  panIssueId: null,
};

const SEARCH_RESPONSE = { sessions: [SESSION_STUB], total: 1, mode: 'fts', durationMs: 2 };
const ARCHIVED_ROW = {
  ...SESSION_STUB,
  id: 1,
  source: 'managed-archived',
  conversationName: 'Archived conversation',
  workspacePath: '/home/user/Projects/archived',
  summary: 'Archived summary',
  lastTs: '2025-01-02T01:00:00Z',
  archivedAt: '2025-01-02T00:00:00Z',
  overdeckManaged: true,
  panIssueId: 'PAN-1391',
};
const FEED_RESPONSE = { rows: [ARCHIVED_ROW, { ...SESSION_STUB, source: 'discovered' }], nextCursor: null };
const FEED_FACETS_RESPONSE = {
  primaryModels: [{ value: 'claude-sonnet-4-6', count: 2 }],
  tags: [{ value: 'feat', count: 2 }],
  tools: [{ value: 'Read', count: 1 }],
  files: [{ value: '/home/user/Projects/alpha/src/auth.ts', count: 1 }],
  enrichmentLevels: [{ value: 1, count: 2 }],
  timeBuckets: [{ value: '24h', count: 2 }],
  costBuckets: [{ value: '<$0.10', count: 2 }],
  sources: [{ value: 'discovered', count: 1 }, { value: 'managed-archived', count: 1 }],
};
const STATS_RESPONSE = { total: 10, enriched: 5, embedded: 2, managedCount: 3 };
const COST_RESPONSE = { sessionCount: 10, totalCost: 0.25, totalTokensIn: 1000, totalTokensOut: 2000 };

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(client: QueryClient, props: ComponentProps<typeof ConversationsPage> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <ConversationsPage {...props} />
    </QueryClientProvider>,
  );
}

function sessionRows() {
  return within(screen.getByTestId('session-table')).getAllByRole('row').slice(1);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationsPage endpoint selection', () => {
  beforeEach(() => {
    capturedOnChange = null;
    componentMocks.sessionDetail.mockClear();
    window.history.replaceState(null, '', '/sessions');
    rpcMocks.listFeed.mockResolvedValue(FEED_RESPONSE);
    rpcMocks.feedFacets.mockResolvedValue(FEED_FACETS_RESPONSE);
    rpcMocks.search.mockResolvedValue(SEARCH_RESPONSE);
    rpcMocks.stats.mockResolvedValue(STATS_RESPONSE);
    rpcMocks.cost.mockResolvedValue(COST_RESPONSE);
    rpcMocks.scan.mockResolvedValue({ inserted: 0, updated: 0, skipped: 0, errors: 0, durationMs: 0 });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls the sessions feed RPC on initial render (no query)', async () => {
    renderPage(makeClient());

    await waitFor(() => expect(screen.queryByTestId('session-table')).toBeInTheDocument());

    expect(rpcMocks.listFeed).toHaveBeenCalledWith({ limit: 100 });
    expect(rpcMocks.feedFacets).toHaveBeenCalledWith({ limit: 100 });
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('renders facet counts from the sessions feed facets RPC', async () => {
    renderPage(makeClient());

    fireEvent.click(await screen.findByText('Filters'));

    expect(screen.getByText('2 · claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByText('feat: 2')).toBeInTheDocument();
  });

  it('calls the sessions feed RPC with a query when keyword search is typed', async () => {
    renderPage(makeClient());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'auth bug' } });

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({
      query: 'auth bug',
      limit: 100,
    }));

    expect(rpcMocks.feedFacets).toHaveBeenLastCalledWith({
      query: 'auth bug',
      limit: 100,
    });
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('keyword feed search includes active facet filters', async () => {
    renderPage(makeClient());

    const filterBtn = screen.getByText('Filters');
    fireEvent.click(filterBtn);

    await waitFor(() => expect(capturedOnChange).not.toBeNull());
    act(() => {
      capturedOnChange!('workspace', '/home/user/Projects/alpha');
    });

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'memory leak' } });

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({
      workspacePath: '/home/user/Projects/alpha',
      query: 'memory leak',
      limit: 100,
    }));
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('list RPC includes active facet filters', async () => {
    renderPage(makeClient());

    const filterBtn = screen.getByText('Filters');
    fireEvent.click(filterBtn);

    await waitFor(() => expect(capturedOnChange).not.toBeNull());
    act(() => {
      capturedOnChange!('managed', true);
    });

    await waitFor(() => {
      expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({ managed: true, limit: 100 });
    });
  });

  it('list RPC includes active harness facet filter', async () => {
    renderPage(makeClient());

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(await screen.findByText('Codex'));

    await waitFor(() => {
      expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({ harness: 'codex', limit: 100 });
    });
  });

  it('feed facets include active facet filters and a bounded limit', async () => {
    renderPage(makeClient());

    fireEvent.click(screen.getByText('Filters'));

    await waitFor(() => expect(capturedOnChange).not.toBeNull());
    act(() => {
      capturedOnChange!('workspace', '/home/user/Projects/archived');
      capturedOnChange!('model', 'claude-sonnet-4-6');
      capturedOnChange!('tag', 'feat');
      capturedOnChange!('tool', 'Read');
      capturedOnChange!('file', '/home/user/Projects/archived/src/auth.ts');
      capturedOnChange!('minCost', '0.01');
      capturedOnChange!('enrichmentLevel', '1');
    });

    await waitFor(() => {
      expect(rpcMocks.feedFacets).toHaveBeenLastCalledWith({
        workspacePath: '/home/user/Projects/archived',
        primaryModel: 'claude-sonnet-4-6',
        tags: ['feat'],
        tools: ['Read'],
        files: ['/home/user/Projects/archived/src/auth.ts'],
        minCost: 0.01,
        enrichmentLevel: 1,
        limit: 100,
      });
    });
  });

  it('wires tag, tool, and file filters into keyword feed search payloads', async () => {
    renderPage(makeClient());

    const filterBtn = screen.getByText('Filters');
    fireEvent.click(filterBtn);

    await waitFor(() => expect(capturedOnChange).not.toBeNull());
    act(() => {
      capturedOnChange!('tag', 'feat');
      capturedOnChange!('tool', 'Read');
      capturedOnChange!('file', 'src/auth.ts');
    });

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'auth' } });

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({
      tags: ['feat'],
      tools: ['Read'],
      files: ['src/auth.ts'],
      query: 'auth',
      limit: 100,
    }));
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('defaults to all sources and renders feed rows in backend order', async () => {
    renderPage(makeClient());

    await waitFor(() => expect(sessionRows()).toHaveLength(2));

    expect(sessionRows()[0]).toHaveTextContent('Archived conversation');
    expect(sessionRows()[0]).toHaveTextContent('Archived summary');
    expect(sessionRows()[1]).toHaveTextContent('Projects/alpha');
    expect(sessionRows()[1]).toHaveTextContent('Fixed the auth bug');
  });

  it('requests managed-archived feed rows and keeps keyword search available when that source is selected', async () => {
    renderPage(makeClient());

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(await screen.findByText('Managed-archived'));

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({ source: 'managed-archived', limit: 100 }));

    expect(rpcMocks.feedFacets).toHaveBeenLastCalledWith({ source: 'managed-archived', limit: 100 });
    expect(screen.getByPlaceholderText('Search sessions…')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'archive needle' } });

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({
      source: 'managed-archived',
      query: 'archive needle',
      limit: 100,
    }));
  });

  it('forces keyword feed search when managed-archived is selected from semantic mode', async () => {
    renderPage(makeClient());

    fireEvent.click(screen.getByRole('button', { name: 'Keyword' }));
    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'archive semantic' } });

    await waitFor(() => expect(rpcMocks.search).toHaveBeenLastCalledWith({
      query: 'archive semantic',
      semantic: true,
      limit: 50,
      offset: 0,
    }));

    rpcMocks.search.mockClear();
    rpcMocks.listFeed.mockClear();

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(await screen.findByText('Managed-archived'));

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({
      source: 'managed-archived',
      query: 'archive semantic',
      limit: 100,
    }));
    expect(screen.getByRole('button', { name: 'Keyword' })).toBeDisabled();
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('requests discovered feed rows when the discovered source is selected', async () => {
    renderPage(makeClient());

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(await screen.findByText('Discovered'));

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({ source: 'discovered', limit: 100 }));

    expect(rpcMocks.feedFacets).toHaveBeenLastCalledWith({ source: 'discovered', limit: 100 });
    expect(screen.getByPlaceholderText('Search sessions…')).toBeInTheDocument();
  });

  it('does not emit duplicate React key warnings when source ids collide', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderPage(makeClient());

    await waitFor(() => expect(sessionRows()).toHaveLength(2));

    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('Encountered two children with the same key'))).toBe(false);
    errorSpy.mockRestore();
  });

  it('selects a row from the initial session URL key', async () => {
    renderPage(makeClient(), { initialSessionKey: 'discovered:1' });

    await screen.findByTestId('session-detail');

    expect(componentMocks.sessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: 1, source: 'discovered' }),
    }));
  });

  it('fetches subsequent feed pages until an initial session URL key is selectable', async () => {
    rpcMocks.listFeed
      .mockResolvedValueOnce({
        rows: [{ ...SESSION_STUB, id: 1, source: 'discovered' }],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        rows: [{
          ...SESSION_STUB,
          id: 99,
          source: 'discovered',
          workspacePath: '/home/user/Projects/deep',
          summary: 'Deep-linked target',
        }],
        nextCursor: null,
      });

    renderPage(makeClient(), { initialSessionKey: 'discovered:99' });

    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenLastCalledWith({ limit: 100, cursor: 'page-2' }));
    await screen.findByTestId('session-detail');

    expect(componentMocks.sessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: 99, source: 'discovered', summary: 'Deep-linked target' }),
    }));
  });

  it('clicking a row updates the session query param with replaceState', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderPage(makeClient());

    await waitFor(() => expect(sessionRows()).toHaveLength(2));
    fireEvent.click(sessionRows()[1]!);

    expect(replaceSpy).toHaveBeenLastCalledWith(null, '', '/sessions?session=discovered%3A1');
    expect(window.location.search).toBe('?session=discovered%3A1');
    replaceSpy.mockRestore();
  });
});
