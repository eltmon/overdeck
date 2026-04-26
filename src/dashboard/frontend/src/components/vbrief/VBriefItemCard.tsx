import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, XCircle, Clock } from 'lucide-react';
import type { VBriefItem, VBriefSubItem } from './types';

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-success border-success/50',
  running: 'text-primary border-primary/50',
  in_progress: 'text-primary border-primary/50',
  blocked: 'text-destructive border-destructive/50',
  cancelled: 'text-muted-foreground border-border',
  pending: 'text-muted-foreground border-border',
  draft: 'text-muted-foreground border-border',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'badge-bg-destructive text-destructive',
  high: 'badge-bg-warning text-warning-foreground',
  medium: 'badge-bg-warning text-warning',
  low: 'badge-bg-muted text-muted-foreground',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  trivial: 'badge-bg-muted text-muted-foreground',
  simple: 'badge-bg-success text-success',
  medium: 'badge-bg-warning text-warning',
  complex: 'badge-bg-warning text-warning-foreground',
  expert: 'badge-bg-destructive text-destructive',
};

function ACIcon({ sub }: { sub: VBriefSubItem }) {
  if (sub.status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />;
  if (sub.status === 'blocked') return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  if (sub.status === 'running' || sub.status === 'in_progress') return <Clock className="w-3.5 h-3.5 text-primary shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

interface VBriefItemCardProps {
  item: VBriefItem;
}

export function VBriefItemCard({ item }: VBriefItemCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusCls = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
  const difficulty = item.metadata?.difficulty as string | undefined;
  const acItems = item.subItems?.filter(s => s.metadata?.kind === 'acceptance_criterion') ?? [];

  return (
    <div className={`border rounded-lg overflow-hidden ${statusCls}`}>
      <button
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted transition-colors"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{item.title}</span>
            {item.priority && (
              <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[item.priority] ?? ''}`}>
                {item.priority}
              </span>
            )}
            {difficulty && (
              <span className={`px-1.5 py-0.5 rounded text-xs ${DIFFICULTY_COLORS[difficulty] ?? ''}`}>
                {difficulty}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{item.status}</span>
          </div>
          {acItems.length > 0 && !expanded && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {acItems.filter(s => s.status === 'completed').length}/{acItems.length} AC
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {item.narrative?.Action && (
            <p className="text-sm text-muted-foreground leading-relaxed">{item.narrative.Action}</p>
          )}
          {acItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Acceptance Criteria</div>
              <ul className="space-y-1">
                {acItems.map(sub => (
                  <li key={sub.id} className="flex items-start gap-1.5 text-sm">
                    <ACIcon sub={sub} />
                    <span className={sub.status === 'completed' ? 'text-success line-through' : 'text-muted-foreground'}>
                      {sub.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
