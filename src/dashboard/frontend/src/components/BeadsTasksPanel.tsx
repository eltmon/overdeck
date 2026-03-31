import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle, CheckCircle2, Clock, List, GitFork, ListTodo, RefreshCw, Loader2 } from 'lucide-react';
import { PlanDAGViewer, type VBriefItem } from './PlanDAG.js';

interface BeadTask {
  id: string;
  name: string;
  status: 'open' | 'closed';
  labels: string[];
  blockedBy: string[];
  blocks: string[];
  createdAt: string;
  closedAt?: string;
}

interface BeadsResponse {
  issueId: string;
  workspacePath: string;
  tasks: BeadTask[];
}

interface BeadsTasksPanelProps {
  issueId: string;
}

const VIEW_PREF_KEY = 'beads-panel-view';

export function BeadsTasksPanel({ issueId }: BeadsTasksPanelProps) {
  const [view, setView] = useState<'list' | 'graph'>(() => {
    try {
      return (localStorage.getItem(VIEW_PREF_KEY) as 'list' | 'graph') ?? 'list';
    } catch {
      return 'list';
    }
  });

  const [selectedItem, setSelectedItem] = useState<VBriefItem | null>(null);

  const { data: beadsData, isLoading, refetch, isRefetching } = useQuery<BeadsResponse>({
    queryKey: ['beads', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/beads`);
      if (!res.ok) throw new Error('Failed to fetch beads');
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Check if a vBRIEF plan exists for this workspace
  const { data: planExists } = useQuery<boolean>({
    queryKey: ['plan-exists', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      return res.ok;
    },
    staleTime: 60_000,
  });

  const openTasks = beadsData?.tasks?.filter(t => t.status === 'open') || [];
  const closedTasks = beadsData?.tasks?.filter(t => t.status === 'closed') || [];

  function toggleView(next: 'list' | 'graph') {
    setView(next);
    setSelectedItem(null);
    try { localStorage.setItem(VIEW_PREF_KEY, next); } catch { /* ignore */ }
  }

  if (isLoading) {
    return (
      <div className="py-3 text-center text-content-muted text-xs">
        <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
        Loading tasks...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with counts and view toggle */}
      <div className="flex items-center justify-between text-xs text-content-subtle">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Circle className="w-3 h-3 text-blue-400" />
            {openTasks.length} open
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-400" />
            {closedTasks.length} closed
          </span>
        </div>
        <div className="flex items-center gap-1">
          {planExists && (
            <div className="flex items-center rounded border border-divider overflow-hidden mr-1">
              <button
                onClick={() => toggleView('list')}
                className={`p-1 transition-colors ${view === 'list' ? 'bg-surface-overlay text-content' : 'hover:bg-surface-overlay/50 text-content-muted'}`}
                title="List view"
              >
                <List className="w-3 h-3" />
              </button>
              <button
                onClick={() => toggleView('graph')}
                className={`p-1 transition-colors ${view === 'graph' ? 'bg-surface-overlay text-content' : 'hover:bg-surface-overlay/50 text-content-muted'}`}
                title="DAG graph view"
              >
                <GitFork className="w-3 h-3" />
              </button>
            </div>
          )}
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="p-1 hover:bg-surface-overlay rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Graph view */}
      {view === 'graph' && planExists && (
        <div className="space-y-2">
          <div style={{ height: 320 }}>
            <PlanDAGViewer
              issueId={issueId}
              onNodeClick={item => setSelectedItem(prev => prev?.id === item.id ? null : item)}
              className="rounded border border-divider overflow-hidden"
            />
          </div>
          {selectedItem && (
            <div className="p-2 rounded border border-divider bg-surface-raised/50 text-xs space-y-1">
              <div className="font-medium text-content">{selectedItem.title}</div>
              {selectedItem.narrative?.Action && (
                <div className="text-content-muted leading-relaxed">{selectedItem.narrative.Action}</div>
              )}
              {(selectedItem.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion').length > 0 && (
                <div className="space-y-0.5 mt-1">
                  {(selectedItem.subItems ?? [])
                    .filter(s => s.metadata?.kind === 'acceptance_criterion')
                    .map(s => (
                      <div key={s.id} className="flex items-start gap-1 text-[10px] text-content-subtle">
                        {s.status === 'completed'
                          ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                          : <Circle className="w-3 h-3 text-content-muted shrink-0 mt-0.5" />}
                        {s.title}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <>
          {beadsData?.tasks && beadsData.tasks.length > 0 ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {openTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
              {closedTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-content-muted text-xs">
              <ListTodo className="w-5 h-5 mx-auto mb-1 opacity-50" />
              <p>No tasks yet</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: BeadTask }) {
  return (
    <div
      className={`p-2 rounded border text-xs ${
        task.status === 'open'
          ? 'border-divider bg-surface-raised/50'
          : 'border-divider bg-surface/50 opacity-60'
      }`}
    >
      <div className="flex items-start gap-2">
        {task.status === 'open' ? (
          <Circle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-content break-words leading-tight">
            {task.name}
          </div>
          {task.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {task.labels.map((label) => (
                <span
                  key={label}
                  className={`text-[9px] px-1 py-0.5 rounded ${
                    label.startsWith('difficulty:')
                      ? label.includes('easy') ? 'bg-green-900/50 text-green-400' :
                        label.includes('medium') ? 'bg-yellow-900/50 text-yellow-400' :
                        label.includes('hard') ? 'bg-red-900/50 text-red-400' :
                        'bg-surface-overlay text-content-body'
                      : 'bg-surface-overlay text-content-body'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          {task.blockedBy.length > 0 && (
            <div className="flex items-center gap-1 mt-1 text-[9px] text-orange-400">
              <Clock className="w-2.5 h-2.5" />
              Blocked by: {task.blockedBy.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
