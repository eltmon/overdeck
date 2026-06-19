import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListOrdered, GitFork, RefreshCw } from 'lucide-react';
import { BacklogDAG } from '../components/backlog/BacklogDAG';

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

export function BacklogSequencerPage() {
  const [view, setView] = useState<View>('list');
  const { data, isLoading, error, refetch } = useQuery<SequenceResponse>({
    queryKey: ['backlog-sequence'],
    queryFn: async () => {
      const res = await fetch('/api/backlog/sequence');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SequenceResponse>;
    },
    refetchInterval: 60_000,
  });

  const nodes = data?.nodes ?? [];

  const conditionBadge = (condition: string) => {
    if (condition === 'ok') return 'bg-green-900/40 text-green-400';
    if (condition === 'needs-refinement') return 'bg-yellow-900/40 text-yellow-400';
    return 'bg-gray-700 text-gray-400';
  };

  const gateBadge = (gate: string) => {
    if (gate === 'ready') return 'bg-blue-900/40 text-blue-400';
    if (gate === 'blocked') return 'bg-red-900/40 text-red-400';
    return 'bg-gray-700 text-gray-400';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg)]">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] shrink-0">
        <ListOrdered className="w-4 h-4 text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-fg)] text-sm">Backlog Sequence</span>
        {nodes.length > 0 && (
          <span className="text-xs text-[var(--color-fg-muted)]">{nodes.length} issues</span>
        )}
        {/* View toggle */}
        <div className="ml-4 flex rounded overflow-hidden border border-[var(--color-border)]">
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
        <button
          onClick={() => refetch()}
          className="ml-auto p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

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
        {!isLoading && !error && nodes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-[var(--color-fg-muted)]">
            <ListOrdered className="w-8 h-8 opacity-40" />
            <p className="text-sm">No backlog sequence yet.</p>
            <p className="text-xs">Run a sequencer pass to rank the open backlog.</p>
          </div>
        )}

        {/* List view */}
        {!isLoading && !error && nodes.length > 0 && view === 'list' && (
          <div className="overflow-y-auto h-full">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
                <tr className="text-[var(--color-fg-muted)]">
                  <th className="text-right px-3 py-2 font-medium w-10">#</th>
                  <th className="text-left px-2 py-2 font-medium w-28">Issue</th>
                  <th className="text-left px-2 py-2 font-medium">Why</th>
                  <th className="text-center px-2 py-2 font-medium w-14">Size</th>
                  <th className="text-center px-2 py-2 font-medium w-20">Condition</th>
                  <th className="text-center px-2 py-2 font-medium w-16">Gate</th>
                  <th className="text-center px-2 py-2 font-medium w-14">Score</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr
                    key={node.issueId}
                    className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <td className="text-right px-3 py-2 text-[var(--color-fg-muted)] tabular-nums">
                      {node.rank}
                    </td>
                    <td className="px-2 py-2 font-mono text-[var(--color-accent)]">
                      {node.issueId}
                      {node.inPipeline && (
                        <span className="ml-1 text-[9px] text-green-400 align-top">▶</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-[var(--color-fg-muted)] max-w-xs truncate">
                      {node.why}
                    </td>
                    <td className="px-2 py-2 text-center text-[var(--color-fg-muted)]">
                      {node.size}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${conditionBadge(node.condition)}`}>
                        {node.condition}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${gateBadge(node.gate)}`}>
                        {node.gate}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center text-[var(--color-fg-muted)] tabular-nums">
                      {node.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* DAG view */}
        {!isLoading && !error && nodes.length > 0 && view === 'dag' && data && (
          <BacklogDAG data={data} className="w-full h-full" />
        )}
      </div>
    </div>
  );
}

export default BacklogSequencerPage;
