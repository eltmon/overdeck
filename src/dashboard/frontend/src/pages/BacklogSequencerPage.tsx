import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, GitFork, RefreshCw, Filter, Play } from 'lucide-react';
import { BacklogDAG } from '../components/backlog/BacklogDAG';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

interface SequenceNode {
  issueId: string;
  rank: number;
  size: string;
  importance: string;
  score: number;
  condition: string;
  dependsOn: string[];
  why: string;
  rationale?: string;
  gate: string;
  planning: string;
  inPipeline: boolean;
  hasPrd: boolean;
  ready: boolean;
}

interface SequenceEdge {
  from: string;
  to: string;
  type: string;
}

interface SequenceResponse {
  nodes: SequenceNode[];
  edges: SequenceEdge[];
}

type View = 'list' | 'dag';
type ImportanceFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type ConditionFilter = 'all' | 'ok' | 'needs-refinement' | 'stale';

const CONDITION_BADGE_CLASS: Record<string, string> = {
  ok:                'bg-green-900/40 text-green-400',
  'needs-refinement': 'bg-yellow-900/40 text-yellow-400',
  stale:             'bg-gray-700 text-gray-400 line-through opacity-60',
};

const GATE_BADGE_CLASS: Record<string, string> = {
  ready:   'bg-green-900/40 text-green-400',
  blocked: 'bg-red-900/40 text-red-400',
  auto:    'bg-gray-700 text-gray-400',
};

const IMPORTANCE_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-gray-500',
  low:      'bg-gray-700',
};

const TIER_LABEL: Record<string, string> = {
  now:     'Now',
  next:    'Next',
  later:   'Later',
  someday: 'Someday',
};
const TIER_CLASS: Record<string, string> = {
  now:     'bg-blue-900/40 text-blue-400',
  next:    'bg-purple-900/40 text-purple-400',
  later:   'bg-gray-700 text-gray-400',
  someday: 'bg-gray-800 text-gray-500',
};

function scoreTier(rank: number, total: number): string {
  const pct = rank / Math.max(total, 1);
  if (pct <= 0.1) return 'now';
  if (pct <= 0.3) return 'next';
  if (pct <= 0.6) return 'later';
  return 'someday';
}

const DAG_NODE_BUDGET = 150;

export function BacklogSequencerPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all');
  const [inPipelineOnly, setInPipelineOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [spawnPass, setSpawnPass] = useState<'auto' | 'creation' | 'incremental' | 'review'>('auto');
  const [showPassPicker, setShowPassPicker] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<SequenceResponse>({
    queryKey: ['backlog-sequence'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequence');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SequenceResponse>;
    },
    refetchInterval: 60_000,
  });

  const allNodes = data?.nodes ?? [];
  const staleNodes = useMemo(() => allNodes.filter((n) => n.condition === 'stale'), [allNodes]);
  const refineNodes = useMemo(() => allNodes.filter((n) => n.condition === 'needs-refinement'), [allNodes]);

  const filteredNodes = useMemo(() => {
    return allNodes.filter((n) => {
      if (importanceFilter !== 'all' && n.importance !== importanceFilter) return false;
      if (conditionFilter !== 'all' && n.condition !== conditionFilter) return false;
      if (inPipelineOnly && !n.inPipeline) return false;
      if (readyOnly && n.gate !== 'ready') return false;
      return true;
    });
  }, [allNodes, importanceFilter, conditionFilter, inPipelineOnly, readyOnly]);

  // For DAG view: top-tier + neighbors + in-pipeline when too large
  const dagData = useMemo((): SequenceResponse => {
    if (!data) return { nodes: [], edges: [] };
    const total = filteredNodes.length;
    if (total <= DAG_NODE_BUDGET) return { nodes: filteredNodes, edges: data.edges };
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
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
      }
      setTimeout(() => refetch(), 2000);
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpawning(false);
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

  const conditionBadge = (condition: string) =>
    CONDITION_BADGE_CLASS[condition] ?? 'bg-gray-700 text-gray-400';
  const gateBadge = (gate: string) =>
    GATE_BADGE_CLASS[gate] ?? 'bg-gray-700 text-gray-400';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] shrink-0 flex-wrap">
        <ListOrdered className="w-4 h-4 text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-fg)] text-sm">Backlog Sequence</span>
        {allNodes.length > 0 && (
          <span className="text-xs text-[var(--color-fg-muted)]">{allNodes.length} issues</span>
        )}

        {/* View toggle */}
        <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
          <button
            onClick={() => setView('list')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${view === 'list' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <ListOrdered className="w-3 h-3" />
            List
          </button>
          <button
            onClick={() => setView('dag')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${view === 'dag' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <GitFork className="w-3 h-3" />
            DAG
          </button>
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={`px-2 py-1 text-xs flex items-center gap-1 rounded border ${showFilters ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
        >
          <Filter className="w-3 h-3" />
          Filters {filteredNodes.length !== allNodes.length && `(${filteredNodes.length})`}
        </button>

        {/* Stale toggle */}
        {staleNodes.length > 0 && (
          <button
            onClick={() => setShowStale((p) => !p)}
            className={`px-2 py-1 text-xs rounded border ${showStale ? 'border-yellow-500 text-yellow-400' : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            ⊘ {staleNodes.length} stale
          </button>
        )}

        {/* Run pass button */}
        <div className="relative ml-auto flex items-center gap-1">
          <button
            onClick={handleRunPass}
            disabled={spawning}
            className="px-2 py-1 text-xs flex items-center gap-1 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
            title={`Run ${spawnPass} pass`}
          >
            <Play className="w-3 h-3" />
            {spawning ? 'Spawning…' : `Run ${spawnPass}`}
          </button>
          <button
            onClick={() => setShowPassPicker((p) => !p)}
            className="px-1 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)]"
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
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Spawn error banner */}
      {spawnError && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-red-900/20 border-b border-red-900/40 text-xs">
          <span className="text-red-400 font-semibold">Run pass failed</span>
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
        <div className="flex flex-wrap gap-3 px-5 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[var(--color-fg-muted)]">Importance:</span>
            {(['all', 'critical', 'high', 'medium', 'low'] as ImportanceFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setImportanceFilter(v)}
                className={`px-2 py-0.5 rounded ${importanceFilter === v ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-hover)] text-[var(--color-fg-muted)]'}`}
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
                className={`px-2 py-0.5 rounded ${conditionFilter === v ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-hover)] text-[var(--color-fg-muted)]'}`}
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
        </div>
      )}

      {/* Candidates-to-close summary */}
      {showStale && staleNodes.length > 0 && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
          <div className="text-xs font-semibold text-[var(--color-fg-muted)] mb-2">Candidates to close ({staleNodes.length})</div>
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
          <span className="text-yellow-400 font-semibold">⚠ {refineNodes.length} need refinement</span>
          <span className="text-yellow-700">{refineNodes.slice(0, 5).map((n) => n.issueId).join(', ')}{refineNodes.length > 5 ? ` +${refineNodes.length - 5}` : ''}</span>
          <button
            onClick={() => handleDraftPrd(refineNodes[0]!.issueId)}
            className="ml-auto px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400 hover:bg-yellow-800/60 shrink-0"
          >
            Draft PRD →
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
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
          <div className="overflow-y-auto h-full">
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
                  return (
                    <tr
                      key={node.issueId}
                      className={`border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)] transition-colors ${isStale ? 'opacity-50' : ''}`}
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
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_CLASS[tier] ?? 'bg-gray-700 text-gray-400'}`}>
                          {TIER_LABEL[tier]}
                        </span>
                      </td>
                      <td className={`px-2 py-2 text-[var(--color-fg-muted)] max-w-xs truncate ${isStale ? 'line-through' : ''}`}>
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
                          {node.gate === 'ready' ? '📌' : node.gate === 'blocked' ? '⛔' : node.gate}
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
          <div className="h-full flex flex-col">
            {collapsedCount > 0 && (
              <div className="shrink-0 text-xs text-center py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-[var(--color-fg-muted)]">
                Showing {dagData.nodes.length} of {filteredNodes.length} issues (top tier + neighbors); {collapsedCount} collapsed
              </div>
            )}
            <div className="flex-1">
              <BacklogDAG data={dagData} className="w-full h-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BacklogSequencerPage;
