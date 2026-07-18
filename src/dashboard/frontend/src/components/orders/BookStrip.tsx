import { useState } from 'react';
import type { OrderBook } from '@overdeck/contracts';
import { X } from 'lucide-react';

export interface OrderBookProgressItemView {
  issue: string;
  closed: boolean;
  parked: boolean;
  terminal: boolean;
}

export interface OrderBookProgressView {
  total: number;
  landed: number;
  drained: boolean;
  items?: OrderBookProgressItemView[];
}

export interface OrderBookFindingView {
  code: string;
  issue: string;
  message: string;
}

export interface OrderBookView extends OrderBook {
  progress: OrderBookProgressView;
  validation?: { blocks: OrderBookFindingView[]; warns: OrderBookFindingView[] };
  itemReadiness?: Record<string, { hasPrd: boolean }>;
}

interface BookStripProps {
  books: OrderBookView[];
  selectedId: string | null;
  onSelect: (bookId: string) => void;
  onCreate: (name: string) => Promise<void>;
}

function bookMeta(book: OrderBookView): string {
  if (book.status === 'running') return `Active · ${book.progress.landed}/${book.progress.total} landed`;
  if (book.status === 'ready') return `Queued · ${book.items.length} items`;
  if (book.status === 'draft') return `Draft · ${book.items.length} items`;
  const retro = book.status === 'complete' && book.runId ? ' · retro ✓' : '';
  return `${book.status === 'complete' ? 'Drained' : 'Draining'} · ${book.progress.landed}/${book.progress.total} landed${retro}`;
}

export function BookStrip({ books, selectedId, onSelect, onCreate }: BookStripProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName('');
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-muted/30 px-4 py-2" aria-label="Order books">
      {books.map((book) => (
        <button
          key={book.id}
          type="button"
          onClick={() => onSelect(book.id)}
          aria-pressed={book.id === selectedId}
          className={`min-w-44 rounded-lg border bg-card px-3 py-2 text-left transition-colors ${book.id === selectedId ? 'border-primary/50' : 'border-border hover:border-border/80'}`}
        >
          <span className="block truncate text-xs font-medium text-foreground">{book.name}</span>
          <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">{bookMeta(book)}</span>
        </button>
      ))}

      {creating ? (
        <div className="flex min-w-64 items-center gap-2 rounded-lg border border-border bg-card p-2">
          <label className="sr-only" htmlFor="new-order-book-name">Book name</label>
          <input
            id="new-order-book-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') setCreating(false);
            }}
            placeholder="Book name"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
          <button type="button" onClick={() => void submit()} disabled={!name.trim() || submitting} className="rounded-md border border-primary/40 px-2 py-1.5 text-xs text-foreground disabled:opacity-40">
            {submitting ? 'Creating…' : 'Create'}
          </button>
          <button type="button" aria-label="Cancel new book" onClick={() => setCreating(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
          {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="flex shrink-0 items-center rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          + New book
        </button>
      )}
    </section>
  );
}
