import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, XCircle, Clock } from 'lucide-react';
import type { VBriefItem, VBriefSubItem } from './types';

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-green-400 border-green-700',
  running: 'text-blue-400 border-blue-700',
  in_progress: 'text-blue-400 border-blue-700',
  blocked: 'text-red-400 border-red-700',
  cancelled: 'text-gray-400 border-gray-700',
  pending: 'text-gray-400 border-gray-700',
  draft: 'text-gray-400 border-gray-700',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-900 text-red-200',
  high: 'bg-orange-900 text-orange-200',
  medium: 'bg-yellow-900 text-yellow-200',
  low: 'bg-gray-700 text-gray-300',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  trivial: 'bg-gray-700 text-gray-300',
  simple: 'bg-green-900 text-green-200',
  medium: 'bg-yellow-900 text-yellow-200',
  complex: 'bg-orange-900 text-orange-200',
  expert: 'bg-red-900 text-red-200',
};

function ACIcon({ sub }: { sub: VBriefSubItem }) {
  if (sub.status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />;
  if (sub.status === 'blocked') return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (sub.status === 'running' || sub.status === 'in_progress') return <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-gray-500 shrink-0" />;
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
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{item.title}</span>
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
            <span className="text-xs text-gray-400">{item.status}</span>
          </div>
          {acItems.length > 0 && !expanded && (
            <div className="text-xs text-gray-500 mt-0.5">
              {acItems.filter(s => s.status === 'completed').length}/{acItems.length} AC
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {item.narrative?.Action && (
            <p className="text-sm text-gray-300 leading-relaxed">{item.narrative.Action}</p>
          )}
          {acItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-1">Acceptance Criteria</div>
              <ul className="space-y-1">
                {acItems.map(sub => (
                  <li key={sub.id} className="flex items-start gap-1.5 text-sm">
                    <ACIcon sub={sub} />
                    <span className={sub.status === 'completed' ? 'text-green-300 line-through' : 'text-gray-300'}>
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
