import { useState, useMemo, useEffect, useRef } from 'react';
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
type ImportanceFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type ConditionFilter = 'all' | 'ok' | 'needs-refinement' | 'stale';

const CONDITION_BADGE_CLASS: Record<string, string> = {
  ok:                  'border border-[color-mix(in_srgb,var(--success)_32%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success-foreground)]',
  'needs-refinement':  'border border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning-foreground)]',
  stale:               'border border-[var(--color-border)] bg-[var(--accent)] text-[var(--muted-foreground)] line-through opacity-70',
};

const GATE_BADGE_CLASS: Record<string, string> = {
  ready:   'border border-[color-mix(in_srgb,var(--success)_32%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success-foreground)]',
  blocked: 'border border-[color-mix(in_srgb,var(--destructive)_32%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-[var(--destructive-foreground)]',
  auto:    'border border-[var(--color-border)] bg-[var(--accent)] text-[var(--muted-foreground)]',
};

const IMPORTANCE_DOT: Record<string, string> = {
  critical: 'bg-[var(--destructive)]',
  high:     'bg-[var(--warning)]',
  medium:   'bg-[var(--color-neutral-400)]',
  low:      'bg-[var(--muted-foreground)] opacity-60',
};

const TIER_LABEL: Record<string, string> = {
  now:     'Now',
  next:    'Next',
  later:   'Later',
  someday: 'Someday',
};
const TIER_CLASS: Record<string, string> = {
  now:     'border border-[color-mix(in_srgb,var(--destructive)_34%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-[var(--destructive-foreground)]',
  next:    'border border-[color-mix(in_srgb,var(--warning)_34%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning-foreground)]',
  later:   'border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_9%,transparent)] text-[var(--info-foreground)]',
  someday: 'border border-[var(--color-border)] bg-[var(--accent)] text-[var(--muted-foreground)]',
};

function scoreTier(rank: number, total: number): string {
  if (rank <= Math.min(14, total)) return 'now';
  if (rank <= Math.min(52, total)) return 'next';
  if (rank <= Math.min(148, total)) return 'later';
  return 'someday';
}

const DAG_NODE_BUDGET = 150;

export function BacklogSequencerPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('dag');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all');
  const [inPipelineOnly, setInPipelineOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [spawnPass, setSpawnPass] = useState<'auto' | 'creation' | 'incremental' | 'review'>('incremental');
  const [showPassPicker, setShowPassPicker] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string | null>('now');
  const [searchQuery, setSearchQuery] = useState('');
  const [hasPrdOnly, setHasPrdOnly] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SequenceNode | null>(null);

  const { data, isLoading, error, refetch } = useQuery<SequenceResponse>({
    queryKey: ['backlog-sequence'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequence');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SequenceResponse>;
    },
    refetchInterval: 60_000,
  });

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

  const tierCounts = useMemo(() => {
    const total = allNodes.length;
    const counts = { now: 0, next: 0, later: 0, someday: 0 };
    allNodes.forEach((n) => {
      const t = scoreTier(n.rank, total) as keyof typeof counts;
      counts[t]++;
    });
    return counts;
  }, [allNodes]);

  const inPipelineCount = useMemo(() => allNodes.filter((n) => n.inPipeline).length, [allNodes]);
  const readyCount = useMemo(() => allNodes.filter((n) => n.state?.ready ?? false).length, [allNodes]);
  const hasPrdCount = useMemo(() => allNodes.filter((n) => n.hasPrd).length, [allNodes]);

  const filteredNodes = useMemo(() => {
    return allNodes.filter((n) => {
      if (tierFilter && scoreTier(n.rank, allNodes.length) !== tierFilter) return false;
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
  }, [allNodes, importanceFilter, conditionFilter, inPipelineOnly, readyOnly, hasPrdOnly, tierFilter, searchQuery]);

  // For DAG view: top-tier + neighbors + in-pipeline when too large
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

  async function handleRunPass() {
    if (spawning) return;
    setSpawning(true);
    setSpawnError(null);
    setShowPassPicker(false);
    try {
      const res = await fetch('/api/backlog/sequence/regenerate', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ pass: spawnPass }),
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

  async function handleGateChange(issueId: string, gate: string) {
    await fetch('/api/backlog/sequence/gate', {
      method: 'POST',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ issueId, gate }),
    });
    queryClient.invalidateQueries({ queryKey: ['backlog-sequence'] });
  }

  async function handlePlanningChange(issueId: string, planning: string) {
    await fetch('/api/backlog/sequence/planning', {
      method: 'POST',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ issueId, planning }),
    });
    queryClient.invalidateQueries({ queryKey: ['backlog-sequence'] });
  }

  const conditionBadge = (condition: string) =>
    CONDITION_BADGE_CLASS[condition] ?? 'bg-gray-700 text-gray-400';
  const gateBadge = (gate: string) =>
    GATE_BADGE_CLASS[gate] ?? 'bg-gray-700 text-gray-400';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Header */}
      <div className="flex items-start gap-4 px-6 py-4 border-b border-[var(--color-border)] shrink-0 flex-wrap bg-[var(--color-bg)]">
        <div className="min-w-[280px] flex-1">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-[var(--color-accent)]" />
            <h1 className="font-display text-[22px] leading-tight font-medium tracking-normal text-[var(--color-fg)]">
              Backlog Sequencer
              {allNodes.length > 0 && (
                <span className="ml-2 font-mono text-sm font-normal text-[var(--color-fg-muted)]">· {allNodes.length} open</span>
              )}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-fg-muted)]">
            Ranked backlog flow with active-tier graphing, dependency context, and operator gates for pickup and planning.
          </p>
        </div>

        {/* View toggle */}
        <div className="flex rounded-md overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'list' ? 'bg-[var(--color-accent)] text-[var(--color-primary-foreground)]' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <ListOrdered className="w-3 h-3" />
            List
          </button>
          <button
            onClick={() => setView('dag')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'dag' ? 'bg-[var(--color-accent)] text-[var(--color-primary-foreground)]' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <GitFork className="w-3 h-3" />
            DAG
          </button>
          <button
            onClick={() => setView('forecast')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'forecast' ? 'bg-[var(--color-accent)] text-[var(--color-primary-foreground)]' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <Play className="w-3 h-3" />
            Forecast
          </button>
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={`px-3 py-1.5 text-xs flex items-center gap-1 rounded-md border ${showFilters ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]' : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
        >
          <Filter className="w-3 h-3" />
          Filters {filteredNodes.length !== allNodes.length && `(${filteredNodes.length})`}
        </button>

        {/* Stale toggle */}
        {staleNodes.length > 0 && (
          <button
            onClick={() => setShowStale((p) => !p)}
            className={`px-3 py-1.5 text-xs rounded-md border ${showStale ? 'border-[var(--warning)] text-[var(--warning-foreground)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]' : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            ⊘ {staleNodes.length} stale
          </button>
        )}

        {/* Run pass button */}
        <div className="relative ml-auto flex items-center gap-1">
          <button
            onClick={handleClearSequence}
            disabled={clearing || spawning || seqRunning}
            className="px-2.5 py-1.5 text-xs flex items-center gap-1 rounded-md border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--destructive)] hover:border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] disabled:opacity-50"
            title="Delete the backlog sequencing (sequence.md + cache). Re-sequence regenerates it."
          >
            <Trash2 className="w-3 h-3" />
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
          <button
            onClick={handleRunPass}
            disabled={spawning || seqRunning}
            className="px-3 py-1.5 text-xs flex items-center gap-1 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] disabled:opacity-50"
            title={`Run ${spawnPass} pass`}
          >
            <Play className="w-3 h-3" />
            {spawning || seqRunning ? 'Sequencing…' : 'Re-sequence'}
          </button>
          <button
            onClick={() => setShowPassPicker((p) => !p)}
            className="px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]"
            title="Select pass type"
          >▾</button>
          {showPassPicker && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg text-xs">
              {(['auto', 'creation', 'incremental', 'review'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setSpawnPass(p); setShowPassPicker(false); }}
                  className={`block w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-hover)] ${spawnPass === p ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg)]'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => refetch()}
          className="p-2 rounded-md hover:bg-[var(--color-surface-hover)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sequencer pass in-progress banner */}
      {seqRunning && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-[color-mix(in_srgb,var(--info)_10%,transparent)] border-b border-[color-mix(in_srgb,var(--info)_28%,transparent)] text-xs">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--info-foreground)]" />
          <span className="text-[var(--info-foreground)] font-medium">Sequencing pass running</span>
          <span className="text-[var(--color-fg)]">
            ranked <b className="font-mono">{seqStatus?.processed ?? 0}</b> / <b className="font-mono">{seqStatus?.total ?? '…'}</b> issues
          </span>
          <span className="text-[var(--color-fg-muted)] tabular-nums">
            · {Math.floor(seqElapsed / 60)}m {String(seqElapsed % 60).padStart(2, '0')}s
          </span>
          <span className="ml-auto text-[var(--color-fg-muted)]">the new sequence appears automatically when it finishes</span>
        </div>
      )}

      {/* Spawn error banner */}
      {spawnError && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-red-900/20 border-b border-red-900/40 text-xs">
          <span className="text-red-400 font-medium">Run pass failed</span>
          <span className="text-red-300 truncate flex-1">{spawnError}</span>
          <button
            onClick={() => setSpawnError(null)}
            className="px-2 py-0.5 rounded bg-red-900/40 text-red-400 hover:bg-red-800/60 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 px-6 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[var(--color-fg-muted)]">Importance:</span>
            {(['all', 'critical', 'high', 'medium', 'low'] as ImportanceFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setImportanceFilter(v)}
                className={`px-2 py-0.5 rounded-md border ${importanceFilter === v ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-primary-foreground)]' : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
              >
                {v === 'all' ? 'All' : v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[var(--color-fg-muted)]">Condition:</span>
            {(['all', 'ok', 'needs-refinement', 'stale'] as ConditionFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setConditionFilter(v)}
                className={`px-2 py-0.5 rounded-md border ${conditionFilter === v ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-primary-foreground)]' : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
              >
                {v === 'all' ? 'All' : v}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={inPipelineOnly} onChange={(e) => setInPipelineOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            <span className="text-[var(--color-fg-muted)]">In pipeline</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            <span className="text-[var(--color-fg-muted)]">Ready only</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={hasPrdOnly} onChange={(e) => setHasPrdOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            <span className="text-[var(--color-fg-muted)]">Has PRD</span>
          </label>
          <div className="ml-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="filter by id / title…"
              className="h-6 px-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)] text-xs placeholder:text-[var(--color-fg-muted)]/50 focus:outline-none focus:border-[var(--color-accent)] min-w-[180px]"
            />
          </div>
        </div>
      )}

      {/* Candidates-to-close summary */}
      {showStale && staleNodes.length > 0 && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
          <div className="text-xs font-medium text-[var(--color-fg-muted)] mb-2">Candidates to close ({staleNodes.length})</div>
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {staleNodes.map((n) => (
              <div key={n.issueId} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[var(--color-accent)] w-24 shrink-0">{n.issueId}</span>
                <span className="text-[var(--color-fg-muted)] truncate flex-1">{n.why}</span>
                <button
                  onClick={() => handleCloseIssue(n.issueId)}
                  className="px-2 py-0.5 rounded text-[10px] bg-red-900/40 text-red-400 hover:bg-red-800/60 shrink-0"
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
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-yellow-900/20 border-b border-yellow-900/40 text-xs">
          <span className="text-yellow-400 font-medium">⚠ {refineNodes.length} need refinement</span>
          <span className="text-yellow-700">{refineNodes.slice(0, 5).map((n) => n.issueId).join(', ')}{refineNodes.length > 5 ? ` +${refineNodes.length - 5}` : ''}</span>
          <button
            onClick={() => handleDraftPrd(refineNodes[0]!.issueId)}
            className="ml-auto px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400 hover:bg-yellow-800/60 shrink-0"
          >
            Draft PRD →
          </button>
        </div>
      )}

      {/* Segment pills */}
      {allNodes.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 py-2.5 border-b border-[var(--color-border)] shrink-0">
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-fg-muted)]">
            <b className="text-[var(--color-fg)] font-medium font-mono">{allNodes.length}</b> open issues
          </span>
          <button
            onClick={() => setInPipelineOnly((p) => !p)}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${inPipelineOnly ? 'border-blue-500/60 bg-blue-900/20 text-blue-400' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-blue-500/40'}`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            In pipeline <b className="font-mono font-medium text-[var(--color-fg)]">{inPipelineCount}</b>
          </button>
          <button
            onClick={() => setReadyOnly((p) => !p)}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${readyOnly ? 'border-emerald-500/60 bg-emerald-900/20 text-emerald-400' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-emerald-500/40'}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            Ready <b className="font-mono font-medium text-[var(--color-fg)]">{readyCount}</b>
          </button>
          <button
            onClick={() => setHasPrdOnly((p) => !p)}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${hasPrdOnly ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-[var(--color-border)]/80'}`}
          >
            <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
            Has PRD <b className="font-mono font-medium text-[var(--color-fg)]">{hasPrdCount}</b>
          </button>
          {refineNodes.length > 0 && (
            <button
              onClick={() => setConditionFilter((p) => (p === 'needs-refinement' ? 'all' : 'needs-refinement'))}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${conditionFilter === 'needs-refinement' ? 'border-yellow-500/60 bg-yellow-900/20 text-yellow-400' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-yellow-500/40'}`}
            >
              <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
              ⚠ Needs refinement <b className="font-mono font-medium text-[var(--color-fg)]">{refineNodes.length}</b>
            </button>
          )}
          {staleNodes.length > 0 && (
            <button
              onClick={() => setConditionFilter((p) => (p === 'stale' ? 'all' : 'stale'))}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${conditionFilter === 'stale' ? 'border-gray-400/60 bg-gray-800 text-gray-300' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-gray-500/40'}`}
            >
              <span className="w-2 h-2 rounded-full bg-gray-500 opacity-50 shrink-0" />
              ⊘ Stale candidates <b className="font-mono font-medium text-[var(--color-fg)]">{staleNodes.length}</b>
            </button>
          )}
          <button
            onClick={() => setTierFilter((p) => (p === 'now' ? null : 'now'))}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${tierFilter === 'now' ? 'border-red-500/60 bg-red-900/20 text-red-400' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-red-500/40'}`}
          >
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            Tier 1 · Now <b className="font-mono font-medium text-[var(--color-fg)]">{tierCounts.now}</b>
          </button>
        </div>
      )}

      {/* Tier ribbon */}
      {allNodes.length > 0 && (
        <div className="flex gap-2 px-6 py-3 border-b border-[var(--color-border)] shrink-0">
          {([
            { key: 'now',     emoji: '🔴', label: 'Now',     count: tierCounts.now,     sub: 'act on these first',  accent: 'border-l-red-500',    ring: 'ring-red-500/50' },
            { key: 'next',    emoji: '🟠', label: 'Next',    count: tierCounts.next,    sub: 'queued behind Now',   accent: 'border-l-orange-500', ring: 'ring-orange-500/50' },
            { key: 'later',   emoji: '🔵', label: 'Later',   count: tierCounts.later,   sub: 'planned horizon',     accent: 'border-l-blue-400',   ring: 'ring-blue-400/50' },
            { key: 'someday', emoji: '⚪', label: 'Someday', count: tierCounts.someday, sub: 'long tail',           accent: 'border-l-gray-600',   ring: 'ring-gray-500/50' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTierFilter((p) => (p === t.key ? null : t.key))}
              className={`flex-1 min-w-[140px] flex flex-col gap-0.5 px-3.5 py-2.5 border border-l-4 ${t.accent} rounded-lg bg-[var(--color-surface)] text-left hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm ${tierFilter === t.key ? `ring-1 ${t.ring} border-[var(--color-border)]` : 'border-[var(--color-border)]'}`}
            >
              <span className="text-xs text-[var(--color-fg)]">{t.emoji} {t.label}</span>
              <span className="font-mono text-lg font-medium text-[var(--color-fg)] leading-tight">{t.count}</span>
              <span className="text-[10px] text-[var(--color-fg-muted)]">{t.sub}</span>
            </button>
          ))}
        </div>
      )}

      {/* Focus note */}
      {tierFilter && allNodes.length > 0 && (
        <div className="flex items-center gap-2 px-5 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 text-xs text-[var(--color-fg-muted)]">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-widest bg-[var(--color-accent)] text-[var(--color-fg)]">
            Showing {TIER_LABEL[tierFilter]}
          </span>
          <span>
            {filteredNodes.length} of {allNodes.length} issues{view === 'dag' ? ' rendered as a graph' : ''} — click the tier again to show all
          </span>
        </div>
      )}

      {/* Content — flex row: main area + optional detail panel */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main area */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-[var(--color-fg-muted)] text-sm">
              Loading sequence…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-32 text-red-400 text-sm">
              {String(error)}
            </div>
          )}
          {!isLoading && !error && allNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-[var(--color-fg-muted)]">
              <ListOrdered className="w-8 h-8 opacity-40" />
              <p className="text-sm">No backlog sequence yet.</p>
              <p className="text-xs">Run a creation pass to rank the open backlog.</p>
              <button
                onClick={() => { setSpawnPass('creation'); void handleRunPass(); }}
                disabled={spawning}
                className="px-3 py-1.5 text-xs rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50 flex items-center gap-1"
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
                <thead className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
                  <tr className="text-[var(--color-fg-muted)]">
                    <th className="text-right px-3 py-2 font-medium w-8">#</th>
                    <th className="text-left px-2 py-2 font-medium w-6">●</th>
                    <th className="text-left px-2 py-2 font-medium w-28">Issue</th>
                    <th className="text-center px-2 py-2 font-medium w-16">Tier</th>
                    <th className="text-left px-2 py-2 font-medium">Why</th>
                    <th className="text-center px-2 py-2 font-medium w-14">Size</th>
                    <th className="text-center px-2 py-2 font-medium w-24">Condition</th>
                    <th className="text-center px-2 py-2 font-medium w-20">Gate</th>
                    <th className="text-center px-2 py-2 font-medium w-14">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.map((node) => {
                    const tier = scoreTier(node.rank, allNodes.length);
                    const isStale = node.condition === 'stale';
                    const isRefine = node.condition === 'needs-refinement';
                    const isSelected = selectedNode?.issueId === node.issueId;
                    return (
                      <tr
                        key={node.issueId}
                        onClick={() => setSelectedNode((p) => (p?.issueId === node.issueId ? null : node))}
                        className={`transition-colors cursor-pointer ${isStale ? 'opacity-50' : ''} ${
                          isSelected
                            ? 'bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] ring-inset ring-1 ring-[var(--color-accent)]'
                            : 'even:bg-[color-mix(in_srgb,var(--color-fg)_3%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-fg)_9%,transparent)]'
                        }`}
                      >
                        <td className="text-right px-3 py-2 text-[var(--color-fg-muted)] tabular-nums">
                          {node.rank}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${IMPORTANCE_DOT[node.importance] ?? 'bg-gray-700'}`} />
                        </td>
                        <td className="px-2 py-2 font-mono text-[var(--color-accent)]">
                          {node.issueId}
                          {node.inPipeline && (
                            <span className="ml-1 text-[9px] text-green-400 align-top">▶</span>
                          )}
                          {isRefine && (
                            <span className="ml-1 text-[9px] text-yellow-400 align-top">⚠</span>
                          )}
                          {node.hasPrd && (
                            <span className="ml-1 text-[9px] text-blue-400 align-top" title="Has PRD">P</span>
                          )}
                          {node.ready && (
                            <span className="ml-1 text-[9px] text-emerald-400 align-top" title="Has spec — ready for work">✓</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_CLASS[tier] ?? 'border border-[var(--color-border)] bg-[var(--accent)] text-[var(--muted-foreground)]'}`}>
                            {TIER_LABEL[tier]}
                          </span>
                        </td>
                        <td className={`px-2 py-2 text-[var(--color-fg)] max-w-xs truncate ${isStale ? 'line-through' : ''}`}>
                          {node.why}
                        </td>
                        <td className="px-2 py-2 text-center text-[var(--color-fg-muted)]">
                          {node.size}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${conditionBadge(node.condition)}`}>
                            {node.condition === 'needs-refinement' ? '⚠ refine' : node.condition === 'stale' ? '⊘ stale' : node.condition}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${gateBadge(node.gate)}`}>
                            {node.gate === 'ready' ? (node.inPipeline ? 'auto' : '📌') : node.gate === 'blocked' ? '⛔' : node.gate}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center text-[var(--color-fg-muted)] tabular-nums">
                          {node.score}
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
                <div className="shrink-0 text-xs text-center py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-[var(--color-fg-muted)]">
                  Showing {dagData.nodes.length} of {filteredNodes.length} issues (top tier + neighbors); {collapsedCount} collapsed
                </div>
              )}
              <div className="flex-1 min-h-0">
                <BacklogDAG
                  data={dagData}
                  className="w-full h-full"
                  selectedNodeId={selectedNode?.issueId}
                  onSelectNode={(n) => setSelectedNode(n)}
                  onGateChange={handleGateChange}
                  onPlanningChange={handlePlanningChange}
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
            onGateChange={handleGateChange}
            onPlanningChange={handlePlanningChange}
          />
        )}
      </div>
    </div>
  );
}

export default BacklogSequencerPage;
