import { useState } from 'react';

interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge';
  status: string;
  timestamp: string;
  notes?: string;
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function StatusHistory({ history }: { history: StatusHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...history].reverse();
  return (
    <div className="mt-2 border-t border-pan-border/30 pt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-pan-text-secondary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>History ({history.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-12 shrink-0 text-pan-text-secondary">{formatRelativeTime(entry.timestamp)}</span>
              <span className={
                entry.type === 'review' ? 'text-blue-400' :
                entry.type === 'test' ? 'text-purple-400' :
                'text-green-400'
              }>{entry.type}</span>
              <span className={
                entry.status === 'passed' ? 'text-green-400' :
                entry.status === 'failed' || entry.status === 'blocked' ? 'text-red-400' :
                ['reviewing', 'testing', 'merging'].includes(entry.status) ? 'text-yellow-400' :
                'text-gray-500'
              }>{entry.status}</span>
              {entry.notes && (
                <span className="truncate text-pan-text-secondary" title={entry.notes}>
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
