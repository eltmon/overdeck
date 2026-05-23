/**
 * Tests for ConversationsPage search-vs-list endpoint switching and filter
 * preservation during search (PAN-457).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsPage } from '../ConversationsPage';

const rpcMocks = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  stats: vi.fn(),
  cost: vi.fn(),
  costByWorkspace: vi.fn(),
  scan: vi.fn(),
  request: vi.fn((fn: (client: Record<string, unknown>) => unknown) => fn({
    'pan.listDiscoveredSessions': rpcMocks.list,
    'pan.searchConversations': rpcMocks.search,
    'pan.getConversationStats': rpcMocks.stats,
    'pan.getConversationCost': rpcMocks.cost,
    'pan.getConversationCostByWorkspace': rpcMocks.costByWorkspace,
    'pan.scanConversations': rpcMocks.scan,
  })),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({ request: rpcMocks.request }),
}));

// ─── FacetPanel mock captures onChange so tests can drive filter state ─────

type FilterOnChange = (key: string, val: string | boolean | undefined) => void;
let capturedOnChange: FilterOnChange | null = null;

vi.mock('../FacetPanel', () => ({
  FacetPanel: ({ onChange }: { onChange: FilterOnChange }) => {
    capturedOnChange = onChange;
    return null;
  },
}));

vi.mock('../SessionTable', () => ({
  SessionTable: ({ sessions }: { sessions: unknown[] }) => (
    <div data-testid="session-table">sessions:{sessions.length}</div>
  ),
}));
vi.mock('../SessionDetail', () => ({ SessionDetail: () => null }));
vi.mock('../ScanButton', () => ({
  ScanButton: ({ onScan }: { onScan: () => void }) => (
    <button data-testid="scan-btn" onClick={onScan}>Scan</button>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_STUB = {
  id: 1,
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
  panopticonManaged: false,
  panIssueId: null,
};

const LIST_RESPONSE = { sessions: [SESSION_STUB], count: 1, total: 1 };
const SEARCH_RESPONSE = { sessions: [SESSION_STUB], total: 1, mode: 'fts', durationMs: 2 };
const ARCHIVED_RESPONSE = [{
  ...SESSION_STUB,
  id: 2,
  source: 'managed-archived',
  conversationName: 'Archived conversation',
  archivedAt: '2025-01-02T00:00:00Z',
  panopticonManaged: true,
}];
const STATS_RESPONSE = { total: 10, enriched: 5, embedded: 2, managedCount: 3 };
const COST_RESPONSE = { sessionCount: 10, totalCost: 0.25, totalTokensIn: 1000, totalTokensOut: 2000 };
const WORKSPACE_COST_RESPONSE = {
  groupBy: 'workspace' as const,
  entries: [
    { key: '/home/user/Projects/alpha', totalCost: 0.20, sessionCount: 8, totalTokensIn: 800, totalTokensOut: 1600 },
    { key: '/home/user/Projects/beta', totalCost: 0.05, sessionCount: 2, totalTokensIn: 200, totalTokensOut: 400 },
  ],
  grandTotal: 0.25,
  totalTokensIn: 1000,
  totalTokensOut: 2000,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ConversationsPage />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationsPage endpoint selection', () => {
  beforeEach(() => {
    capturedOnChange = null;
    rpcMocks.list.mockResolvedValue(LIST_RESPONSE);
    rpcMocks.search.mockResolvedValue(SEARCH_RESPONSE);
    rpcMocks.stats.mockResolvedValue(STATS_RESPONSE);
    rpcMocks.cost.mockResolvedValue(COST_RESPONSE);
    rpcMocks.costByWorkspace.mockResolvedValue(WORKSPACE_COST_RESPONSE);
    rpcMocks.scan.mockResolvedValue({ inserted: 0, updated: 0, skipped: 0, errors: 0, durationMs: 0 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(ARCHIVED_RESPONSE),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls the list RPC on initial render (no query)', async () => {
    renderPage(makeClient());

    await waitFor(() => expect(screen.queryByTestId('session-table')).toBeInTheDocument());

    expect(rpcMocks.list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(rpcMocks.search).not.toHaveBeenCalled();
  });

  it('renders workspace cost aggregates from the backend full-corpus RPC', async () => {
    renderPage(makeClient());

    await waitFor(() => expect(screen.getByTestId('workspace-cost-breakdown')).toBeInTheDocument());

    expect(rpcMocks.costByWorkspace).toHaveBeenCalledWith({});
    expect(screen.getByTestId('workspace-cost-breakdown')).toHaveTextContent('/home/user/Projects/alpha $0.2000');
    expect(screen.getByTestId('workspace-cost-breakdown')).toHaveTextContent('/home/user/Projects/beta $0.0500');
  });

  it('calls the search RPC when query is typed', async () => {
    renderPage(makeClient());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'auth bug' } });

    await waitFor(() => expect(rpcMocks.search).toHaveBeenCalled());

    expect(rpcMocks.search).toHaveBeenLastCalledWith({
      query: 'auth bug',
      semantic: false,
      limit: 50,
      offset: 0,
    });
  });

  it('search RPC includes active facet filters', async () => {
    renderPage(makeClient());

    const filterBtn = screen.getByText('Filters');
    fireEvent.click(filterBtn);

    await waitFor(() => expect(capturedOnChange).not.toBeNull());
    act(() => {
      capturedOnChange!('workspace', '/home/user/Projects/alpha');
    });

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'memory leak' } });

    await waitFor(() => expect(rpcMocks.search).toHaveBeenCalled());
    expect(rpcMocks.search).toHaveBeenLastCalledWith({
      workspacePath: '/home/user/Projects/alpha',
      query: 'memory leak',
      semantic: false,
      limit: 50,
      offset: 0,
    });
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
      expect(rpcMocks.list).toHaveBeenLastCalledWith({ managed: true, limit: 50, offset: 0 });
    });
  });

  it('wires tag, tool, and file filters into search RPC payloads', async () => {
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

    await waitFor(() => expect(rpcMocks.search).toHaveBeenCalled());
    expect(rpcMocks.search).toHaveBeenLastCalledWith({
      tags: ['feat'],
      tools: ['Read'],
      files: ['src/auth.ts'],
      query: 'auth',
      semantic: false,
      limit: 50,
      offset: 0,
    });
  });
});
