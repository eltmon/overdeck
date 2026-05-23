/**
 * Conversations page — Session Discovery & Search (PAN-457)
 *
 * Shows indexed Claude Code sessions with search, filters, and enrichment controls.
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Filter } from 'lucide-react';
import { WS_METHODS } from '@panctl/contracts';
import type { DiscoveredSessionSnapshot } from '@panctl/contracts';
import { SessionTable } from './SessionTable';
import { SessionDetail } from './SessionDetail';
import { ScanButton } from './ScanButton';
import { FacetPanel } from './FacetPanel';
import { useDashboardStore, selectScanProgress } from '../../lib/store';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';

// ─── API helpers ──────────────────────────────────────────────────────────────

type SessionSource = 'discovered' | 'managed-archived';

type SourceFilter = 'all' | SessionSource;

interface DiscoveredSession {
  id: number;
  source: SessionSource;
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
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  panopticonManaged: boolean;
  panIssueId: string | null;
}

interface ListResponse {
  sessions: DiscoveredSession[];
  count: number;
  total: number;
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

interface WorkspaceCostEntry {
  key: string;
  totalCost: number;
  sessionCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface WorkspaceCostResponse {
  groupBy: 'workspace' | 'model' | 'day' | 'month';
  entries: readonly WorkspaceCostEntry[];
  grandTotal: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface SearchResponse {
  sessions: DiscoveredSession[];
  total: number;
  mode: string;
  error?: string;
}

interface ArchivedConversationResponse extends Omit<DiscoveredSession, 'source'> {
  source: 'managed-archived';
  conversationName: string;
  archivedAt: string;
}

interface ScanResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

interface ConversationRpcFilter {
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
}

interface FacetValue {
  value: string;
  count: number;
  label?: string;
  cost?: number;
  minCost?: string;
  maxCost?: string;
}

function countFacetValues(values: Array<string | null | undefined>, costs?: number[]): FacetValue[] {
  const counts = new Map<string, FacetValue>();
  values.forEach((value, index) => {
    if (!value) return;
    const current = counts.get(value) ?? { value, count: 0, cost: 0 };
    current.count += 1;
    current.cost = (current.cost ?? 0) + (costs?.[index] ?? 0);
    counts.set(value, current);
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function countTimeFacets(sessions: DiscoveredSession[]): FacetValue[] {
  const now = Date.now();
  const ranges = [
    { value: 'today', label: 'Today', days: 1 },
    { value: '7d', label: 'Last 7 days', days: 7 },
    { value: '30d', label: 'Last 30 days', days: 30 },
    { value: '90d', label: 'Last 90 days', days: 90 },
  ];
  return ranges.map((range) => {
    const cutoff = now - range.days * 86_400_000;
    const count = sessions.filter((session) => {
      const ts = session.lastTs ? Date.parse(session.lastTs) : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
    return { value: range.value, label: range.label, count };
  });
}

function sessionKey(session: DiscoveredSession): string {
  return `${session.source}-${session.id}`;
}

function compareSessionsByLastTs(a: DiscoveredSession, b: DiscoveredSession): number {
  const aTime = a.lastTs ? Date.parse(a.lastTs) : 0;
  const bTime = b.lastTs ? Date.parse(b.lastTs) : 0;
  return bTime - aTime;
}

function countCostFacets(sessions: DiscoveredSession[]): FacetValue[] {
  const ranges = [
    { value: 'free', label: '$0', minCost: undefined, maxCost: '0' },
    { value: 'low', label: '$0–$0.01', minCost: '0', maxCost: '0.01' },
    { value: 'medium', label: '$0.01–$0.05', minCost: '0.01', maxCost: '0.05' },
    { value: 'high', label: '$0.05+', minCost: '0.05', maxCost: undefined },
  ];
  return ranges.map((range) => {
    const min = range.minCost === undefined ? undefined : Number(range.minCost);
    const max = range.maxCost === undefined ? undefined : Number(range.maxCost);
    const matching = sessions.filter((session) => {
      const cost = session.estimatedCost;
      return (min === undefined || cost >= min) && (max === undefined || cost <= max);
    });
    return {
      value: range.value,
      label: range.label,
      count: matching.length,
      cost: matching.reduce((sum, session) => sum + session.estimatedCost, 0),
      minCost: range.minCost,
      maxCost: range.maxCost,
    };
  });
}

function buildFilterParams(filters: {
  source?: SourceFilter;
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
  return params;
}

function filterPayload(params: URLSearchParams): ConversationRpcFilter {
  const payload: ConversationRpcFilter = {};
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
  return payload;
}

function fromRpcSession(session: DiscoveredSessionSnapshot): DiscoveredSession {
  return {
    id: session.id,
    source: 'discovered',
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
    enrichmentLevel: session.enrichmentLevel as 0 | 1 | 2 | 3,
    enrichmentFailed: session.enrichmentFailed,
    panopticonManaged: session.panopticonManaged,
    panIssueId: session.panIssueId ?? null,
  };
}

async function fetchSessions(params: URLSearchParams): Promise<ListResponse> {
  const result = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.listDiscoveredSessions]({
      ...filterPayload(params),
      limit: Number(params.get('limit') ?? 50),
      offset: Number(params.get('offset') ?? 0),
    }),
  );
  return { ...result, sessions: result.sessions.map(fromRpcSession) };
}

async function fetchArchivedConversations(params: URLSearchParams): Promise<DiscoveredSession[]> {
  const query = params.toString();
  const response = await fetch(`/api/conversations/archived${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error(`Failed to load archived conversations: ${response.status}`);
  return (await response.json()) as ArchivedConversationResponse[];
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

async function fetchWorkspaceCost(params: URLSearchParams): Promise<WorkspaceCostResponse> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getConversationCostByWorkspace](filterPayload(params)),
  );
}

async function triggerScan(): Promise<ScanResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.scanConversations]({ mode: 'system' }),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsPage() {
  const queryClient = useQueryClient();
  const scanProgress = useDashboardStore(selectScanProgress);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showFacets, setShowFacets] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [filters, setFilters] = useState<{
    source?: SourceFilter;
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
  const searchVisible = sourceFilter !== 'managed-archived';
  const effectiveQuery = searchVisible ? (semanticSearch ? debouncedSemanticQuery : trimmedQuery) : '';
  const filterParams = buildFilterParams(filters);

  useEffect(() => {
    if (!semanticSearch) {
      setDebouncedSemanticQuery(trimmedQuery);
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSemanticQuery(trimmedQuery), 350);
    return () => window.clearTimeout(timer);
  }, [semanticSearch, trimmedQuery]);

  const listParams = new URLSearchParams({ limit: '50' });
  const archivedParams = new URLSearchParams({ limit: '50' });
  for (const [key, value] of filterParams) {
    listParams.set(key, value);
    archivedParams.set(key, value);
  }

  const { data: listData, isLoading: isListLoading } = useQuery({
    queryKey: ['discovered-sessions', listParams.toString()],
    queryFn: () => fetchSessions(listParams),
    enabled: !effectiveQuery && sourceFilter !== 'managed-archived',
  });

  const { data: archivedSessions = [], isLoading: isArchivedLoading } = useQuery({
    queryKey: ['archived-conversations', archivedParams.toString()],
    queryFn: () => fetchArchivedConversations(archivedParams),
    enabled: !effectiveQuery && sourceFilter !== 'discovered',
  });

  const SEARCH_PAGE_SIZE = 50;

  const { data: searchData, isLoading: isSearchLoading } = useQuery({
    queryKey: ['discovered-sessions-search', effectiveQuery, filterParams.toString(), searchOffset, semanticSearch],
    queryFn: () => fetchSearch(effectiveQuery, filterParams, SEARCH_PAGE_SIZE, searchOffset, semanticSearch),
    enabled: !!effectiveQuery,
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

  const { data: workspaceCost } = useQuery({
    queryKey: ['discovered-sessions-cost-workspace', filterParams.toString()],
    queryFn: () => fetchWorkspaceCost(filterParams),
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-stats'] });
    },
  });

  const isLoading = effectiveQuery
    ? isSearchLoading
    : (sourceFilter === 'all' ? isListLoading || isArchivedLoading : sourceFilter === 'managed-archived' ? isArchivedLoading : isListLoading);
  const discoveredSessions = listData?.sessions ?? [];
  const sessions = effectiveQuery
    ? (searchData?.sessions ?? [])
    : sourceFilter === 'managed-archived'
      ? archivedSessions
      : sourceFilter === 'discovered'
        ? discoveredSessions
        : [...discoveredSessions, ...archivedSessions].sort(compareSessionsByLastTs);

  const selected = selectedKey != null ? sessions.find((s) => sessionKey(s) === selectedKey) ?? null : null;
  const workspaceCostEntries = workspaceCost?.entries ?? [];
  const facetOptions = {
    models: countFacetValues(sessions.map((s) => s.primaryModel)),
    workspaces: workspaceCostEntries.length > 0
      ? workspaceCostEntries.map((entry) => ({ value: entry.key, count: entry.sessionCount, cost: entry.totalCost }))
      : countFacetValues(sessions.map((s) => s.workspacePath), sessions.map((s) => s.estimatedCost)),
    tags: countFacetValues(sessions.flatMap((s) => s.tags)),
    tools: countFacetValues(sessions.flatMap((s) => s.toolsUsed)),
    files: countFacetValues(sessions.flatMap((s) => s.filesTouched)),
    timeRanges: countTimeFacets(sessions),
    costRanges: countCostFacets(sessions),
    enrichmentLevels: countFacetValues(sessions.map((s) => String(s.enrichmentLevel))),
  };
  const activeFilterChips = [
    sourceFilter !== 'all' ? { key: 'source', label: `Source: ${sourceFilter === 'discovered' ? 'Discovered' : 'Managed-archived'}` } : null,
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

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSearchOffset(0);
  }, []);

  const handleFilterChange = useCallback((key: string, value: string | boolean | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSearchOffset(0);
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold text-white">Session History</h1>

        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-4 text-xs text-gray-400 ml-2">
            <span><span className="text-white font-mono">{stats.total}</span> indexed</span>
            <span><span className="text-green-400 font-mono">{stats.enriched}</span> enriched</span>
            <span><span className="text-blue-400 font-mono">{stats.managedCount}</span> managed</span>
            <span><span className="text-amber-300 font-mono">${(cost?.totalCost ?? 0).toFixed(4)}</span> est. cost</span>
            {workspaceCostEntries.length > 0 && (
              <span data-testid="workspace-cost-breakdown" className="text-gray-500">
                Workspace costs:{' '}
                {workspaceCostEntries.slice(0, 3).map((entry) => (
                  <span key={entry.key} className="mr-2">
                    <span className="text-gray-300">{entry.key}</span>{' '}
                    <span className="text-amber-300 font-mono">${entry.totalCost.toFixed(4)}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {searchVisible && (
          <>
            {/* Search bar */}
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-500" />
              <input
                type="text"
                placeholder="Search sessions…"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={() => {
                setSemanticSearch((v) => !v);
                setSearchOffset(0);
              }}
              className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                semanticSearch
                  ? 'bg-purple-900 border-purple-600 text-purple-200'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {semanticSearch ? 'Semantic' : 'Keyword'}
            </button>
          </>
        )}

        {/* Filter toggle */}
        <button
          onClick={() => setShowFacets((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors ${
            showFacets
              ? 'bg-blue-900 border-blue-600 text-blue-200'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
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
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0 text-xs">
          <span className="text-gray-500">Active filters</span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => {
              handleFilterChange(chip.key, undefined);
              if (chip.key === 'minCost') handleFilterChange('maxCost', undefined);
              if (chip.key === 'maxCost') handleFilterChange('minCost', undefined);
            }}
              className="px-2 py-1 rounded-full bg-blue-950 text-blue-200 border border-blue-800 hover:bg-blue-900 transition-colors"
            >
              {chip.label} <span className="text-blue-400">×</span>
            </button>
          ))}
          <button
            onClick={() => setFilters({})}
            className="text-gray-500 hover:text-gray-300 transition-colors"
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
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selected ? 'border-r border-gray-800' : ''}`}>
          {searchVisible && searchData?.error && (
            <div className="px-4 py-2 border-b border-amber-900 bg-amber-950/40 text-amber-200 text-xs">
              Semantic search unavailable: {searchData.error}
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 gap-2">
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
                onSelect={setSelectedKey}
              />
              {effectiveQuery && searchData && searchData.total > SEARCH_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 shrink-0 text-xs text-gray-400">
                  <span>
                    {searchOffset + 1}–{searchOffset + sessions.length} of {searchData.total} results
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={searchOffset === 0}
                      onClick={() => setSearchOffset((o) => Math.max(0, o - SEARCH_PAGE_SIZE))}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Prev
                    </button>
                    <button
                      disabled={searchOffset + SEARCH_PAGE_SIZE >= searchData.total}
                      onClick={() => setSearchOffset((o) => o + SEARCH_PAGE_SIZE)}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          <div className="w-96 shrink-0 overflow-auto">
            <SessionDetail
              session={selected}
              onClose={() => setSelectedKey(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
