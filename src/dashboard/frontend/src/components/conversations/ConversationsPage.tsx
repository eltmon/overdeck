/**
 * Conversations page — Session Discovery & Search (PAN-457)
 *
 * Shows indexed Claude Code sessions with search, filters, and enrichment controls.
 */

import { useState, useCallback, useEffect } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Filter } from 'lucide-react';
import { WS_METHODS } from '@overdeck/contracts';
import type { DiscoveredSessionSnapshot, SessionsFeedFacetsSnapshot, SessionsFeedRowSnapshot } from '@overdeck/contracts';
import { SessionTable } from './SessionTable';
import { SessionDetail } from './SessionDetail';
import { ScanButton } from './ScanButton';
import { FacetPanel } from './FacetPanel';
import { useDashboardStore, selectScanProgress } from '../../lib/store';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { accumulateFeedPages } from './feedPages';

// ─── API helpers ──────────────────────────────────────────────────────────────

type SessionSource = 'discovered' | 'managed-archived';

type SourceFilter = 'all' | SessionSource;

interface DiscoveredSession {
  id: number;
  source: SessionSource;
  discoveredId?: number | null;
  harness: string;
  conversationId?: string | null;
  conversationName?: string | null;
  archivedAt?: string | null;
  jsonlPath: string | null;
  workspacePath: string | null;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  filesTouched: string[];
  tags: string[];
  summary: string | null;
  conversationTitle?: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  overdeckManaged: boolean;
  panIssueId: string | null;
}

interface FeedResponse {
  rows: DiscoveredSession[];
  nextCursor: string | null;
}

interface StatsResponse {
  total: number;
  enriched: number;
  embedded: number;
  managedCount: number;
  embeddingModels?: Array<{ model: string; embedded: number }>;
}

interface CostResponse {
  sessionCount: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface SearchResponse {
  sessions: DiscoveredSession[];
  total: number;
  mode: string;
  error?: string;
}

interface ConversationsPageProps {
  initialSessionKey?: string | null;
}

interface ScanResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

interface ConversationRpcFilter {
  harness?: string;
  workspacePath?: string;
  primaryModel?: string;
  since?: string;
  managed?: boolean;
  enriched?: boolean;
  minCost?: number;
  maxCost?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  enrichmentLevel?: number;
  query?: string;
  source?: SessionSource;
}

interface FacetValue {
  value: string;
  count: number;
  label?: string;
  cost?: number;
  minCost?: string;
  maxCost?: string;
}

function sessionKey(session: DiscoveredSession): string {
  return `${session.source}:${session.id}`;
}

function toFacetOptions(facets: SessionsFeedFacetsSnapshot | undefined) {
  return {
    harnesses: [],
    models: facets?.primaryModels.map((model) => ({ value: model.value, count: model.count })) ?? [],
    workspaces: [],
    tags: facets?.tags.map((tag) => ({ value: tag.value, count: tag.count })) ?? [],
    tools: facets?.tools.map((tool) => ({ value: tool.value, count: tool.count })) ?? [],
    files: facets?.files.map((file) => ({ value: file.value, count: file.count })) ?? [],
    timeRanges: facets?.timeBuckets.map((bucket) => ({
      value: bucket.value === '24h' ? 'today' : bucket.value,
      label: bucket.value === '24h' ? 'Today' : bucket.value,
      count: bucket.count,
    })) ?? [],
    costRanges: facets?.costBuckets.map((bucket) => ({
      value: bucket.value,
      label: bucket.value,
      count: bucket.count,
      minCost: bucket.value === '<$0.10' ? undefined : bucket.value === '$0.10-1' ? '0.10' : bucket.value === '$1-10' ? '1' : '10',
      maxCost: bucket.value === '<$0.10' ? '0.10' : bucket.value === '$0.10-1' ? '1' : bucket.value === '$1-10' ? '10' : undefined,
    })) ?? [],
    enrichmentLevels: facets?.enrichmentLevels.map((level) => ({ value: String(level.value), count: level.count })) ?? [],
  } satisfies {
    harnesses: FacetValue[];
    models: FacetValue[];
    workspaces: FacetValue[];
    tags: FacetValue[];
    tools: FacetValue[];
    files: FacetValue[];
    timeRanges: FacetValue[];
    costRanges: FacetValue[];
    enrichmentLevels: FacetValue[];
  };
}

function buildFilterParams(filters: {
  source?: SourceFilter;
  harness?: string;
  workspace?: string;
  since?: string;
  managed?: boolean;
  enriched?: boolean;
  model?: string;
  tag?: string;
  tool?: string;
  file?: string;
  minCost?: string;
  maxCost?: string;
  enrichmentLevel?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.harness) params.set('harness', filters.harness);
  if (filters.workspace) params.set('workspacePath', filters.workspace);
  if (filters.since) params.set('since', filters.since);
  if (filters.managed) params.set('managed', 'true');
  if (filters.enriched) params.set('enriched', 'true');
  if (filters.model) params.set('primaryModel', filters.model);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.tool) params.set('tool', filters.tool);
  if (filters.file) params.set('file', filters.file);
  if (filters.minCost) params.set('minCost', filters.minCost);
  if (filters.maxCost) params.set('maxCost', filters.maxCost);
  if (filters.enrichmentLevel) params.set('enrichmentLevel', filters.enrichmentLevel);
  if (filters.source && filters.source !== 'all') params.set('source', filters.source);
  return params;
}

function filterPayload(params: URLSearchParams): ConversationRpcFilter {
  const payload: ConversationRpcFilter = {};
  const harness = params.get('harness');
  const workspacePath = params.get('workspacePath');
  const primaryModel = params.get('primaryModel');
  const since = params.get('since');
  const managed = params.get('managed');
  const enriched = params.get('enriched');
  const tag = params.get('tag');
  const tool = params.get('tool');
  const file = params.get('file');
  const minCost = params.get('minCost');
  const maxCost = params.get('maxCost');
  const enrichmentLevel = params.get('enrichmentLevel');
  const source = params.get('source');
  const query = params.get('query');
  if (harness) payload.harness = harness;
  if (workspacePath) payload.workspacePath = workspacePath;
  if (primaryModel) payload.primaryModel = primaryModel;
  if (since) payload.since = since;
  if (managed) payload.managed = managed === 'true';
  if (enriched) payload.enriched = enriched === 'true';
  if (tag) payload.tags = [tag];
  if (tool) payload.tools = [tool];
  if (file) payload.files = [file];
  if (minCost && Number.isFinite(Number(minCost))) payload.minCost = Number(minCost);
  if (maxCost && Number.isFinite(Number(maxCost))) payload.maxCost = Number(maxCost);
  if (enrichmentLevel && Number.isFinite(Number(enrichmentLevel))) payload.enrichmentLevel = Number(enrichmentLevel);
  if (source === 'discovered' || source === 'managed-archived') payload.source = source;
  if (query) payload.query = query;
  return payload;
}

function fromRpcSession(session: DiscoveredSessionSnapshot): DiscoveredSession {
  return {
    id: session.id,
    source: 'discovered',
    discoveredId: session.id,
    harness: session.harness ?? 'claude-code',
    conversationId: session.conversationId ?? null,
    conversationName: session.conversationName ?? null,
    jsonlPath: session.jsonlPath,
    workspacePath: session.workspacePath ?? null,
    primaryModel: session.primaryModel ?? null,
    messageCount: session.messageCount,
    firstTs: session.firstTs ?? null,
    lastTs: session.lastTs ?? null,
    estimatedCost: session.estimatedCost,
    tokenInput: session.tokenInput,
    tokenOutput: session.tokenOutput,
    toolsUsed: [...session.toolsUsed],
    filesTouched: [...session.filesTouched],
    tags: [...session.tags],
    summary: session.summary ?? null,
    conversationTitle: session.conversationTitle ?? null,
    enrichmentLevel: session.enrichmentLevel as 0 | 1 | 2 | 3,
    enrichmentFailed: session.enrichmentFailed,
    overdeckManaged: session.overdeckManaged,
    panIssueId: session.panIssueId ?? null,
  };
}

function fromFeedRow(row: SessionsFeedRowSnapshot): DiscoveredSession {
  return {
    id: row.id,
    source: row.source,
    discoveredId: row.discoveredId ?? null,
    harness: row.harness ?? 'claude-code',
    conversationId: row.conversationId ?? null,
    conversationName: row.conversationName ?? null,
    conversationTitle: row.conversationTitle ?? null,
    archivedAt: row.archivedAt ?? null,
    jsonlPath: row.jsonlPath ?? null,
    workspacePath: row.workspacePath ?? null,
    primaryModel: row.primaryModel ?? null,
    messageCount: row.messageCount,
    firstTs: row.firstTs ?? null,
    lastTs: row.lastTs ?? null,
    estimatedCost: row.estimatedCost,
    tokenInput: row.tokenInput,
    tokenOutput: row.tokenOutput,
    toolsUsed: [],
    filesTouched: [],
    tags: [...row.tags],
    summary: row.summary ?? null,
    enrichmentLevel: row.enrichmentLevel as 0 | 1 | 2 | 3,
    enrichmentFailed: row.enrichmentFailed,
    overdeckManaged: row.overdeckManaged,
    panIssueId: row.panIssueId ?? null,
  };
}

async function fetchFeed(params: URLSearchParams, cursor?: string): Promise<FeedResponse> {
  const result = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.listSessionsFeed]({
      ...filterPayload(params),
      limit: Number(params.get('limit') ?? 50),
      ...(cursor ? { cursor } : {}),
    }),
  );
  return { rows: result.rows.map(fromFeedRow), nextCursor: result.nextCursor ?? null };
}

async function fetchFeedFacets(params: URLSearchParams): Promise<SessionsFeedFacetsSnapshot> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getSessionsFeedFacets]({
      ...filterPayload(params),
      limit: Number(params.get('limit') ?? 50),
    }),
  );
}

async function fetchSearch(
  q: string,
  filterParams: URLSearchParams,
  limit = 50,
  offset = 0,
  semantic = false,
): Promise<SearchResponse> {
  const result = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.searchConversations]({
      ...filterPayload(filterParams),
      query: q,
      semantic,
      limit,
      offset,
    }),
  );
  return { ...result, sessions: result.sessions.map(fromRpcSession) };
}

async function fetchStats(): Promise<StatsResponse> {
  const stats = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getConversationStats]({}),
  );
  return {
    ...stats,
    embeddingModels: stats.embeddingModels?.map((entry) => ({ ...entry })),
  };
}

async function fetchCost(params: URLSearchParams): Promise<CostResponse> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getConversationCost](filterPayload(params)),
  );
}

async function triggerScan(): Promise<ScanResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.scanConversations]({ mode: 'system' }),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsPage({ initialSessionKey = null }: ConversationsPageProps) {
  const queryClient = useQueryClient();
  const scanProgress = useDashboardStore(selectScanProgress);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSessionKey);
  const [showFacets, setShowFacets] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [filters, setFilters] = useState<{
    source?: SourceFilter;
    harness?: string;
    workspace?: string;
    since?: string;
    managed?: boolean;
    enriched?: boolean;
    model?: string;
    tag?: string;
    tool?: string;
    file?: string;
    minCost?: string;
    maxCost?: string;
    enrichmentLevel?: string;
  }>({});

  const sourceFilter = filters.source ?? 'all';
  const trimmedQuery = query.trim();
  const [debouncedSemanticQuery, setDebouncedSemanticQuery] = useState(trimmedQuery);
  const semanticQuery = semanticSearch ? debouncedSemanticQuery : '';
  const feedQueryText = semanticSearch ? '' : trimmedQuery;
  const filterParams = buildFilterParams(filters);

  useEffect(() => {
    if (!semanticSearch) {
      setDebouncedSemanticQuery(trimmedQuery);
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSemanticQuery(trimmedQuery), 350);
    return () => window.clearTimeout(timer);
  }, [semanticSearch, trimmedQuery]);

  useEffect(() => {
    setSelectedKey(initialSessionKey);
  }, [initialSessionKey]);

  const feedParams = new URLSearchParams({ limit: '100' });
  for (const [key, value] of filterParams) {
    feedParams.set(key, value);
  }
  if (feedQueryText) feedParams.set('query', feedQueryText);

  const feedQuery = useInfiniteQuery({
    queryKey: ['sessions-feed', feedParams.toString()],
    queryFn: ({ pageParam }) => fetchFeed(feedParams, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !semanticQuery,
  });

  const { data: feedFacets } = useQuery({
    queryKey: ['sessions-feed-facets', feedParams.toString()],
    queryFn: () => fetchFeedFacets(feedParams),
    enabled: !semanticQuery,
    staleTime: 30_000,
  });

  const SEARCH_PAGE_SIZE = 50;

  const { data: searchData, isLoading: isSearchLoading } = useQuery({
    queryKey: ['discovered-sessions-search', semanticQuery, filterParams.toString(), searchOffset, semanticSearch],
    queryFn: () => fetchSearch(semanticQuery, filterParams, SEARCH_PAGE_SIZE, searchOffset, semanticSearch),
    enabled: !!semanticQuery,
  });

  const { data: stats } = useQuery({
    queryKey: ['discovered-sessions-stats'],
    queryFn: fetchStats,
    staleTime: 30_000,
  });

  const { data: cost } = useQuery({
    queryKey: ['discovered-sessions-cost', filterParams.toString()],
    queryFn: () => fetchCost(filterParams),
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions-feed'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions-feed-facets'] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-stats'] });
    },
  });

  const isLoading = semanticQuery
    ? isSearchLoading
    : feedQuery.isLoading;
  const feedSessions = accumulateFeedPages(feedQuery.data?.pages);
  const sessions = semanticQuery
    ? (searchData?.sessions ?? [])
    : feedSessions;

  const selected = selectedKey != null ? sessions.find((s) => sessionKey(s) === selectedKey) ?? null : null;
  const facetOptions = toFacetOptions(feedFacets);
  const activeFilterChips = [
    sourceFilter !== 'all' ? { key: 'source', label: `Source: ${sourceFilter === 'discovered' ? 'Discovered' : 'Managed-archived'}` } : null,
    filters.harness ? { key: 'harness', label: `Harness: ${filters.harness}` } : null,
    filters.workspace ? { key: 'workspace', label: `Workspace: ${filters.workspace}` } : null,
    filters.model ? { key: 'model', label: `Model: ${filters.model}` } : null,
    filters.tag ? { key: 'tag', label: `Tag: ${filters.tag}` } : null,
    filters.tool ? { key: 'tool', label: `Tool: ${filters.tool}` } : null,
    filters.file ? { key: 'file', label: `File: ${filters.file}` } : null,
    filters.since ? { key: 'since', label: `Since: ${filters.since}` } : null,
    filters.managed ? { key: 'managed', label: 'Managed' } : null,
    filters.enriched ? { key: 'enriched', label: 'Enriched' } : null,
    filters.minCost ? { key: 'minCost', label: `Min cost: $${filters.minCost}` } : null,
    filters.maxCost ? { key: 'maxCost', label: `Max cost: $${filters.maxCost}` } : null,
    filters.enrichmentLevel ? { key: 'enrichmentLevel', label: `Enrichment: L${filters.enrichmentLevel}` } : null,
  ].filter((chip): chip is { key: string; label: string } => chip !== null);

  useEffect(() => {
    if (
      semanticQuery
      || selectedKey == null
      || selected != null
      || !feedQuery.hasNextPage
      || feedQuery.isFetchingNextPage
    ) {
      return;
    }
    void feedQuery.fetchNextPage();
  }, [semanticQuery, feedQuery, selected, selectedKey]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSearchOffset(0);
  }, []);

  const handleFilterChange = useCallback((key: string, value: string | boolean | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSearchOffset(0);
  }, []);

  const handleSelectSession = useCallback((key: string | null) => {
    setSelectedKey(key);
    const params = new URLSearchParams(window.location.search);
    if (key) {
      params.set('session', key);
    } else {
      params.delete('session');
    }
    const queryString = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${queryString ? `?${queryString}` : ''}`);
  }, []);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-medium text-foreground">Session History</h1>

        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground ml-2">
            <span><span className="text-foreground font-mono">{stats.total}</span> indexed</span>
            <span><span className="text-success font-mono">{stats.enriched}</span> enriched</span>
            <span><span className="text-primary font-mono">{stats.managedCount}</span> managed</span>
            <span><span className="text-signal-cost-foreground font-mono">${(cost?.totalCost ?? 0).toFixed(4)}</span> est. cost</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Search bar */}
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="w-full bg-card border border-border rounded pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
          />
        </div>

        <button
          onClick={() => {
            setSemanticSearch((v) => !v);
            setSearchOffset(0);
          }}
          className={`px-3 py-1.5 rounded text-xs border transition-colors ${
            semanticSearch
              ? 'bg-signal-review/8 border-signal-review/32 text-signal-review-foreground'
              : 'bg-card border-border text-muted-foreground hover:border-border'
          }`}
        >
          {semanticSearch ? 'Semantic' : 'Keyword'}
        </button>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFacets((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors ${
            showFacets
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-card border-border text-muted-foreground hover:border-border'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
        </button>

        {/* Scan button */}
        <ScanButton
          isScanning={scanMutation.isPending}
          onScan={() => scanMutation.mutate()}
          lastResult={scanMutation.data}
          progress={scanProgress}
        />
      </div>

      {activeFilterChips.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background shrink-0 text-xs">
          <span className="text-muted-foreground">Active filters</span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => {
              handleFilterChange(chip.key, undefined);
              if (chip.key === 'minCost') handleFilterChange('maxCost', undefined);
              if (chip.key === 'maxCost') handleFilterChange('minCost', undefined);
            }}
              className="px-2 py-1 rounded-sm bg-primary/8 text-primary border border-primary/32 hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {chip.label} <span className="text-primary">×</span>
            </button>
          ))}
          <button
            onClick={() => setFilters({})}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Facet panel */}
        {showFacets && (
          <FacetPanel filters={filters} facets={facetOptions} onChange={handleFilterChange} />
        )}

        {/* Session list */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selected ? 'border-r border-border' : ''}`}>
          {semanticQuery && searchData?.error && (
            <div className="px-4 py-2 border-b border-warning/32 bg-warning/8 text-warning-foreground text-xs">
              Semantic search unavailable: {searchData.error}
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <span className="text-sm">No sessions found</span>
              {!stats?.total && (
                <span className="text-xs">Run a scan to discover Claude Code sessions</span>
              )}
            </div>
          ) : (
            <>
              <SessionTable
                sessions={sessions}
                selectedId={selectedKey}
                onSelect={handleSelectSession}
                hasMore={!semanticQuery && feedQuery.hasNextPage}
                isLoadingMore={feedQuery.isFetchingNextPage}
                onLoadMore={() => {
                  void feedQuery.fetchNextPage();
                }}
              />
              {semanticQuery && searchData && searchData.total > SEARCH_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-border shrink-0 text-xs text-muted-foreground">
                  <span>
                    {searchOffset + 1}–{searchOffset + sessions.length} of {searchData.total} results
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={searchOffset === 0}
                      onClick={() => setSearchOffset((o) => Math.max(0, o - SEARCH_PAGE_SIZE))}
                      className="px-2 py-1 rounded bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Prev
                    </button>
                    <button
                      disabled={searchOffset + SEARCH_PAGE_SIZE >= searchData.total}
                      onClick={() => setSearchOffset((o) => o + SEARCH_PAGE_SIZE)}
                      className="px-2 py-1 rounded bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="min-w-[28rem] flex-[1.15] overflow-hidden">
            <SessionDetail
              session={selected}
              onClose={() => handleSelectSession(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
