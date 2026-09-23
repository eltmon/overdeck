/**
 * Middle pane of the Agents Directory (PAN-3920 W6): the entries of the
 * selected node, children indented under their parents, with a filter.
 * Focus stays on the grid container; the selected row is its
 * aria-activedescendant.
 */
import { forwardRef, type KeyboardEvent, type RefObject } from 'react';

import { formatRelativeTime } from '../../../lib/formatRelativeTime';
import { useSharedTick } from '../../../lib/useSharedTick';
import { cn } from '../../../lib/utils';
import { DirectoryStateDot } from './DirectoryStateDot';
import type { DirectoryRow } from './directory-tree';
import type { DirectoryWindowHours } from './useAgentDirectory';

export function directoryRowDomId(entryId: string): string {
  return `directory-row-${entryId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function age(iso: string | null, now: Date): string {
  return formatRelativeTime(iso, now).replace(/ ago$/, '') || '—';
}

interface DirectoryListProps {
  rows: readonly DirectoryRow[];
  selectedEntryId: string | null;
  query: string;
  windowHours: DirectoryWindowHours;
  loading: boolean;
  error: boolean;
  filterRef: RefObject<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onFilterKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (entryId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export const DirectoryList = forwardRef<HTMLDivElement, DirectoryListProps>(function DirectoryList(
  { rows, selectedEntryId, query, windowHours, loading, error, filterRef, onQueryChange, onFilterKeyDown, onSelect, onKeyDown },
  ref,
) {
  const now = useSharedTick();
  const windowLabel = windowHours === 168 ? '7 days' : '24 hours';
  const empty = loading
    ? 'Loading agents…'
    : error
      ? 'The agents directory could not be loaded.'
      : query.trim()
        ? 'No agents match this filter.'
        : `No agents here in the last ${windowLabel}.`;

  return (
    <div className="flex min-h-0 flex-col border-r border-border" data-component="directory-list-pane">
      <div className="flex h-11 shrink-0 items-center border-b border-border px-3">
        <input
          ref={filterRef}
          type="search"
          value={query}
          placeholder="Filter agents"
          aria-label="Filter agents"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onFilterKeyDown}
          className="h-7 w-full rounded-[var(--radius-sm)] border border-border bg-card px-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div
        ref={ref}
        role="grid"
        aria-label="Agents"
        aria-activedescendant={selectedEntryId ? directoryRowDomId(selectedEntryId) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">{empty}</div>
        ) : rows.map(({ entry, depth, spawnedByLabel }) => {
          const selected = entry.id === selectedEntryId;
          return (
            <div
              key={entry.id}
              id={directoryRowDomId(entry.id)}
              role="row"
              aria-selected={selected}
              data-component="directory-row"
              data-entry-id={entry.id}
              onClick={() => onSelect(entry.id)}
              className={cn(
                'cursor-pointer border-b border-border/60 py-2 pr-3 hover:bg-accent',
                selected && 'bg-accent',
              )}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              <div role="gridcell" className="flex min-w-0 items-center gap-2">
                {depth > 0 && <span className="text-[12px] text-muted-foreground" aria-hidden="true">↳</span>}
                <DirectoryStateDot state={entry.state} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{entry.label}</span>
                <span className="shrink-0 font-mono-ui text-[11px] tabular-nums text-muted-foreground" title={entry.lastActivityAt ?? undefined}>
                  {entry.lastActivityAt ? formatRelativeTime(entry.lastActivityAt, now) : '—'}
                </span>
              </div>
              <div role="gridcell" className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
                <span className="max-w-[60%] shrink-0 truncate font-mono-ui">{entry.id}</span>
                {entry.role && <span className="shrink-0">· {entry.role}</span>}
                <span className="min-w-0 truncate font-mono-ui">· {entry.harness} · {entry.model}</span>
                <span className="ml-auto shrink-0">{entry.state}</span>
                {entry.startedAt && <span className="shrink-0 font-mono-ui tabular-nums">· {age(entry.startedAt, now)}</span>}
              </div>
              {spawnedByLabel && (
                <div className="mt-0.5 truncate pl-3.5 text-[11px] text-muted-foreground">spawned by {spawnedByLabel}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
