import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle, CheckCircle2, Clock, List, GitFork, ListTodo, RefreshCw, Loader2, Download, ChevronDown, ChevronRight } from 'lucide-react';
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
  const planHasItems = planDoc != null && (planDoc.plan?.items?.length ?? 0) > 0;

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
            <Circle className="w-3 h-3 text-primary" />
            {openTasks.length} open
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-success" />
            {closedTasks.length} closed
          </span>
        </div>
        <div className="flex items-center gap-1">
          {planHasItems && (
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
          {planHasItems && (
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
      {view === 'graph' && planHasItems && (
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

      {/* List view — also shown when graph selected but no plan items */}
      {(view === 'list' || !planHasItems) && (
        <>
          {beadsData?.tasks && beadsData.tasks.length > 0 ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {openTasks.map((task) => (
                <TaskItem key={task.id} task={task} planDoc={planDoc ?? null} />
              ))}
              {closedTasks.map((task) => (
                <TaskItem key={task.id} task={task} planDoc={planDoc ?? null} />
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

const AC_STATUS_ICONS: Record<string, { color: string; symbol: string }> = {
  completed:   { color: '#22c55e', symbol: '✓' },
  in_progress: { color: '#eab308', symbol: '●' },
  pending:     { color: '#6b7280', symbol: '○' },
  blocked:     { color: '#6b7280', symbol: '○' },
  cancelled:   { color: '#6b7280', symbol: '○' },
};

function TaskItem({ task, planDoc }: { task: BeadTask; planDoc: VBriefDocument | null }) {
  const [expanded, setExpanded] = useState(false);

  // Match bead to plan item using the same pattern as PlanItemDetail
  const planItem: VBriefItem | undefined = planDoc
    ? planDoc.plan.items.find(item =>
        `${planDoc.plan.id}: ${item.title}`.toLowerCase() === (task.title || task.name || '').toLowerCase()
      )
    : undefined;
  const acs = (planItem?.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion');
  const completedAcs = acs.filter(s => s.status === 'completed').length;
  const hasACs = acs.length > 0;

  return (
    <div
      className={`rounded border text-xs ${
        task.status === 'open'
          ? 'border-divider bg-surface-raised/50'
          : 'border-divider bg-surface/50 opacity-60'
      }`}
    >
      <div className="flex items-start gap-2 p-2">
        {task.status === 'open' ? (
          <Circle className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-content break-words leading-tight">
            {task.title || task.name || task.id}
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {task.labels.map((label) => (
              <span
                key={label}
                className={`text-[9px] px-1 py-0.5 rounded ${
                  label.startsWith('difficulty:')
                    ? label.includes('easy') ? 'badge-bg-success text-success' :
                      label.includes('medium') ? 'badge-bg-warning text-warning' :
                      label.includes('hard') ? 'badge-bg-destructive text-destructive' :
                      'bg-surface-overlay text-content-body'
                    : 'bg-surface-overlay text-content-body'
                }`}
              >
                {label}
              </span>
            ))}
            {/* AC count badge */}
            {hasACs && (
              <span className="text-[9px] px-1 py-0.5 rounded border border-primary/30 badge-bg-primary text-primary font-semibold">
                {completedAcs}/{acs.length} AC
              </span>
            )}
          </div>
          {task.blockedBy.length > 0 && (
            <div className="flex items-center gap-1 mt-1 text-[9px] text-warning">
              <Clock className="w-2.5 h-2.5" />
              Blocked by: {task.blockedBy.join(', ')}
            </div>
          )}
        </div>
        {/* Expand/collapse chevron */}
        {hasACs && (
          <button
            onClick={() => setExpanded(prev => !prev)}
            className="shrink-0 text-content-muted hover:text-content transition-colors mt-0.5"
            title={expanded ? 'Collapse acceptance criteria' : 'Expand acceptance criteria'}
          >
            {expanded
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {/* Expandable AC section */}
      {hasACs && expanded && (
        <div className="px-2 pb-2 space-y-1 border-t border-divider/50 pt-1.5">
          {acs.map(ac => {
            const icon = AC_STATUS_ICONS[ac.status] ?? AC_STATUS_ICONS.pending;
            return (
              <div key={ac.id} className="flex items-start gap-1.5 text-[10px] text-content-subtle">
                <span style={{ color: icon.color, fontSize: 7, marginTop: 2, flexShrink: 0 }}>{icon.symbol}</span>
                <span className="leading-tight break-words">{ac.title}</span>
              </div>
            );
          })}
        </div>
      )}
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

  // All incoming edges (this item is the target)
  const incomingEdges = doc.plan.edges.filter(e => e.to === item.id);
  // All outgoing edges (this item is the source)
  const outgoingEdges = doc.plan.edges.filter(e => e.from === item.id);

  const itemById = (id: string) => doc.plan.items.find(i => i.id === id);

  const acs = (item.subItems ?? []).filter(s => s.metadata?.kind === 'acceptance_criterion');
  const completedAcs = acs.filter(s => s.status === 'completed').length;

  // All narrative fields (not just Action)
  const narrativeEntries = item.narrative ? Object.entries(item.narrative) : [];

  return (
    <div className="p-2 rounded border border-divider bg-surface-raised/50 text-xs space-y-2">
      {/* Title + meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-content leading-snug">{item.title}</div>
        <div className="flex items-center gap-1 shrink-0">
          {item.metadata?.difficulty && (
            <span className="bg-surface-overlay text-content-muted px-1 py-0.5 rounded text-[9px] uppercase">
              {item.metadata.difficulty}
            </span>
          )}
          {item.priority && (
            <span className="bg-surface-overlay text-content-muted px-1 py-0.5 rounded text-[9px] uppercase">
              {item.priority}
            </span>
          )}
        </div>
      </div>

      {/* Bead status */}
      {matchedBead && (
        <div className="flex items-center gap-1 text-[10px]">
          {matchedBead.status === 'closed'
            ? <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
            : <Circle className="w-3 h-3 text-primary shrink-0" />}
          <span className="text-content-subtle">
            Bead: {matchedBead.status === 'closed' ? 'completed' : 'open'} ({matchedBead.id})
          </span>
        </div>
      )}

      {/* Narrative fields */}
      {narrativeEntries.map(([key, value]) => value ? (
        <div key={key} className="space-y-0.5">
          <div className="text-[9px] font-medium uppercase tracking-wide text-content-subtle">{key}</div>
          <div className="text-content-muted leading-relaxed">{value}</div>
        </div>
      ) : null)}

      {/* Acceptance criteria with progress counter */}
      {acs.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-medium uppercase tracking-wide text-content-subtle">
            Criteria ({completedAcs}/{acs.length} met)
          </div>
          {acs.map(s => (
            <div key={s.id} className="flex items-start gap-1 text-[10px] text-content-subtle">
              {s.status === 'completed'
                ? <CheckCircle2 className="w-3 h-3 text-success shrink-0 mt-0.5" />
                : <Circle className="w-3 h-3 text-content-muted shrink-0 mt-0.5" />}
              {s.title}
            </div>
          ))}
        </div>
      )}

      {/* Edge context — all incoming/outgoing edges */}
      {(incomingEdges.length > 0 || outgoingEdges.length > 0) && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-medium uppercase tracking-wide text-content-subtle">Dependencies</div>
          {incomingEdges.map((e, i) => {
            const source = itemById(e.from);
            return source ? (
              <div key={`in-${i}`} className="text-[10px] text-content-subtle">
                <span className="text-primary/80">← {e.type}</span>
                {' '}{source.title}
              </div>
            ) : null;
          })}
          {outgoingEdges.map((e, i) => {
            const target = itemById(e.to);
            return target ? (
              <div key={`out-${i}`} className="text-[10px] text-content-subtle">
                <span className="text-warning/80">→ {e.type}</span>
                {' '}{target.title}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
