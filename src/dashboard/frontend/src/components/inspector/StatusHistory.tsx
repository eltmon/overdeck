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
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Previous attempts ({history.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-12 shrink-0 text-muted-foreground">{formatRelativeTime(entry.timestamp)}</span>
              <span className={
                entry.type === 'review' ? 'text-primary' :
                entry.type === 'test' ? 'text-signal-review' :
                'text-success'
              }>{entry.type}</span>
              <span className={
                entry.status === 'passed' ? 'text-success' :
                entry.status === 'failed' || entry.status === 'blocked' ? 'text-destructive' :
                ['reviewing', 'testing', 'merging'].includes(entry.status) ? 'text-warning' :
                'text-muted-foreground'
              }>{entry.status}</span>
              {entry.notes && (
                <span className="truncate text-muted-foreground" title={entry.notes}>
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
