/**
 * No-loss audit gate for the redesigned sessions page (PAN-1917).
 *
 * This test enumerates the legacy sessions-page affordances that must survive
 * the server-paginated feed and compact detail redesign.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsPage } from '../ConversationsPage';

const rpcMocks = vi.hoisted(() => ({
  listFeed: vi.fn(),
  feedFacets: vi.fn(),
  search: vi.fn(),
  stats: vi.fn(),
  cost: vi.fn(),
  scan: vi.fn(),
  get: vi.fn(),
  enrich: vi.fn(),
  embed: vi.fn(),
  request: vi.fn((fn: (client: Record<string, unknown>) => unknown) => fn({
    'pan.listSessionsFeed': rpcMocks.listFeed,
    'pan.getSessionsFeedFacets': rpcMocks.feedFacets,
    'pan.searchConversations': rpcMocks.search,
    'pan.getConversationStats': rpcMocks.stats,
    'pan.getConversationCost': rpcMocks.cost,
    'pan.scanConversations': rpcMocks.scan,
    'pan.getDiscoveredSession': rpcMocks.get,
    'pan.enrichSessions': rpcMocks.enrich,
    'pan.embedSessions': rpcMocks.embed,
  })),
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

vi.mock('../SessionTranscript', () => ({
  SessionTranscript: () => <section aria-label="Transcript">Transcript messages</section>,
}));

const DISCOVERED_ROW = {
  id: 11,
  source: 'discovered',
  discoveredId: 11,
  harness: 'claude-code',
  conversationId: '87',
  conversationName: 'managed-conv',
  conversationTitle: 'Managed target',
  jsonlPath: '/home/user/.claude/projects/alpha/session-11.jsonl',
  workspacePath: '/home/user/Projects/alpha',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 12,
  firstTs: '2026-07-01T10:00:00Z',
  lastTs: '2026-07-01T11:00:00Z',
  estimatedCost: 0.123,
  tokenInput: 1200,
  tokenOutput: 450,
  tags: ['audit'],
  summary: 'Summary from feed',
  enrichmentLevel: 0 as const,
  enrichmentFailed: false,
  overdeckManaged: true,
  panIssueId: 'PAN-1917',
};

const ARCHIVED_ROW = {
  ...DISCOVERED_ROW,
  id: 22,
  source: 'managed-archived',
  discoveredId: 33,
  conversationId: '22',
  conversationName: 'archived-conv',
  conversationTitle: 'Archived target',
  archivedAt: '2026-07-02T09:00:00Z',
  summary: 'Archived summary',
  overdeckManaged: true,
};

const DISCOVERED_DETAIL = {
  ...DISCOVERED_ROW,
  source: 'discovered',
  toolsUsed: ['Read', 'Write'],
  filesTouched: ['/home/user/Projects/alpha/src/auth.ts'],
  summary: 'Summary from detail',
  summaryDetailed: 'Detailed summary from detail',
};

const ARCHIVED_DETAIL = {
  ...DISCOVERED_DETAIL,
  id: 33,
  toolsUsed: ['Bash'],
  filesTouched: ['/home/user/Projects/alpha/src/archived-only.ts'],
  summary: 'Archived hydrated summary',
  summaryDetailed: 'Archived hydrated detail',
};

const FEED_FACETS_RESPONSE = {
  primaryModels: [{ value: 'claude-sonnet-4-6', count: 2 }],
  tags: [{ value: 'audit', count: 2 }],
  tools: [{ value: 'Read', count: 1 }],
  files: [{ value: '/home/user/Projects/alpha/src/auth.ts', count: 1 }],
  enrichmentLevels: [{ value: 0, count: 1 }, { value: 2, count: 1 }],
  timeBuckets: [{ value: '24h', count: 2 }],
  costBuckets: [{ value: '$0.10-1', count: 2, cost: 0.246 }],
  sources: [{ value: 'discovered', count: 1 }, { value: 'managed-archived', count: 1 }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationsPage />
    </QueryClientProvider>,
  );
}

describe('sessions page no-loss audit', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/sessions');
    rpcMocks.listFeed
      .mockResolvedValueOnce({ rows: [DISCOVERED_ROW, ARCHIVED_ROW], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ rows: [], nextCursor: null })
      .mockResolvedValue({ rows: [DISCOVERED_ROW, ARCHIVED_ROW], nextCursor: null });
    rpcMocks.feedFacets.mockResolvedValue(FEED_FACETS_RESPONSE);
    rpcMocks.search.mockResolvedValue({
      sessions: [DISCOVERED_DETAIL],
      total: 75,
      mode: 'fts',
      durationMs: 2,
    });
    rpcMocks.stats.mockResolvedValue({ total: 10, enriched: 4, embedded: 3, managedCount: 2 });
    rpcMocks.cost.mockResolvedValue({ sessionCount: 10, totalCost: 0.246, totalTokensIn: 1000, totalTokensOut: 500 });
    rpcMocks.scan.mockResolvedValue({ inserted: 1, updated: 0, skipped: 0, errors: 0, durationMs: 10 });
    rpcMocks.get.mockImplementation(({ id }: { id: number }) => Promise.resolve(
      id === ARCHIVED_ROW.discoveredId ? ARCHIVED_DETAIL : DISCOVERED_DETAIL,
    ));
    rpcMocks.enrich.mockResolvedValue({ processed: 1, totalCost: 0, failures: 0 });
    rpcMocks.embed.mockResolvedValue({ total: 1, embedded: 1, model: 'text-embedding-3-small' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('preserves the legacy sessions page controls, facets, actions, metadata, and transcript', async () => {
    renderPage();

    expect(await screen.findByPlaceholderText('Search sessions…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keyword' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument();
    expect(await screen.findByText(/indexed/)).toBeInTheDocument();
    await waitFor(() => expect(rpcMocks.listFeed).toHaveBeenCalledWith({ limit: 100, cursor: 'next-page' }));

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Managed-archived' })).toBeInTheDocument();

    for (const label of [
      'Source',
      'Time range',
      'Workspace path',
      'Model',
      'Tag',
      'Tool',
      'File touched',
      'Workspace cost',
      'Cost ranges',
      'Enrichment levels',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getByRole('button', { name: '2 · claude-sonnet-4-6' }));
    expect(await screen.findByText('Active filters')).toBeInTheDocument();
    expect(screen.getByText(/Model: claude-sonnet-4-6/)).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Managed target'));
    expect(await screen.findByText('Summary from detail')).toBeInTheDocument();
    expect(await screen.findByText('Detailed summary from detail')).toBeInTheDocument();
    expect(screen.getByText('audit')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('/home/user/Projects/alpha/src/auth.ts')).toBeInTheDocument();
    expect(screen.getByText('/home/user/.claude/projects/alpha/session-11.jsonl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick (L1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detailed (L2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deep (L3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Embed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in Command Deck' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Transcript' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Archived target'));
    expect(await screen.findByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(await screen.findByText('Archived hydrated summary')).toBeInTheDocument();
    expect(screen.getByText('Archived hydrated detail')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('/home/user/Projects/alpha/src/archived-only.ts')).toBeInTheDocument();
    expect(rpcMocks.get).toHaveBeenCalledWith({ id: ARCHIVED_ROW.discoveredId });

    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'target' } });
    expect(await screen.findByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('keeps the sessions surface on theme tokens instead of the retired gray/pill classes', () => {
    const componentUrls = [
      '../ConversationsPage.tsx',
      '../SessionTable.tsx',
      '../SessionDetail.tsx',
      '../FacetPanel.tsx',
      '../ScanButton.tsx',
    ];

    const retiredClassPattern = new RegExp([
      '\\bbg-gray-9' + '(?:00|50)\\b',
      '\\brounded' + '-full\\b',
    ].join('|'));

    for (const componentUrl of componentUrls) {
      const source = readFileSync(new URL(componentUrl, import.meta.url), 'utf8');
      expect(source, componentUrl).not.toMatch(retiredClassPattern);
    }
  });
});
