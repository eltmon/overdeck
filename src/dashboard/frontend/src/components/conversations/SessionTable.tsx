/**
 * Session list table (PAN-457)
 */

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Anchor, CheckCircle, Circle, Star } from 'lucide-react';

interface Session {
  id: number;
  source: 'discovered' | 'managed-archived';
  harness: string;
  workspacePath: string | null;
  jsonlPath: string | null;
  primaryModel: string | null;
  messageCount: number;
  lastTs: string | null;
  estimatedCost: number;
  tags: string[];
  summary: string | null;
  conversationTitle?: string | null;
  conversationName?: string | null;
  archivedAt?: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  overdeckManaged: boolean;
  panIssueId: string | null;
}

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function SessionTable({ sessions, selectedId, onSelect, hasMore = false, isLoadingMore = false, onLoadMore }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualRows.at(-1);
    if (!last || !hasMore || isLoadingMore || !onLoadMore) return;
    if (last.index >= sessions.length - 8) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore, sessions.length, virtualRows]);

  return (
    <div ref={parentRef} className="flex-1 overflow-auto" role="table">
      <div className="grid grid-cols-[1.25rem_minmax(14rem,1fr)_8rem_4rem_5rem_7rem] gap-3 border-b border-gray-800 bg-gray-950 px-3 py-2 text-xs font-medium text-gray-500 sticky top-0 z-10" role="row">
        <div />
        <div>Session</div>
        <div>Model</div>
        <div className="text-right">Msgs</div>
        <div className="text-right">Cost</div>
        <div>Last Active</div>
      </div>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((virtualRow) => {
          const session = sessions[virtualRow.index];
          if (!session) return null;
          const key = `${session.source}:${session.id}`;
          const isSelected = key === selectedId;
          const workspace = session.workspacePath ?? session.jsonlPath ?? 'Unknown session path';
          const shortWorkspace = workspace.split('/').slice(-2).join('/');
          const title = session.conversationTitle ?? session.conversationName ?? shortWorkspace;
          const subtitle = session.summary ?? workspace;

          return (
            <div
              key={key}
              role="row"
              data-session-key={key}
              onClick={() => onSelect(isSelected ? null : key)}
              className={`absolute left-0 right-0 grid cursor-pointer grid-cols-[1.25rem_minmax(14rem,1fr)_8rem_4rem_5rem_7rem] items-center gap-3 border-b border-gray-900 px-3 text-xs transition-colors ${
                isSelected ? 'bg-blue-950 border-blue-900' : 'hover:bg-gray-900'
              }`}
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="text-center">
                {session.source === 'managed-archived' ? (
                  <Anchor className="inline h-3 w-3 text-amber-400" />
                ) : session.overdeckManaged ? (
                  <Star className="inline h-3 w-3 text-cyan-400" />
                ) : session.enrichmentLevel > 0 ? (
                  <CheckCircle className="inline h-3 w-3 text-green-500" />
                ) : (
                  <Circle className="inline h-3 w-3 text-gray-700" />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-gray-100" title={`${title} — ${subtitle}`}>{title}</span>
                {subtitle && <span className="min-w-0 truncate text-gray-500">{subtitle}</span>}
                {session.source === 'managed-archived' ? (
                  <span className="shrink-0 rounded-full border border-amber-700 bg-amber-950 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    Archived{session.panIssueId ? ` · ${session.panIssueId}` : ''}
                  </span>
                ) : session.overdeckManaged && (
                  <span className="shrink-0 rounded-full border border-cyan-700 bg-cyan-950 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200">
                    Managed{session.panIssueId ? ` · ${session.panIssueId}` : ''}
                  </span>
                )}
                {session.harness !== 'claude-code' && (
                  <span className="shrink-0 border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
                    {session.harness}
                  </span>
                )}
              </div>
              <div className="truncate text-gray-400">{session.primaryModel ? session.primaryModel.split('-').slice(-2).join('-') : '—'}</div>
              <div className="text-right font-mono text-gray-400">{session.messageCount}</div>
              <div className="text-right font-mono">
                {session.estimatedCost > 0 ? (
                  <span className="text-yellow-500">${session.estimatedCost.toFixed(4)}</span>
                ) : (
                  <span className="text-gray-700">—</span>
                )}
              </div>
              <div className="text-gray-500">{session.lastTs ? formatRelative(session.lastTs) : '—'}</div>
            </div>
          );
        })}
      </div>
      {isLoadingMore && (
        <div className="px-3 py-2 text-center text-xs text-gray-500">Loading more…</div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
