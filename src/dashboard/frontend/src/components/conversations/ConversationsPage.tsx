/**
 * Conversations page — Session Discovery & Search (PAN-457)
 *
 * Shows indexed Claude Code sessions with search, filters, and enrichment controls.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Filter } from 'lucide-react';
import { SessionTable } from './SessionTable';
import { SessionDetail } from './SessionDetail';
import { ScanButton } from './ScanButton';
import { FacetPanel } from './FacetPanel';

// ─── API helpers ──────────────────────────────────────────────────────────────

interface DiscoveredSession {
  id: number;
  jsonlPath: string;
  workspacePath: string | null;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
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
}

interface StatsResponse {
  total: number;
  enriched: number;
  embedded: number;
  managedCount: number;
}

interface SearchResponse {
  sessions: DiscoveredSession[];
  total: number;
  mode: string;
}

interface ScanResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

function buildFilterParams(filters: {
  workspace?: string;
  since?: string;
  managed?: boolean;
  enriched?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.workspace) params.set('workspace', filters.workspace);
  if (filters.since) params.set('since', filters.since);
  if (filters.managed) params.set('managed', 'true');
  if (filters.enriched) params.set('enriched', 'true');
  return params;
}

async function fetchSessions(params: URLSearchParams): Promise<ListResponse> {
  const resp = await fetch(`/api/discovered-sessions?${params}`);
  if (!resp.ok) throw new Error('Failed to fetch sessions');
  return resp.json() as Promise<ListResponse>;
}

async function fetchSearch(
  q: string,
  filterParams: URLSearchParams,
  limit = 50,
  offset = 0,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  for (const [key, value] of filterParams) {
    params.set(key, value);
  }
  const resp = await fetch(`/api/discovered-sessions/search?${params}`);
  if (!resp.ok) throw new Error('Search failed');
  return resp.json() as Promise<SearchResponse>;
}

async function fetchStats(): Promise<StatsResponse> {
  const resp = await fetch('/api/discovered-sessions/stats');
  if (!resp.ok) throw new Error('Failed to fetch stats');
  return resp.json() as Promise<StatsResponse>;
}

async function triggerScan(): Promise<ScanResult> {
  const resp = await fetch('/api/discovered-sessions/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'system' }),
  });
  if (!resp.ok) throw new Error('Scan failed');
  return resp.json() as Promise<ScanResult>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showFacets, setShowFacets] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [filters, setFilters] = useState<{
    workspace?: string;
    since?: string;
    managed?: boolean;
    enriched?: boolean;
  }>({});

  const trimmedQuery = query.trim();
  const filterParams = buildFilterParams(filters);

  const listParams = new URLSearchParams({ limit: '50' });
  for (const [key, value] of filterParams) {
    listParams.set(key, value);
  }

  const { data: listData, isLoading: isListLoading } = useQuery({
    queryKey: ['discovered-sessions', listParams.toString()],
    queryFn: () => fetchSessions(listParams),
    enabled: !trimmedQuery,
  });

  const SEARCH_PAGE_SIZE = 50;

  const { data: searchData, isLoading: isSearchLoading } = useQuery({
    queryKey: ['discovered-sessions-search', trimmedQuery, filterParams.toString(), searchOffset],
    queryFn: () => fetchSearch(trimmedQuery, filterParams, SEARCH_PAGE_SIZE, searchOffset),
    enabled: !!trimmedQuery,
  });

  const { data: stats } = useQuery({
    queryKey: ['discovered-sessions-stats'],
    queryFn: fetchStats,
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['discovered-sessions-stats'] });
    },
  });

  const isLoading = trimmedQuery ? isSearchLoading : isListLoading;
  const sessions = trimmedQuery
    ? (searchData?.sessions ?? [])
    : (listData?.sessions ?? []);

  const selected = selectedId != null ? sessions.find((s) => s.id === selectedId) ?? null : null;

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
          </div>
        )}

        <div className="flex-1" />

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
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Facet panel */}
        {showFacets && (
          <FacetPanel filters={filters} onChange={handleFilterChange} />
        )}

        {/* Session list */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selected ? 'border-r border-gray-800' : ''}`}>
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
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {trimmedQuery && searchData && searchData.total > SEARCH_PAGE_SIZE && (
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
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
