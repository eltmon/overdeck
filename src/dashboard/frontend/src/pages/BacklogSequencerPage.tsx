import { useState, useMemo, useEffect, useRef } from 'react';
import type { OrderBook } from '@overdeck/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, GitFork, RefreshCw, Filter, Play, Trash2 } from 'lucide-react';
import { BacklogDAG, RationaleSidePanel, type SequenceNode } from '../components/backlog/BacklogDAG';
import { BacklogForecast } from '../components/backlog/BacklogForecast';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

interface SequenceEdge {
  from: string;
  to: string;
  type: string;
}

interface SequenceResponse {
  nodes: SequenceNode[];
  edges: SequenceEdge[];
}

type View = 'list' | 'dag' | 'forecast';
type SpawnPass = 'creation' | 'incremental' | 'review';
type ImportanceFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type ConditionFilter = 'all' | 'ok' | 'needs-refinement' | 'stale';

interface BacklogSequencerPageProps {
  onIssueAction?: (issueId: string, mode: 'browser' | 'modal' | 'panel') => void;
}

const CONDITION_BADGE_CLASS: Record<string, string> = {
  ok:                  'border border-success/32 bg-success/8 text-success-foreground',
  'needs-refinement':  'border border-warning/32 bg-warning/8 text-warning-foreground',
  stale:               'border border-border bg-[var(--accent)] text-[var(--muted-foreground)] line-through opacity-70',
};

const GATE_BADGE_CLASS: Record<string, string> = {
  ready:   'border border-success/32 bg-success/8 text-success-foreground',
  blocked: 'border border-destructive/32 bg-destructive/8 text-destructive-foreground',
  auto:    'border border-border bg-[var(--accent)] text-[var(--muted-foreground)]',
};

const IMPORTANCE_DOT: Record<string, string> = {
  critical: 'bg-[var(--destructive)]',
  high:     'bg-[var(--warning)]',
  medium:   'bg-muted-foreground/80',
  low:      'bg-[var(--muted-foreground)] opacity-60',
};

// Filter chips use the shared semantic badge formula. They are controls, not
// status pills, so they keep the dashboard's compact rounded rectangle.
const CHIP_BASE = 'inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors';
const CHIP_OFF = 'border-border bg-card text-muted-foreground hover:border-foreground/25';
const CHIP_ON = {
  info:    'border-info/32 bg-info/8 text-info-foreground',
  success: 'border-success/32 bg-success/8 text-success-foreground',
  warning: 'border-warning/32 bg-warning/8 text-warning-foreground',
  danger:  'border-destructive/32 bg-destructive/8 text-destructive-foreground',
  neutral: 'border-foreground/25 bg-foreground/8 text-foreground',
};
const CHIP_DOT = {
  info:    'bg-[var(--info-foreground)]',
  success: 'bg-[var(--success-foreground)]',
  warning: 'bg-[var(--warning-foreground)]',
  danger:  'bg-[var(--destructive-foreground)]',
  neutral: 'bg-muted-foreground',
};

const DAG_NODE_BUDGET = 150;

export function BacklogSequencerPage({ onIssueAction }: BacklogSequencerPageProps = {}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all');
  const [inPipelineOnly, setInPipelineOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [spawningPass, setSpawningPass] = useState<SpawnPass | null>(null);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasPrdOnly, setHasPrdOnly] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SequenceNode | null>(null);
  const [promotionIssueId, setPromotionIssueId] = useState<string | null>(null);
  const [promotingIssueId, setPromotingIssueId] = useState<string | null>(null);
  const [promotedIssues, setPromotedIssues] = useState<Set<string>>(() => new Set());
  const [promotionError, setPromotionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<SequenceResponse>({
    queryKey: ['backlog-sequence'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequence');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SequenceResponse>;
    },
    refetchInterval: 60_000,
  });
  const { data: orderBooks = [] } = useQuery<OrderBook[]>({
    queryKey: ['order-books'],
    queryFn: async () => {
      const response = await fetch('/api/orders');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { books?: OrderBook[] };
      return payload.books ?? [];
    },
    staleTime: 15_000,
  });
  const activeOrderBooks = useMemo(() => orderBooks.filter((book) => book.status !== 'complete'), [orderBooks]);
  const promotionTarget = useMemo(
    () => activeOrderBooks.find((book) => book.status === 'running')
      ?? activeOrderBooks.find((book) => book.status === 'ready')
      ?? activeOrderBooks[0]
      ?? null,
    [activeOrderBooks],
  );
  const bookByIssue = useMemo(() => {
    const result = new Map<string, OrderBook>();
    for (const book of activeOrderBooks) {
      for (const item of book.items) result.set(item.issue.toUpperCase(), book);
    }
    return result;
  }, [activeOrderBooks]);

  // Live sequencer-pass progress (PAN-2005). Polls every 3s; the sequence query is
  // refetched when a pass finishes so the new ranking appears without a manual refresh.
  const { data: seqStatus } = useQuery<{ running: boolean; total: number; processed: number; startedAt: string | null }>({
    queryKey: ['sequencer-status'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequencer-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 3000,
  });
  const seqRunning = seqStatus?.running ?? false;
  const prevSeqRunning = useRef(false);
  useEffect(() => {
    if (prevSeqRunning.current && !seqRunning) refetch();
    prevSeqRunning.current = seqRunning;
  }, [seqRunning, refetch]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!seqRunning) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [seqRunning]);
  const seqElapsed = seqStatus?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(seqStatus.startedAt).getTime()) / 1000)) : 0;

  const allNodes = data?.nodes ?? [];
  const staleNodes = useMemo(() => allNodes.filter((n) => n.condition === 'stale'), [allNodes]);
  const refineNodes = useMemo(() => allNodes.filter((n) => n.condition === 'needs-refinement'), [allNodes]);

  const inPipelineCount = useMemo(() => allNodes.filter((n) => n.inPipeline).length, [allNodes]);
  const readyCount = useMemo(() => allNodes.filter((n) => n.state?.ready ?? false).length, [allNodes]);
  const hasPrdCount = useMemo(() => allNodes.filter((n) => n.hasPrd).length, [allNodes]);

  const filteredNodes = useMemo(() => {
    return allNodes.filter((n) => {
      if (importanceFilter !== 'all' && n.importance !== importanceFilter) return false;
      if (conditionFilter !== 'all' && n.condition !== conditionFilter) return false;
      if (inPipelineOnly && !n.inPipeline) return false;
      // PAN-2006: "Ready" = the Definition-of-Ready state (ready label), not the
      // promote gate. (The old check compared gate==='ready', so it filtered nothing.)
      if (readyOnly && !(n.state?.ready ?? false)) return false;
      if (hasPrdOnly && !n.hasPrd) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!n.issueId.toLowerCase().includes(q) && !n.why.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allNodes, importanceFilter, conditionFilter, inPipelineOnly, readyOnly, hasPrdOnly, searchQuery]);

  // For DAG view: top 10% by rank + neighbors + in-pipeline when too large
  const dagData = useMemo((): SequenceResponse => {
    if (!data) return { nodes: [], edges: [] };
    const total = filteredNodes.length;
    if (total <= DAG_NODE_BUDGET) {
      const visible = new Set(filteredNodes.map((n) => n.issueId));
      return {
        nodes: filteredNodes,
        edges: data.edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
      };
    }
    // Top 10% + in-pipeline + neighbors via dependsOn
    const topN = Math.max(Math.floor(total * 0.1), 20);
    const topSet = new Set(filteredNodes.slice(0, topN).map((n) => n.issueId));
    filteredNodes.filter((n) => n.inPipeline).forEach((n) => topSet.add(n.issueId));
    // Add dependency neighbors
    const withNeighbors = new Set(topSet);
    for (const edge of data.edges) {
      if (topSet.has(edge.from)) withNeighbors.add(edge.to);
      if (topSet.has(edge.to)) withNeighbors.add(edge.from);
    }
    const dagNodes = filteredNodes.filter((n) => withNeighbors.has(n.issueId));
    const dagEdges = data.edges.filter(
      (e) => withNeighbors.has(e.from) && withNeighbors.has(e.to),
    );
    return { nodes: dagNodes, edges: dagEdges };
  }, [data, filteredNodes]);

  const collapsedCount = filteredNodes.length - dagData.nodes.length;

  async function handleRunPass(pass: SpawnPass) {
    if (spawning) return;
    setSpawning(true);
    setSpawningPass(pass);
    setSpawnError(null);
    try {
      const res = await fetch('/api/backlog/sequence/regenerate', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ pass }),
      });
      if (!res.ok) {
        // Prefer the structured { error } message the backend returns (e.g. the
        // 409 "a sequencer pass is already running" guidance) over a raw status dump.
        let message = `Request failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = String(body.error);
        } catch {
          const text = await res.text().catch(() => '');
          if (text) message = text.slice(0, 300);
        }
        throw new Error(message);
      }
      setTimeout(() => refetch(), 2000);
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpawning(false);
      setSpawningPass(null);
    }
  }

  async function handleClearSequence() {
    if (clearing || spawning) return;
    if (!window.confirm('Delete the backlog sequencing? This removes the ranked sequence (sequence.md + cache) and any operator gate overrides. A re-sequence pass regenerates it.')) return;
    setClearing(true);
    setSpawnError(null);
    try {
      const res = await fetch('/api/backlog/sequence/clear', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
      });
      if (!res.ok) {
        let message = `Request failed (HTTP ${res.status})`;
        try { const body = await res.json(); if (body?.error) message = String(body.error); } catch { /* ignore */ }
        throw new Error(message);
      }
      setTimeout(() => refetch(), 500);
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  async function handleDraftPrd(issueId: string) {
    await fetch(`/api/issues/${issueId}/start-planning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  async function handleCloseIssue(issueId: string) {
    const res = await fetch(`/api/issues/${issueId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (res?.ok) {
      queryClient.invalidateQueries({ queryKey: ['backlog-sequence'] });
    }
  }

  async function handlePromoteToOrderBook(issueId: string, lane: 'A' | 'B') {
    if (!promotionTarget || promotingIssueId) return;
    setPromotingIssueId(issueId);
    setPromotionError(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(promotionTarget.id)}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ item: { issue: issueId, lane } }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed (HTTP ${response.status})`);
      }
      setPromotedIssues((current) => new Set(current).add(issueId.toUpperCase()));
      setPromotionIssueId(null);
      await queryClient.invalidateQueries({ queryKey: ['order-books'] });
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPromotingIssueId(null);
    }
  }


  const conditionBadge = (condition: string) =>
    CONDITION_BADGE_CLASS[condition] ?? 'border border-border bg-[var(--accent)] text-[var(--muted-foreground)]';
  const gateBadge = (gate: string) =>
    GATE_BADGE_CLASS[gate] ?? 'border border-border bg-[var(--accent)] text-[var(--muted-foreground)]';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="flex items-start gap-4 px-6 py-4 border-b border-border shrink-0 flex-wrap bg-background">
        <div className="min-w-[280px] flex-1">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-primary" />
            <h1 className="font-display text-[22px] leading-tight font-medium tracking-normal text-foreground">
              Backlog Sequencer
              {allNodes.length > 0 && (
                <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">· {allNodes.length} open</span>
              )}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            Ordered backlog: the sequencer's pickup order with dependency context and operator gates for pickup and planning.
          </p>
        </div>

        {/* View toggle */}
        <div className="flex rounded-md overflow-hidden border border-border bg-card">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            <ListOrdered className="w-3 h-3" />
            List
          </button>
          <button
            onClick={() => setView('dag')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'dag' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            <GitFork className="w-3 h-3" />
            DAG
          </button>
          <button
            onClick={() => setView('forecast')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'forecast' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            <Play className="w-3 h-3" />
            Forecast
          </button>
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={`px-3 py-1.5 text-xs flex items-center gap-1 rounded-md border ${showFilters ? 'border-primary/32 bg-primary/8 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
        >
          <Filter className="w-3 h-3" />
          Filters {filteredNodes.length !== allNodes.length && `(${filteredNodes.length})`}
        </button>

        {/* Stale toggle */}
        {staleNodes.length > 0 && (
          <button
            onClick={() => setShowStale((p) => !p)}
            className={`px-3 py-1.5 text-xs rounded-md border ${showStale ? 'border-warning/32 bg-warning/8 text-warning-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
          >
            ⊘ {staleNodes.length} stale
          </button>
        )}

        {/* Run pass button */}
        <div className="relative ml-auto flex items-center gap-1">
          <button
            onClick={handleClearSequence}
            disabled={clearing || spawning || seqRunning}
            className="px-2.5 py-1.5 text-xs flex items-center gap-1 rounded-md border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            title="Delete the backlog sequencing (sequence.md + cache). A creation pass then rebuilds it from scratch."
          >
            <Trash2 className="w-3 h-3" />
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
          <button
            onClick={() => handleRunPass('incremental')}
            disabled={spawning || seqRunning}
            className="px-3 py-1.5 text-xs flex items-center gap-1 rounded-md border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
            title="Incremental pass: re-reads only issues changed since the last pass and slots them in. Existing ranks are preserved."
          >
            <Play className="w-3 h-3" />
            {spawningPass === 'incremental' ? 'Updating…' : seqRunning ? 'Sequencing…' : 'Update changed'}
          </button>
          <button
            onClick={() => handleRunPass('review')}
            disabled={spawning || seqRunning}
            className="px-3 py-1.5 text-xs flex items-center gap-1 rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="Review pass: re-ranks the whole open backlog. Slower and costlier; use when priorities have shifted, not just when issues changed."
          >
            <RefreshCw className="w-3 h-3" />
            {spawningPass === 'review' ? 'Re-ranking…' : 'Re-rank all'}
          </button>
        </div>

        <button
          onClick={() => refetch()}
          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sequencer pass in-progress banner */}
      {seqRunning && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-info/8 border-b border-info/32 text-xs">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--info-foreground)]" />
          <span className="text-[var(--info-foreground)] font-medium">Sequencing pass running</span>
          <span className="text-foreground">
            ranked <b className="font-mono">{seqStatus?.processed ?? 0}</b> / <b className="font-mono">{seqStatus?.total ?? '…'}</b> issues
          </span>
          <span className="text-muted-foreground tabular-nums">
            · {Math.floor(seqElapsed / 60)}m {String(seqElapsed % 60).padStart(2, '0')}s
          </span>
          <span className="ml-auto text-muted-foreground">the new sequence appears automatically when it finishes</span>
        </div>
      )}

      {/* Spawn error banner */}
      {spawnError && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-destructive/8 border-b border-destructive/32 text-xs">
          <span className="text-[var(--destructive-foreground)] font-medium">Run pass failed</span>
          <span className="text-muted-foreground truncate flex-1">{spawnError}</span>
          <button
            onClick={() => setSpawnError(null)}
            className="px-2 py-0.5 rounded border border-destructive/32 bg-destructive/16 text-destructive-foreground hover:bg-destructive/24 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 px-6 py-3 bg-card border-b border-border text-xs shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Importance:</span>
            {(['all', 'critical', 'high', 'medium', 'low'] as ImportanceFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setImportanceFilter(v)}
                className={`px-2 py-0.5 rounded-md border ${importanceFilter === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent'}`}
              >
                {v === 'all' ? 'All' : v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Condition:</span>
            {(['all', 'ok', 'needs-refinement', 'stale'] as ConditionFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setConditionFilter(v)}
                className={`px-2 py-0.5 rounded-md border ${conditionFilter === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent'}`}
              >
                {v === 'all' ? 'All' : v}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={inPipelineOnly} onChange={(e) => setInPipelineOnly(e.target.checked)} className="accent-primary" />
            <span className="text-muted-foreground">In pipeline</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} className="accent-primary" />
            <span className="text-muted-foreground">Ready only</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={hasPrdOnly} onChange={(e) => setHasPrdOnly(e.target.checked)} className="accent-primary" />
            <span className="text-muted-foreground">Has PRD</span>
          </label>
          <div className="ml-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="filter by id / title…"
              className="h-6 px-2 rounded border border-border bg-background text-muted-foreground text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary min-w-[180px]"
            />
          </div>
        </div>
      )}

      {/* Candidates-to-close summary */}
      {showStale && staleNodes.length > 0 && (
        <div className="shrink-0 border-b border-border bg-card px-5 py-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Candidates to close ({staleNodes.length})</div>
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {staleNodes.map((n) => (
              <div key={n.issueId} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-primary w-24 shrink-0">{n.issueId}</span>
                <span className="text-muted-foreground truncate flex-1">{n.why}</span>
                <button
                  onClick={() => handleCloseIssue(n.issueId)}
                  className="shrink-0 rounded border border-destructive/32 bg-destructive/8 px-2 py-0.5 text-[10px] text-destructive-foreground hover:bg-destructive/16"
                >
                  Close
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs-refinement banner */}
      {refineNodes.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-warning/8 border-b border-warning/32 text-xs">
          <span className="text-warning-foreground font-medium">⚠ {refineNodes.length} need refinement</span>
          <span className="text-muted-foreground">{refineNodes.slice(0, 5).map((n) => n.issueId).join(', ')}{refineNodes.length > 5 ? ` +${refineNodes.length - 5}` : ''}</span>
          <button
            onClick={() => handleDraftPrd(refineNodes[0]!.issueId)}
            className="ml-auto shrink-0 rounded border border-warning/32 bg-warning/8 px-2 py-0.5 text-warning-foreground hover:bg-warning/16"
          >
            Draft PRD →
          </button>
        </div>
      )}

      {/* Segment filters */}
      {allNodes.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 py-2.5 border-b border-border shrink-0">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground">
            <b className="text-foreground font-medium font-mono">{allNodes.length}</b> open issues
          </span>
          <button
            onClick={() => setInPipelineOnly((p) => !p)}
            className={`${CHIP_BASE} ${inPipelineOnly ? CHIP_ON.info : CHIP_OFF}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_DOT.info}`} />
            In pipeline <b className="font-mono font-medium text-foreground">{inPipelineCount}</b>
          </button>
          <button
            onClick={() => setReadyOnly((p) => !p)}
            className={`${CHIP_BASE} ${readyOnly ? CHIP_ON.success : CHIP_OFF}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_DOT.success}`} />
            Ready <b className="font-mono font-medium text-foreground">{readyCount}</b>
          </button>
          <button
            onClick={() => setHasPrdOnly((p) => !p)}
            className={`${CHIP_BASE} ${hasPrdOnly ? CHIP_ON.neutral : CHIP_OFF}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_DOT.neutral}`} />
            Has PRD <b className="font-mono font-medium text-foreground">{hasPrdCount}</b>
          </button>
          {refineNodes.length > 0 && (
            <button
              onClick={() => setConditionFilter((p) => (p === 'needs-refinement' ? 'all' : 'needs-refinement'))}
              className={`${CHIP_BASE} ${conditionFilter === 'needs-refinement' ? CHIP_ON.warning : CHIP_OFF}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_DOT.warning}`} />
              ⚠ Needs refinement <b className="font-mono font-medium text-foreground">{refineNodes.length}</b>
            </button>
          )}
          {staleNodes.length > 0 && (
            <button
              onClick={() => setConditionFilter((p) => (p === 'stale' ? 'all' : 'stale'))}
              className={`${CHIP_BASE} ${conditionFilter === 'stale' ? CHIP_ON.neutral : CHIP_OFF}`}
            >
              <span className={`w-2 h-2 rounded-full opacity-60 shrink-0 ${CHIP_DOT.neutral}`} />
              ⊘ Stale candidates <b className="font-mono font-medium text-foreground">{staleNodes.length}</b>
            </button>
          )}
        </div>
      )}

      {/* Content — flex row: main area + optional detail panel */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main area */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading sequence…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-32 text-destructive-foreground text-sm">
              {String(error)}
            </div>
          )}
          {!isLoading && !error && allNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <ListOrdered className="w-8 h-8 opacity-40" />
              <p className="text-sm">No backlog sequence yet.</p>
              <p className="text-xs">Run a creation pass to rank the open backlog.</p>
              <button
                onClick={() => void handleRunPass('creation')}
                disabled={spawning}
                className="px-3 py-1.5 text-xs rounded border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1"
              >
                <Play className="w-3 h-3" />
                {spawning ? 'Spawning…' : 'Run creation pass'}
              </button>
            </div>
          )}

          {/* List view */}
          {!isLoading && !error && allNodes.length > 0 && view === 'list' && (
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr className="text-muted-foreground">
                    <th className="text-right px-3 py-2 font-medium w-8 cursor-help" title="Pickup rank — lower means the Flywheel works it sooner">#</th>
                    <th className="text-left px-2 py-2 font-medium w-6 cursor-help" title="Importance — red = critical, orange = high, gray = medium, dim = low">●</th>
                    <th className="text-left px-2 py-2 font-medium w-28 cursor-help" title="Issue ID. Markers: ▶ in pipeline · ⚠ needs refinement · P has PRD · ✓ planned (spec + tasks)">Issue</th>
                    <th className="text-left px-2 py-2 font-medium cursor-help" title="One-line rationale for this ranking (from the sequencer)">Why</th>
                    <th className="text-center px-2 py-2 font-medium w-14 cursor-help" title="Estimated effort: XS / S / M / L / XL">Size</th>
                    <th className="text-center px-2 py-2 font-medium w-24 cursor-help" title="AI condition: ok · needs-refinement (vague spec) · stale (likely close)">Condition</th>
                    <th className="text-center px-2 py-2 font-medium w-20 cursor-help" title="Operator pickup gate: auto (normal) · promote (jump queue) · vetoed (never pick)">Gate</th>
                    <th className="text-center px-2 py-2 font-medium w-14 cursor-help" title="Impact score (0–100) the sequencer assigned">Score</th>
                    <th className="px-2 py-2 font-medium w-28"><span className="sr-only">Order book</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.map((node) => {
                    const isStale = node.condition === 'stale';
                    const isRefine = node.condition === 'needs-refinement';
                    const isSelected = selectedNode?.issueId === node.issueId;
                    return (
                      <tr
                        key={node.issueId}
                        onClick={() => setSelectedNode((p) => (p?.issueId === node.issueId ? null : node))}
                        className={`group transition-colors cursor-pointer ${isStale ? 'opacity-50' : ''} ${
                          isSelected
                            ? 'bg-primary/15 ring-inset ring-1 ring-primary'
                            : 'even:bg-muted/20 hover:bg-accent/60'
                        }`}
                      >
                        <td className={`text-right px-3 py-2 text-muted-foreground tabular-nums border-l-2 ${node.inPipeline ? 'border-l-[var(--info)]' : 'border-l-transparent'}`}>
                          {node.rank}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${IMPORTANCE_DOT[node.importance] ?? 'bg-muted-foreground'}`}
                            title={`Importance: ${node.importance}`}
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-primary">
                          {node.issueId}
                          {node.inPipeline && (
                            <span className="ml-1 text-[9px] text-[var(--info-foreground)] align-top" title="In pipeline — active work / review / test">▶</span>
                          )}
                          {isRefine && (
                            <span className="ml-1 text-[9px] text-[var(--warning-foreground)] align-top" title="Needs refinement — vague/underspecified">⚠</span>
                          )}
                          {node.hasPrd && (
                            <span className="ml-1 text-[9px] text-[var(--info-foreground)] align-top" title="Has PRD">P</span>
                          )}
                          {node.ready && (
                            <span className="ml-1 text-[9px] text-[var(--success-foreground)] align-top" title="Has spec — ready for work">✓</span>
                          )}
                        </td>
                        <td className={`px-2 py-2 text-foreground max-w-xs truncate ${isStale ? 'line-through' : ''}`}>
                          {node.why}
                        </td>
                        <td className="px-2 py-2 text-center text-muted-foreground">
                          {node.size}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${conditionBadge(node.condition)}`}
                            title={node.condition === 'needs-refinement' ? 'Needs refinement — vague/underspecified' : node.condition === 'stale' ? 'Stale — likely a candidate to close' : 'OK — well-specified'}
                          >
                            {node.condition === 'needs-refinement' ? '⚠ refine' : node.condition === 'stale' ? '⊘ stale' : node.condition}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${gateBadge(node.gate)}`}
                            title={node.gate === 'ready' ? (node.inPipeline ? 'Auto (in-pipeline pin)' : 'Promoted — jumps the queue') : node.gate === 'blocked' ? 'Vetoed — never auto-picked' : 'Auto — normal eligibility'}
                          >
                            {node.gate === 'ready' ? (node.inPipeline ? 'auto' : '📌') : node.gate === 'blocked' ? '⛔' : node.gate}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center text-muted-foreground tabular-nums">
                          {node.score}
                        </td>
                        <td className="relative px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                          {bookByIssue.has(node.issueId.toUpperCase()) || promotedIssues.has(node.issueId.toUpperCase()) ? (
                            <a href="/orders" className="text-[10px] text-primary opacity-0 hover:underline group-hover:opacity-100 focus:opacity-100">Open order book</a>
                          ) : (
                            <button
                              type="button"
                              disabled={!promotionTarget}
                              onClick={() => { setPromotionError(null); setPromotionIssueId((current) => current === node.issueId ? null : node.issueId); }}
                              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:border-primary hover:text-primary focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
                              title={promotionTarget ? `Add to ${promotionTarget.name}` : 'Create an order book first'}
                            >
                              + Order book
                            </button>
                          )}
                          {promotionIssueId === node.issueId && promotionTarget && (
                            <div className="absolute right-2 top-full z-30 w-52 rounded-md border border-border bg-card p-2 text-left shadow-lg" role="dialog" aria-label={`Choose lane for ${node.issueId}`}>
                              <p className="truncate text-[10px] text-muted-foreground">Add to {promotionTarget.name}</p>
                              <div className="mt-2 flex gap-2">
                                {(['A', 'B'] as const).map((lane) => (
                                  <button key={lane} type="button" disabled={promotingIssueId === node.issueId} onClick={() => { void handlePromoteToOrderBook(node.issueId, lane); }} className="flex-1 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:border-primary disabled:opacity-50">
                                    Lane {lane}
                                  </button>
                                ))}
                              </div>
                              <a href="/orders" className="mt-2 block text-[10px] text-primary hover:underline">Open Order Book</a>
                              {promotionError && <p className="mt-2 text-[10px] text-[var(--destructive)]" role="alert">{promotionError}</p>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* DAG view */}
          {!isLoading && !error && allNodes.length > 0 && view === 'dag' && data && (
            <div className="flex-1 flex flex-col min-h-0">
              {collapsedCount > 0 && (
                <div className="shrink-0 text-xs text-center py-1 bg-card border-b border-border text-muted-foreground">
                  Showing {dagData.nodes.length} of {filteredNodes.length} issues (top 10% by rank + neighbors); {collapsedCount} collapsed
                </div>
              )}
              <div className="flex-1 min-h-0">
                <BacklogDAG
                  data={dagData}
                  className="w-full h-full"
                  selectedNodeId={selectedNode?.issueId}
                  onSelectNode={(n) => setSelectedNode(n)}
                  onIssueAction={onIssueAction}
                />
              </div>
            </div>
          )}

          {!isLoading && !error && allNodes.length > 0 && view === 'forecast' && (
            <div className="flex-1 min-h-0">
              <BacklogForecast
                className="w-full h-full"
                onSelectIssue={(id) => setSelectedNode(allNodes.find((nn) => nn.issueId === id) ?? null)}
              />
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <RationaleSidePanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onIssueAction={onIssueAction}
          />
        )}
      </div>
    </div>
  );
}

export default BacklogSequencerPage;
