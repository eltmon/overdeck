/**
 * The order-book list (PAN-5597 WI-5): the left column of the Order books
 * page, grouped by the server-derived phase — Active, Queued, Drafts, and a
 * collapsed Archived group. The page owns whether the new-book form is open,
 * so its empty state can open the same form.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

import { IN_FLIGHT_STATES } from '../../lib/pipeline-state';
import { useDashboardStore } from '../../lib/store';
import { errorMessage } from './orderBookApi';
import type { OrderBookView } from './types';

interface BookListProps {
  books: OrderBookView[];
  selectedId: string | null;
  onSelect: (bookId: string) => void;
  onCreate: (name: string) => Promise<void>;
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function bookMetaLine(book: OrderBookView): string {
  const total = book.progress.total;
  if (book.phase === 'draft') {
    const fix = book.validation?.blocks.length ?? 0;
    return `Draft · ${plural(book.items.length, 'issue')}${fix > 0 ? ` · ${fix} to fix` : ''}`;
  }
  if (book.phase === 'archived') return `${book.progress.landed} of ${total} landed`;
  if (book.finished) return `Finished · all ${total} landed`;
  if (book.phase === 'queued') return `Queued · ${plural(book.items.length, 'issue')}`;
  return `${book.progress.landed} of ${total} landed${book.settings.posture === 'drain' ? ' · paused' : ''}`;
}

function ProgressBar({ book, inProgress }: { book: OrderBookView; inProgress: number }) {
  const total = book.progress.total;
  const landedPct = total > 0 ? (book.progress.landed / total) * 100 : 0;
  const progressPct = total > 0 ? (inProgress / total) * 100 : 0;
  return (
    <span className="mt-1.5 flex h-1 w-full overflow-hidden rounded-sm bg-muted" aria-hidden="true">
      <span className="h-full bg-success" style={{ width: `${landedPct}%` }} />
      <span className="h-full bg-info" style={{ width: `${progressPct}%` }} />
    </span>
  );
}

export function BookList({ books, selectedId, onSelect, onCreate, creating, onCreatingChange }: BookListProps) {
  const derivedById = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  // Collapsed by default, but open when the page lands on an archived book (a ?book= link).
  const [archivedOpen, setArchivedOpen] = useState(() => books.some((book) => book.id === selectedId && book.phase === 'archived'));
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = new Set(
    Object.values(derivedById)
      .filter((entry) => IN_FLIGHT_STATES.has(entry.state))
      .map((entry) => entry.issueId.toUpperCase()),
  );
  const inProgressOf = (book: OrderBookView) => book.items.filter((item) => inFlight.has(item.issue.toUpperCase())).length;

  const active = books.filter((book) => book.phase === 'active');
  const queued = books
    .filter((book) => book.phase === 'queued')
    .sort((left, right) => (left.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.queuePosition ?? Number.MAX_SAFE_INTEGER));
  const drafts = books.filter((book) => book.phase === 'draft');
  const archived = books.filter((book) => book.phase === 'archived');

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName('');
      onCreatingChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setSubmitting(false);
  };

  const row = (book: OrderBookView) => {
    const selected = book.id === selectedId;
    const showBar = book.phase === 'active' || (book.finished && book.phase !== 'archived');
    return (
      <button
        key={book.id}
        type="button"
        onClick={() => onSelect(book.id)}
        aria-current={selected ? 'true' : undefined}
        data-book={book.id}
        className={`block w-full rounded-md border px-2.5 py-2 text-left ${selected ? 'border-border bg-card' : 'border-transparent hover:bg-accent'}`}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{book.name}</span>
          {book.phase === 'queued' && book.queuePosition !== null && (
            <span className="shrink-0 font-mono text-[11px] text-faint-foreground">#{book.queuePosition}</span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{bookMetaLine(book)}</span>
        {showBar && <ProgressBar book={book} inProgress={inProgressOf(book)} />}
      </button>
    );
  };

  const eyebrow = 'eyebrow mt-4 mb-1.5 px-1';
  return (
    <nav aria-label="Order books" className="flex flex-col" data-section="OrderBookList">
      {creating ? (
        <div className="grid gap-2 rounded-md border border-border bg-card p-2">
          <label className="sr-only" htmlFor="new-order-book-name">Book name</label>
          <div className="flex items-center gap-1.5">
            <input
              id="new-order-book-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
                if (event.key === 'Escape') onCreatingChange(false);
              }}
              placeholder="Book name"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
            />
            <button type="button" aria-label="Cancel new book" onClick={() => onCreatingChange(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || submitting}
            className="rounded-md border border-primary bg-primary px-2 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
          >
            {submitting ? 'Creating…' : 'Create book'}
          </button>
          {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onCreatingChange(true)}
          className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-accent"
        >
          + New book
        </button>
      )}

      <h3 className={eyebrow}>Active</h3>
      {active.length > 0
        ? active.map(row)
        : <p className="px-1 text-[11px] text-muted-foreground">
            {queued.length > 0
              ? 'Every queued book has finished, so the Flywheel follows the backlog.'
              : 'No book is queued, so the Flywheel follows the backlog.'}
          </p>}

      {queued.length > 0 && <><h3 className={eyebrow}>Queued</h3>{queued.map(row)}</>}
      {drafts.length > 0 && <><h3 className={eyebrow}>Drafts</h3>{drafts.map(row)}</>}
      {archived.length > 0 && (
        <>
          <h3 className={eyebrow}>
            <button type="button" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((open) => !open)} className="uppercase tracking-[inherit] hover:text-foreground">
              {archivedOpen ? '▾' : '▸'} Archived ({archived.length})
            </button>
          </h3>
          {archivedOpen && archived.map(row)}
        </>
      )}
    </nav>
  );
}
