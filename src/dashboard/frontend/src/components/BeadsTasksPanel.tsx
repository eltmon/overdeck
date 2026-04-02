import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle, CheckCircle2, Clock, List, GitFork, ListTodo, RefreshCw, Loader2, Download } from 'lucide-react';
import { PlanDAGViewer, type VBriefItem, type VBriefDocument } from './PlanDAG.js';

interface BeadTask {
  id: string;
  name?: string;
  title?: string;
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

  // Fetch the vBRIEF plan (also used to check if plan exists)
  const { data: planDoc } = useQuery<VBriefDocument | null>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
  const planExists = planDoc != null;

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
    <div className="space-y-2 p-4">
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
          {planExists && (
            <button
              onClick={() => {
                fetch(`/api/workspaces/${issueId}/plan`)
                  .then(res => res.json())
                  .then(data => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${issueId.toLowerCase()}-plan.vbrief.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  });
              }}
              className="p-1 hover:bg-surface-overlay rounded transition-colors"
              title="Download vBRIEF plan (for vBRIEF Studio)"
            >
              <Download className="w-3 h-3" />
            </button>
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
          {selectedItem && planDoc && (
            <PlanItemDetail
              item={selectedItem}
              doc={planDoc}
              beads={beadsData?.tasks ?? []}
            />
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
            {task.title || task.name || task.id}
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

// ── PlanItemDetail — shows narrative, ACs, bead status, blockers/dependents ──

interface PlanItemDetailProps {
  item: VBriefItem;
  doc: VBriefDocument;
  beads: BeadTask[];
}

function PlanItemDetail({ item, doc, beads }: PlanItemDetailProps) {
  // Beads are created with title "{plan.id}: {item.title}" — match using plan.id, not issueId
  const titlePattern = `${doc.plan.id}: ${item.title}`.toLowerCase();
  const matchedBead = beads.find(b => (b.title || b.name || '').toLowerCase() === titlePattern);

  // Gather all incoming edges (not just blocks) for richer dependency info
  const incomingEdges = doc.plan.edges.filter(e => e.to === item.id);
  const outgoingEdges = doc.plan.edges.filter(e => e.from === item.id);

  const blockerItems = incomingEdges
    .filter(e => e.type === 'blocks')
    .map(e => doc.plan.items.find(i => i.id === e.from))
    .filter(Boolean) as VBriefItem[];
  const informerItems = incomingEdges
    .filter(e => e.type === 'informs')
    .map(e => doc.plan.items.find(i => i.id === e.from))
    .filter(Boolean) as VBriefItem[];
  const dependentItems = outgoingEdges
    .filter(e => e.type === 'blocks')
    .map(e => doc.plan.items.find(i => i.id === e.to))
    .filter(Boolean) as VBriefItem[];
  const informsItems = outgoingEdges
    .filter(e => e.type === 'informs')
    .map(e => doc.plan.items.find(i => i.id === e.to))
    .filter(Boolean) as VBriefItem[];

  const acs = (item.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion');
  const narrativeEntries = Object.entries(item.narrative ?? {}).filter(([, v]) => v);
  const phase = item.metadata?.phase;

  const STATUS_BADGE_COLORS: Record<string, string> = {
    pending: 'text-gray-400',
    in_progress: 'text-blue-400',
    completed: 'text-green-400',
    cancelled: 'text-yellow-400',
    blocked: 'text-red-400',
  };

  return (
    <div className="p-2.5 rounded border border-divider bg-surface-raised/50 text-xs space-y-2.5">
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-content leading-snug">{item.title}</div>
        <span className={`shrink-0 text-[10px] font-semibold uppercase ${STATUS_BADGE_COLORS[item.status] ?? 'text-gray-400'}`}>
          {item.status.replace('_', ' ')}
        </span>
      </div>

      {/* Metadata badges row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {item.metadata?.difficulty && (
          <span className="bg-surface-overlay text-content-muted px-1.5 py-0.5 rounded text-[9px] uppercase font-medium">
            {item.metadata.difficulty}
          </span>
        )}
        {item.priority && (
          <span className="bg-surface-overlay text-content-muted px-1.5 py-0.5 rounded text-[9px] uppercase font-medium">
            {item.priority}
          </span>
        )}
        {phase != null && (
          <span className="bg-surface-overlay text-content-muted px-1.5 py-0.5 rounded text-[9px] font-medium">
            Phase {phase}
          </span>
        )}
      </div>

      {/* Bead status */}
      {matchedBead && (
        <div className="flex items-center gap-1 text-[10px]">
          {matchedBead.status === 'closed'
            ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
            : <Circle className="w-3 h-3 text-blue-400 shrink-0" />}
          <span className="text-content-subtle">
            Bead: {matchedBead.status === 'closed' ? 'completed' : 'open'} ({matchedBead.id})
          </span>
        </div>
      )}

      {/* Narrative — show all fields, not just Action */}
      {narrativeEntries.length > 0 && (
        <div className="space-y-1">
          {narrativeEntries.map(([key, value]) => (
            <div key={key} className="text-content-muted leading-relaxed">
              {narrativeEntries.length > 1 && (
                <span className="font-medium text-content-subtle">{key}: </span>
              )}
              {value}
            </div>
          ))}
        </div>
      )}

      {/* Acceptance criteria */}
      {acs.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[10px] font-medium text-content-subtle mb-0.5">Acceptance Criteria</div>
          {acs.map(s => (
            <div key={s.id} className="flex items-start gap-1 text-[10px] text-content-subtle">
              {s.status === 'completed'
                ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                : <Circle className="w-3 h-3 text-content-muted shrink-0 mt-0.5" />}
              {s.title}
            </div>
          ))}
        </div>
      )}

      {/* Dependencies section */}
      {(blockerItems.length > 0 || informerItems.length > 0 || dependentItems.length > 0 || informsItems.length > 0) && (
        <div className="space-y-1 border-t border-divider pt-2">
          {blockerItems.length > 0 && (
            <div className="text-[10px] text-orange-400/80">
              <span className="font-medium">Blocked by: </span>
              {blockerItems.map(b => b.title).join(', ')}
            </div>
          )}
          {informerItems.length > 0 && (
            <div className="text-[10px] text-blue-400/80">
              <span className="font-medium">Informed by: </span>
              {informerItems.map(b => b.title).join(', ')}
            </div>
          )}
          {dependentItems.length > 0 && (
            <div className="text-[10px] text-content-subtle">
              <span className="font-medium">Blocks: </span>
              {dependentItems.map(d => d.title).join(', ')}
            </div>
          )}
          {informsItems.length > 0 && (
            <div className="text-[10px] text-blue-300/60">
              <span className="font-medium">Informs: </span>
              {informsItems.map(d => d.title).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
