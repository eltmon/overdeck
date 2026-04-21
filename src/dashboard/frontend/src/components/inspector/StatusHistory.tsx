import { useState } from 'react';
import type { StatusHistoryEntry } from './types';
import { formatRelativeTime } from './utils';

export function StatusHistory({ history }: { history: StatusHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...history].reverse();
  return (
    <div className="px-3 py-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-content-subtle hover:text-content transition-colors"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Previous attempts ({history.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-12 shrink-0 text-content-subtle">{formatRelativeTime(entry.timestamp)}</span>
              <span className={
                entry.type === 'review' ? 'text-primary' :
                entry.type === 'test' ? 'text-signal-review' :
                'text-success'
              }>{entry.type}</span>
              <span className={
                entry.status === 'passed' ? 'text-success' :
                entry.status === 'failed' || entry.status === 'blocked' ? 'text-destructive' :
                ['reviewing', 'testing', 'merging'].includes(entry.status) ? 'text-warning' :
                'text-content-muted'
              }>{entry.status}</span>
              {entry.notes && (
                <span className="truncate text-content-subtle" title={entry.notes}>
                  — {entry.notes.slice(0, 60)}{entry.notes.length > 60 ? '...' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
