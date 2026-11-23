/**
 * The one place to add issues to a book (PAN-5597 WI-7). With an empty
 * search it lists the top of the backlog; with a query it lists matching open
 * issues. One "Add to" control picks the lane. Rows can also be dragged onto
 * a lane in the issue list (`ADD_ISSUE_DRAG_TYPE`).
 */
import { useState } from 'react';
import type { OrderBookLane } from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { selectIssues, useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { ADD_ISSUE_DRAG_TYPE } from './BookIssueList';
import { bookPath, errorMessage, orderBookRequest, type OrderBookEditorProps } from './orderBookApi';
import type { OrderBookView } from './types';

interface BacklogCandidate {
  issue: string;
  rank: number;
  why: string;
}

interface AddIssuesPanelProps extends OrderBookEditorProps {
  /** Every book in the project, to mark issues another book already owns. */
  books: OrderBookView[];
  onClose?: () => void;
}

const QUERY_LIMIT = 12;

function isOpenIssue(issue: Issue): boolean {
  const state = (issue.state ?? issue.status).toLowerCase();
  return issue.stateType !== 'completed' && issue.stateType !== 'canceled'
    && !['done', 'closed', 'completed', 'canceled', 'cancelled'].includes(state);
}

interface PanelRow {
  issue: string;
  title: string;
  tooltip: string;
  rank?: number;
}

export function AddIssuesPanel({ book, books, project, onBookChange, onError, onClose }: AddIssuesPanelProps) {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const [lane, setLane] = useState<OrderBookLane>('A');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const { data: candidates = [] } = useQuery({
    queryKey: ['order-books', 'backlog-candidates', project ?? null],
    queryFn: async () => (await orderBookRequest<{ candidates?: BacklogCandidate[] }>('/api/orders/backlog-candidates?limit=10', project)).candidates ?? [],
    staleTime: 30_000,
  });

  const owners = new Map<string, OrderBookView>();
  for (const candidate of [...books.filter((entry) => entry.id !== book.id), book]) {
    if (candidate.phase === 'archived') continue;
    for (const item of candidate.items) owners.set(item.issue.toUpperCase(), candidate);
  }
  const titles = new Map(issues.map((issue) => [issue.identifier.toUpperCase(), issue.title]));

  const needle = query.trim().toLowerCase();
  const rows: PanelRow[] = needle
    ? issues
      .filter(isOpenIssue)
      .filter((issue) => [issue.identifier, issue.title, ...issue.labels].some((value) => value.toLowerCase().includes(needle)))
      .slice(0, QUERY_LIMIT)
      .map((issue) => ({ issue: issue.identifier.toUpperCase(), title: issue.title, tooltip: issue.title }))
    : [...candidates]
      .sort((left, right) => left.rank - right.rank)
      .map((candidate) => ({
        issue: candidate.issue.toUpperCase(),
        title: titles.get(candidate.issue.toUpperCase()) ?? candidate.why,
        tooltip: candidate.why,
        rank: candidate.rank,
      }));

  const add = async (issueId: string) => {
    setAdding(issueId);
    try {
      const updated = await orderBookRequest(bookPath(book.id, '/items'), project, { method: 'POST', body: { item: { issue: issueId, lane } } });
      onBookChange?.(updated);
    } catch (cause) {
      onError?.(errorMessage(cause));
    } finally {
      setAdding(null);
    }
  };

  return (
    <aside aria-label="Add issues" className="grid min-w-0 content-start gap-3 rounded-lg border border-border bg-card p-4 text-xs" data-section="OrderBookAddIssues">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-foreground">Add issues</h2>
        {onClose && (
          <button type="button" aria-label="Close Add issues" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-muted-foreground" role="group" aria-label="Add to">
        Add to
        <span className="flex rounded-md border border-border p-0.5">
          {([['A', 'Parallel'], ['B', 'One at a time']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={lane === value}
              onClick={() => setLane(value)}
              className={`rounded-sm px-2 py-0.5 ${lane === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <input
        type="search"
        aria-label="Search open issues"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by ID, title, or label"
        className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-foreground outline-none focus:border-primary"
      />
      <div className="min-w-0">
        <h3 className="eyebrow mb-1">{needle ? 'Open issues' : 'Top of your backlog'}</h3>
        {rows.map((row) => {
          const owner = owners.get(row.issue);
          return (
            <div
              key={row.issue}
              data-candidate={row.issue}
              draggable={!owner}
              onDragStart={(event) => {
                event.dataTransfer.setData(ADD_ISSUE_DRAG_TYPE, row.issue);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              title={row.tooltip}
              className="list-row flex min-w-0 items-center gap-2 border-t border-border py-2 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{row.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-mono">{row.issue}</span>
                  {row.rank !== undefined && <> · backlog #{row.rank}</>}
                </div>
              </div>
              {owner ? (
                <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {owner.id === book.id ? 'In this book' : `In ${owner.name}`}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={adding === row.issue}
                  onClick={() => void add(row.issue)}
                  aria-label={`Add ${row.issue}`}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                >
                  {adding === row.issue ? 'Adding…' : 'Add'}
                </button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="py-2 text-muted-foreground">{needle ? 'No open issues match.' : 'The backlog has nothing left to add.'}</p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Adding an issue only changes the list. Work starts when the book is active.</p>
    </aside>
  );
}
