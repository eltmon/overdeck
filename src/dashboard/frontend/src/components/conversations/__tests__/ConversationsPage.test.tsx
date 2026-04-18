/**
 * Tests for ConversationsPage search-vs-list endpoint switching (PAN-457).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsPage } from '../ConversationsPage';

// Mock child components — only the data-fetching logic is under test
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
vi.mock('../FacetPanel', () => ({ FacetPanel: () => null }));

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
  tags: ['feat'],
  summary: 'Fixed the auth bug',
  enrichmentLevel: 1 as const,
  enrichmentFailed: false,
  panopticonManaged: false,
  panIssueId: null,
};

const LIST_RESPONSE = { sessions: [SESSION_STUB], count: 1 };
const SEARCH_RESPONSE = { sessions: [SESSION_STUB], total: 1, mode: 'fts' };
const STATS_RESPONSE = { total: 10, enriched: 5, embedded: 2, managedCount: 3 };

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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls the list endpoint on initial render (no query)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(STATS_RESPONSE) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(LIST_RESPONSE) });
    });

    renderPage(makeClient());

    await waitFor(() => expect(screen.queryByTestId('session-table')).toBeInTheDocument());

    const listCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => url.includes('/api/discovered-sessions?'),
    );
    expect(listCalls.length).toBeGreaterThan(0);

    const searchCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => url.includes('/api/discovered-sessions/search'),
    );
    expect(searchCalls.length).toBe(0);
  });

  it('calls the search endpoint when query is typed', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(STATS_RESPONSE) });
      }
      if (url.includes('/search')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(SEARCH_RESPONSE) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(LIST_RESPONSE) });
    });

    renderPage(makeClient());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'auth bug' } });

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/discovered-sessions/search'),
      );
      expect(searchCalls.length).toBeGreaterThan(0);
    });

    // The search call should include the query param
    const searchCall = fetchMock.mock.calls.find(
      ([url]: [string]) => url.includes('/search'),
    );
    expect(searchCall![0]).toContain('q=auth+bug');
  });
});
