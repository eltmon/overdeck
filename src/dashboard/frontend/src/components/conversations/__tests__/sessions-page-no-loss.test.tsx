import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsPage } from '../ConversationsPage';

const rpcMocks = vi.hoisted(() => ({
  listFeed: vi.fn(),
  feedFacets: vi.fn(),
  search: vi.fn(),
  stats: vi.fn(),
  cost: vi.fn(),
  scan: vi.fn(),
  getDiscoveredSession: vi.fn(),
  enrichSessions: vi.fn(),
  embedSessions: vi.fn(),
  request: vi.fn((fn: (client: Record<string, unknown>) => unknown) => fn({
    'pan.listSessionsFeed': rpcMocks.listFeed,
    'pan.getSessionsFeedFacets': rpcMocks.feedFacets,
    'pan.searchConversations': rpcMocks.search,
    'pan.getConversationStats': rpcMocks.stats,
    'pan.getConversationCost': rpcMocks.cost,
    'pan.scanConversations': rpcMocks.scan,
    'pan.getDiscoveredSession': rpcMocks.getDiscoveredSession,
    'pan.enrichSessions': rpcMocks.enrichSessions,
    'pan.embedSessions': rpcMocks.embedSessions,
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
  SessionTranscript: () => <section aria-label="Transcript region">Transcript region</section>,
}));

const discoveredFeedRow = {
  id: 42,
  source: 'discovered',
  conversationId: null,
  conversationName: null,
  conversationTitle: null,
  archivedAt: null,
  harness: 'claude-code',
  jsonlPath: '/home/user/.claude/projects/alpha/session.jsonl',
  workspacePath: '/home/user/Projects/alpha',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 12,
  firstTs: '2026-07-01T10:00:00Z',
  lastTs: '2026-07-01T11:00:00Z',
  estimatedCost: 0.123456,
  tokenInput: 1000,
  tokenOutput: 2000,
  tags: ['audit'],
  summary: 'Discovered summary',
  enrichmentLevel: 0,
  enrichmentFailed: false,
  overdeckManaged: false,
  panIssueId: null,
};

const managedFeedRow = {
  ...discoveredFeedRow,
  id: 7,
  source: 'managed-archived',
  conversationId: 'conv-7',
  conversationName: 'Archived conversation',
  conversationTitle: 'Archived title',
  archivedAt: '2026-07-02T12:00:00Z',
  workspacePath: '/home/user/Projects/archive',
  summary: 'Managed archived summary',
  enrichmentLevel: 2,
  overdeckManaged: true,
  panIssueId: 'PAN-1917',
};

const discoveredDetail = {
  ...discoveredFeedRow,
  toolsUsed: ['Read', 'Edit'],
  filesTouched: ['/home/user/Projects/alpha/src/session.ts'],
  summaryDetailed: 'Detailed no-loss audit summary',
};

const feedResponse = {
  rows: [managedFeedRow, discoveredFeedRow],
  nextCursor: 'next-page-cursor',
};

const facetsResponse = {
  primaryModels: [{ value: 'claude-sonnet-4-6', count: 2 }],
  tags: [{ value: 'audit', count: 1 }],
  tools: [{ value: 'Read', count: 1 }],
  files: [{ value: '/home/user/Projects/alpha/src/session.ts', count: 1 }],
  enrichmentLevels: [{ value: 0, count: 1 }, { value: 2, count: 1 }],
  timeBuckets: [{ value: '24h', count: 1 }, { value: '7d', count: 1 }],
  costBuckets: [{ value: '<$0.10', count: 1 }, { value: '$0.10-1', count: 1 }],
  sources: [{ value: 'discovered', count: 1 }, { value: 'managed-archived', count: 1 }],
};

const searchResponse = {
  sessions: [discoveredDetail],
  total: 75,
  mode: 'fts',
  durationMs: 4,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ConversationsPage />
    </QueryClientProvider>,
  );
}

function sessionRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-session-key'));
}

describe('sessions page no-loss audit', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/sessions');
    rpcMocks.listFeed.mockResolvedValue(feedResponse);
    rpcMocks.feedFacets.mockResolvedValue(facetsResponse);
    rpcMocks.search.mockResolvedValue(searchResponse);
    rpcMocks.stats.mockResolvedValue({ total: 10366, enriched: 5, embedded: 2, managedCount: 3120 });
    rpcMocks.cost.mockResolvedValue({ sessionCount: 10366, totalCost: 117.25, totalTokensIn: 1000, totalTokensOut: 2000 });
    rpcMocks.scan.mockResolvedValue({ inserted: 1, updated: 2, skipped: 3, errors: 0, durationMs: 456 });
    rpcMocks.getDiscoveredSession.mockResolvedValue(discoveredDetail);
    rpcMocks.enrichSessions.mockResolvedValue(undefined);
    rpcMocks.embedSessions.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('enumerates the legacy browse, filter, detail, transcript, action, and search affordances', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Session History' })).toBeInTheDocument();
    expect(await screen.findByText('10366')).toBeInTheDocument();
    expect(screen.getByText('indexed')).toBeInTheDocument();
    expect(screen.getByText('3120')).toBeInTheDocument();
    expect(screen.getByText('managed')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search sessions/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keyword' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const filters = await screen.findByText('Source');
    expect(filters).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discovered' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Managed-archived' })).toBeInTheDocument();
    expect(screen.getByText('Time range')).toBeInTheDocument();
    expect(screen.getByText('Workspace path')).toBeInTheDocument();
    expect(screen.getByText('Workspace cost')).toBeInTheDocument();
    expect(screen.getAllByText('Model').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tag').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tool').length).toBeGreaterThan(0);
    expect(screen.getByText('File touched')).toBeInTheDocument();
    expect(screen.getByText('Cost ranges')).toBeInTheDocument();
    expect(screen.getByText('Enrichment levels')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Discovered/ }));
    expect(await screen.findByText('Active filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Source: Discovered/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));

    await waitFor(() => expect(sessionRows()).toHaveLength(2));
    fireEvent.click(sessionRows()[0]!);
    expect(await screen.findByRole('button', { name: 'Open in Command Deck' })).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getAllByText('Managed archived summary').length).toBeGreaterThan(0);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getAllByText('Workspace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Model').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Messages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('File').length).toBeGreaterThan(0);
    expect(screen.getByText('/home/user/.claude/projects/alpha/session.jsonl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in Command Deck' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Transcript region' })).toBeInTheDocument();

    fireEvent.click(sessionRows()[1]!);
    expect(await screen.findByText('Detailed')).toBeInTheDocument();
    expect(screen.getByText('Detailed no-loss audit summary')).toBeInTheDocument();
    expect(screen.getByText('Tools Used')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Files Touched')).toBeInTheDocument();
    expect(screen.getByText('/home/user/Projects/alpha/src/session.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick \(L1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detailed \(L2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Deep \(L3\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Embed' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search sessions/), { target: { value: 'audit' } });
    await waitFor(() => expect(rpcMocks.search).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('guards the WI-8 conversations style contract mechanically', () => {
    const componentDir = join(process.cwd(), 'src/components/conversations');
    const componentFiles = [
      'ConversationsPage.tsx',
      'FacetPanel.tsx',
      'ScanButton.tsx',
      'SessionDetail.tsx',
      'SessionTable.tsx',
      'SessionTranscript.tsx',
    ];
    const forbidden = /\b(?:bg-gray-950|bg-gray-900|rounded-full)\b/;

    for (const file of componentFiles) {
      const path = join(componentDir, file);
      expect(existsSync(path), `${file} should exist for the no-loss style audit`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${file} must not reintroduce bg-gray-950, bg-gray-900, or rounded-full`).not.toMatch(forbidden);
    }
  });
});
