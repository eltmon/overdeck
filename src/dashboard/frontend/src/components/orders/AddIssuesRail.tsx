import { useMemo, useState } from 'react';
import type { OrderBookLane } from '@overdeck/contracts';
import { Search } from 'lucide-react';

import { useDashboardStore, selectIssues } from '../../lib/store';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import type { Issue } from '../../types';
import type { OrderBookView } from './BookStrip';
import { withProject } from './projectScope';

interface AddIssuesRailProps {
  book: OrderBookView;
  books: OrderBookView[];
  onBookChange: (book: OrderBookView) => void;
  issues?: Issue[];
  project?: string | null;
}

function isOpenIssue(issue: Issue): boolean {
  const state = (issue.state ?? issue.status).toLowerCase();
  return issue.stateType !== 'completed' && issue.stateType !== 'canceled'
    && !['done', 'closed', 'completed', 'canceled', 'cancelled'].includes(state);
}

function membership(books: OrderBookView[]): Map<string, OrderBookView> {
  const result = new Map<string, OrderBookView>();
  for (const book of books) {
    if (book.status === 'complete') continue;
    for (const item of book.items) result.set(item.issue.toUpperCase(), book);
  }
  return result;
}

async function addIssue(bookId: string, issueId: string, lane: OrderBookLane, project?: string | null): Promise<OrderBookView> {
  const response = await fetch(withProject(`/api/orders/${encodeURIComponent(bookId)}/items`, project), {
    method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ item: { issue: issueId, lane } }),
  });
  const payload = await response.json().catch(() => null) as (OrderBookView & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? `Could not add ${issueId} (${response.status})`);
  return payload as OrderBookView;
}

export function AddIssuesRail({ book, books, onBookChange, issues, project }: AddIssuesRailProps) {
  const storeIssues = useDashboardStore(selectIssues) as Issue[];
  const availableIssues = issues ?? storeIssues;
  const [query, setQuery] = useState('');
  const [lane, setLane] = useState<OrderBookLane>('A');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owners = useMemo(() => membership(books), [books]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return availableIssues.filter(isOpenIssue).filter((issue) => [
      issue.identifier,
      issue.title,
      ...issue.labels,
    ].some((value) => value.toLowerCase().includes(needle))).slice(0, 10);
  }, [availableIssues, query]);

  const add = async (issueId: string) => {
    setAdding(issueId);
    setError(null);
    try {
      onBookChange(await addIssue(book.id, issueId, lane, project));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label="Search and add issues">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Search open issues</h2>
        <div className="ml-auto flex rounded-md border border-border p-0.5 text-[10px]">
          {(['A', 'B'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setLane(value)} aria-pressed={lane === value} className={`rounded-sm px-2 py-0.5 ${lane === value ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>Lane {value}</button>
          ))}
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="sr-only">Search issues by id, title, or label</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, title, or label" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
      </label>
      <div className="mt-2 grid gap-1">
        {results.map((issue) => {
          const owner = owners.get(issue.identifier.toUpperCase());
          const disabledReason = owner
            ? owner.id === book.id ? 'Already in this book' : `In ${owner.name}`
            : null;
          return (
            <div key={issue.id} className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0">
              <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{issue.identifier}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{issue.title}</span>
              <button
                type="button"
                disabled={Boolean(disabledReason) || adding === issue.identifier}
                title={disabledReason ?? `Add to Lane ${lane}`}
                onClick={() => void add(issue.identifier)}
                className="w-20 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {disabledReason ?? (adding === issue.identifier ? 'Adding…' : `+ Lane ${lane}`)}
              </button>
            </div>
          );
        })}
        {query.trim() && results.length === 0 && <p className="py-2 text-xs text-muted-foreground">No matching open issues.</p>}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Adding changes the plan only; dispatch begins when the book's run starts.</p>
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
